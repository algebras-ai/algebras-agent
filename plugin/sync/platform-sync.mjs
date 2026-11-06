#!/usr/bin/env node
// Polls the Algebras platform for what people changed in its UI and leaves it
// in .algebras/sync/inbox.json for the agent to apply (skills/sync/SKILL.md).
// It never edits translation files: their parsers are generated per project,
// so applying a change takes the agent.
//
//   node tools/platform-sync.mjs               poll, print a summary
//   node tools/platform-sync.mjs --quiet       poll, print nothing (scheduled runs)
//   node tools/platform-sync.mjs --ack         the inbox was applied: empty it
//   node tools/platform-sync.mjs --install-schedule     poll hourly on this machine
//   node tools/platform-sync.mjs --uninstall-schedule
//   node ... --hook session | --hook prompt    for agent hooks; never fails loudly
//
// Run from the project root (next to project.json). Needs ALGEBRAS_API_KEY in
// the environment or ./.env. Node 18+, no dependencies.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_DIR = join(".algebras", "sync");
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;
const MAX_INBOX_CONTEXT_ENTRIES = 500;
const CRON_MARKER = "# algebras-sync:";

export function readConfig(dir) {
  const projectPath = join(dir, "project.json");
  if (!existsSync(projectPath)) return null;
  let project;
  try {
    project = JSON.parse(readFileSync(projectPath, "utf8"));
  } catch {
    return null;
  }
  if (!project.project_id) return null;

  const env = {};
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  const apiKey = process.env.ALGEBRAS_API_KEY || env.ALGEBRAS_API_KEY;
  if (!apiKey) return null;
  const platform =
    process.env.ALGEBRAS_PLATFORM_URL ||
    env.ALGEBRAS_PLATFORM_URL ||
    (project.mcp_url ? project.mcp_url.replace(/\/api\/mcp\/?$/, "") : "") ||
    "https://platform.algebras.ai";
  return {
    projectId: project.project_id,
    apiKey,
    platform: platform.replace(/\/+$/, ""),
  };
}

function client(config, fetchImpl) {
  const base = `${config.platform}/api/v1/context/projects/${encodeURIComponent(config.projectId)}`;
  return async function get(path, query = {}) {
    const url = new URL(base + path);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(name, value);
    }
    const response = await fetchImpl(url, {
      headers: { "x-api-key": config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `${response.status} ${response.statusText}`);
    }
    return { data: body.data, date: response.headers.get("date") };
  };
}

// What a person did to a translation since the last poll; null for a row with
// nothing of theirs (the agent's own drafts and reviews). A row with no draft
// that changed and whose approved text is older means a draft was rejected.
export function classifyTranslation(row, since) {
  const after = (time) => !!time && Date.parse(time) >= Date.parse(since);
  const entry = (kind) => ({
    kind,
    externalKey: row.externalKey,
    language: row.language,
    sourceText: row.sourceText,
    approvedText: row.approved?.text ?? null,
    draftText: row.draft?.text ?? null,
  });
  if (row.approved?.reviewedBy?.userId && after(row.approved.reviewedAt)) {
    return entry("approved");
  }
  if (row.draft?.author?.userId && after(row.draft.createdAt)) {
    return entry("draft");
  }
  if (!row.draft && row.rejectedCount > 0 && !after(row.approved?.reviewedAt)) {
    return entry("rejected");
  }
  return null;
}

// Files people added, replaced or removed since the last poll. `previous` maps
// id to sha256.
export function diffFiles(previous, items) {
  const added = [];
  const changed = [];
  const current = {};
  for (const file of items) {
    current[file.id] = file.sha256;
    const byPerson = file.author?.type === "USER";
    if (!(file.id in previous)) {
      if (byPerson) added.push(file.name);
    } else if (previous[file.id] !== file.sha256 && byPerson) {
      changed.push(file.name);
    }
  }
  const removedCount = Object.keys(previous).filter((id) => !(id in current)).length;
  return { added, changed, removedCount, current };
}

export const emptyInbox = () => ({
  polledAt: null,
  surfacedAt: null,
  translations: [],
  context: [],
  files: { added: [], changed: [], removedCount: 0 },
  newScreenshots: 0,
});

export function inboxSize(inbox) {
  return (
    inbox.translations.length +
    inbox.context.length +
    inbox.files.added.length +
    inbox.files.changed.length +
    inbox.files.removedCount +
    inbox.newScreenshots
  );
}

// Newer news about a string replaces older news about it.
export function mergeInbox(inbox, news) {
  const key = (t) => `${t.language}\u0000${t.externalKey}`;
  const translations = new Map(inbox.translations.map((t) => [key(t), t]));
  for (const t of news.translations) translations.set(key(t), t);
  return {
    ...inbox,
    polledAt: news.polledAt,
    surfacedAt:
      news.translations.length + news.context.length + news.files.added.length +
        news.files.changed.length + news.files.removedCount + news.newScreenshots > 0
        ? null
        : inbox.surfacedAt,
    translations: [...translations.values()],
    context: [...inbox.context, ...news.context].slice(-MAX_INBOX_CONTEXT_ENTRIES),
    files: {
      added: [...new Set([...inbox.files.added, ...news.files.added])],
      changed: [...new Set([...inbox.files.changed, ...news.files.changed])],
      removedCount: inbox.files.removedCount + news.files.removedCount,
    },
    newScreenshots: inbox.newScreenshots + news.newScreenshots,
  };
}

export function summarize(inbox) {
  const count = (kind) => inbox.translations.filter((t) => t.kind === kind).length;
  const parts = [
    [count("approved"), "translations approved or edited"],
    [count("draft"), "drafts saved"],
    [count("rejected"), "drafts rejected"],
    [inbox.context.length, "context changes"],
    [inbox.files.added.length + inbox.files.changed.length, "context files added or replaced"],
    [inbox.files.removedCount, "context files removed"],
    [inbox.newScreenshots, "new screenshots"],
  ].filter(([n]) => n > 0);
  if (parts.length === 0) return "";
  return (
    `People changed this project in the Algebras platform: ` +
    `${parts.map(([n, what]) => `${n} ${what}`).join(", ")}. ` +
    `Before other work, tell the user and apply them: follow the sync skill ` +
    `(algebras-agent:sync, or skills/sync/SKILL.md). Details: ${join(STATE_DIR, "inbox.json")}.`
  );
}

function stateDir(dir) {
  const path = join(dir, STATE_DIR);
  mkdirSync(path, { recursive: true });
  // Local bookkeeping, never committed with the translations.
  const ignore = join(dir, ".algebras", ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return path;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// A crash mid-write can't leave half a file behind.
function writeJson(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, path);
}

export const loadInbox = (dir) =>
  readJson(join(dir, STATE_DIR, "inbox.json"), emptyInbox());

// One poll. State moves only after everything was read, so a failed poll is
// simply repeated by the next one. The first poll only records where things
// stand: what happened before it is not news.
export async function poll(dir, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const config = readConfig(dir);
  if (!config) return { skipped: true };
  const get = client(config, fetchImpl);
  const paths = stateDir(dir);
  const statePath = join(paths, "state.json");
  const inboxPath = join(paths, "inbox.json");
  const state = readJson(statePath, null);

  const { data: projectData, date } = await get("");
  const { project } = projectData;
  // The server's clock, so a wrong local clock can't skip changes.
  const startedAt = date ? new Date(date).toISOString() : now().toISOString();

  const fileList = (await get("/files")).data.items;
  const shots = (await get("/screenshots", { limit: 1 })).data;

  if (!state) {
    writeJson(statePath, {
      contextVersion: project.contextVersion,
      since: startedAt,
      files: diffFiles({}, fileList).current,
      screenshots: shots.total,
    });
    if (!existsSync(inboxPath)) writeJson(inboxPath, emptyInbox());
    return { baseline: true, inbox: loadInbox(dir) };
  }

  const context = [];
  let contextVersion = state.contextVersion;
  let cursor;
  do {
    const { data } = await get("/changes", {
      sinceVersion: state.contextVersion,
      cursor,
    });
    for (const change of data.changes) {
      if (change.actor?.type !== "USER") continue;
      context.push({
        at: change.createdAt,
        by: change.actor.userName ?? null,
        recordType: change.recordType,
        externalKey: change.externalKey ?? null,
        fields: change.changes.map((c) => c.path.join(".")),
      });
    }
    contextVersion = data.contextVersion ?? contextVersion;
    cursor = data.nextCursor;
  } while (cursor);

  const translations = [];
  for (const language of project.targetLangs) {
    for (let page = 1; ; page++) {
      const { data } = await get("/translations", {
        language,
        changedSince: state.since,
        page,
        limit: PAGE_SIZE,
      });
      for (const row of data.items) {
        const entry = classifyTranslation(row, state.since);
        if (entry) translations.push(entry);
      }
      if (page * data.limit >= data.total) break;
    }
  }

  const files = diffFiles(state.files ?? {}, fileList);
  const inbox = mergeInbox(loadInbox(dir), {
    polledAt: startedAt,
    translations,
    context,
    files,
    newScreenshots: Math.max(0, shots.total - (state.screenshots ?? 0)),
  });
  writeJson(inboxPath, inbox);
  writeJson(statePath, {
    contextVersion,
    since: startedAt,
    files: files.current,
    screenshots: shots.total,
  });
  return { inbox };
}

export function acknowledge(dir) {
  stateDir(dir);
  writeJson(join(dir, STATE_DIR, "inbox.json"), emptyInbox());
}

// Tells the agent once about what the last poll found.
function surface(dir) {
  const inbox = loadInbox(dir);
  if (inbox.surfacedAt || inboxSize(inbox) === 0) return "";
  writeJson(join(stateDir(dir), "inbox.json"), {
    ...inbox,
    surfacedAt: new Date().toISOString(),
  });
  return summarize(inbox);
}

// ── Hourly schedule ──────────────────────────────────────────────────────────

const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;

// A minute per project, so machines and projects don't all poll at once.
export function scheduleMinute(dir) {
  return parseInt(createHash("sha256").update(dir).digest("hex").slice(0, 8), 16) % 60;
}

export function cronLine(dir, nodePath, scriptPath) {
  return (
    `${scheduleMinute(dir)} * * * * cd ${shellQuote(dir)} && ` +
    `${shellQuote(nodePath)} ${shellQuote(scriptPath)} --quiet >/dev/null 2>&1 ` +
    `${CRON_MARKER}${dir}`
  );
}

// The crontab with this project's line replaced (or removed with line null);
// every other line stays as it is.
export function mergeCrontab(existing, dir, line) {
  const kept = existing
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.endsWith(`${CRON_MARKER}${dir}`));
  if (line) kept.push(line);
  return kept.length ? kept.join("\n") + "\n" : "";
}

function windowsTaskName(dir) {
  return `AlgebrasSync-${createHash("sha256").update(dir).digest("hex").slice(0, 12)}`;
}

function setSchedule(dir, install) {
  const script = fileURLToPath(import.meta.url);
  if (process.platform === "win32") {
    const args = install
      ? ["/Create", "/F", "/SC", "HOURLY", "/TN", windowsTaskName(dir), "/TR",
         `cmd /c cd /d "${dir}" && "${process.execPath}" "${script}" --quiet`]
      : ["/Delete", "/F", "/TN", windowsTaskName(dir)];
    const result = spawnSync("schtasks", args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "schtasks failed");
    return;
  }
  const read = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (read.error) throw new Error(`crontab is not available: ${read.error.message}`);
  const existing = read.status === 0 ? read.stdout : "";
  const next = mergeCrontab(
    existing,
    dir,
    install ? cronLine(dir, process.execPath, script) : null
  );
  const write = spawnSync("crontab", ["-"], { input: next, encoding: "utf8" });
  if (write.status !== 0) throw new Error(write.stderr || "crontab failed");
}

// ── Command line ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const hook = args.includes("--hook") ? args[args.indexOf("--hook") + 1] : null;

  if (hook) {
    // A hook must never get in the way of the session, so any failure is
    // silent; the next poll picks up what this one missed.
    try {
      if (hook === "session") await poll(dir);
      const text = surface(dir);
      if (text) console.log(text);
    } catch {
      // Offline, or the platform is unavailable.
    }
    return;
  }
  if (args.includes("--ack")) {
    acknowledge(dir);
    console.log("Inbox emptied.");
    return;
  }
  if (args.includes("--install-schedule") || args.includes("--uninstall-schedule")) {
    const install = args.includes("--install-schedule");
    setSchedule(dir, install);
    console.log(
      install
        ? `Polling the Algebras platform hourly for ${dir}.`
        : `Stopped hourly polling for ${dir}.`
    );
    return;
  }

  const result = await poll(dir);
  if (args.includes("--quiet")) return;
  if (result.skipped) {
    console.log("Nothing to poll: no project_id in project.json, or no ALGEBRAS_API_KEY.");
  } else if (result.baseline) {
    console.log("First poll: recorded where the project stands. Later changes will show here.");
  } else {
    console.log(summarize(result.inbox) || "No changes from people on the platform.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
