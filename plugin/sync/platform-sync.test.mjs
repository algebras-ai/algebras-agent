// node --test plugin/sync/
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  acknowledge,
  classifyTranslation,
  cronLine,
  diffFiles,
  diffScreenshots,
  inboxSize,
  loadInbox,
  mergeCrontab,
  poll,
  readConfig,
  scheduleMinute,
  summarize,
} from "./platform-sync.mjs";

const SINCE = "2026-11-06T10:00:00.000Z";
const LATER = "2026-11-06T11:00:00.000Z";
const EARLIER = "2026-11-06T09:00:00.000Z";

function row(overrides) {
  return {
    externalKey: "a.csv#1",
    language: "de",
    sourceText: "Start",
    status: "draft",
    draft: null,
    approved: null,
    rejectedCount: 0,
    ...overrides,
  };
}

test("a person approving or editing is news, with the text to write", () => {
  const entry = classifyTranslation(
    row({
      approved: {
        text: "Starten",
        reviewedBy: { userId: "u1", apiKeyId: null },
        reviewedAt: LATER,
      },
    }),
    SINCE
  );
  assert.equal(entry.kind, "approved");
  assert.equal(entry.approvedText, "Starten");
  assert.equal(entry.externalKey, "a.csv#1");
});

test("the agent's own review and drafts are not news", () => {
  assert.equal(
    classifyTranslation(
      row({
        approved: {
          text: "x",
          reviewedBy: { userId: null, apiKeyId: "k" },
          reviewedAt: LATER,
        },
      }),
      SINCE
    ),
    null
  );
  assert.equal(
    classifyTranslation(
      row({
        draft: {
          text: "x",
          author: { userId: null, apiKeyId: "k" },
          createdAt: LATER,
        },
      }),
      SINCE
    ),
    null
  );
});

test("a person's draft is news; an old approval next to it isn't the reason", () => {
  const entry = classifyTranslation(
    row({
      draft: { text: "Los", author: { userId: "u1" }, createdAt: LATER },
      approved: {
        text: "Start",
        reviewedBy: { userId: "u1" },
        reviewedAt: EARLIER,
      },
    }),
    SINCE
  );
  assert.equal(entry.kind, "draft");
  assert.equal(entry.draftText, "Los");
  assert.equal(entry.approvedText, "Start");
});

test("a rejected draft shows as a changed row with no draft", () => {
  assert.equal(
    classifyTranslation(row({ status: "rejected", rejectedCount: 1 }), SINCE).kind,
    "rejected"
  );
  const withOlderApproved = classifyTranslation(
    row({
      rejectedCount: 1,
      approved: { text: "Alt", reviewedBy: { userId: "u1" }, reviewedAt: EARLIER },
    }),
    SINCE
  );
  assert.equal(withOlderApproved.kind, "rejected");
  assert.equal(withOlderApproved.approvedText, "Alt");
});

test("file changes count only people's uploads, but any removal", () => {
  const person = { type: "USER" };
  const agent = { type: "API_KEY" };
  const result = diffFiles({ a: "1", b: "2", gone: "3", mine: "4" }, [
    { id: "a", name: "a.md", sha256: "1", author: person },
    { id: "b", name: "b.md", sha256: "changed", author: person },
    { id: "mine", name: "mine.md", sha256: "changed", author: agent },
    { id: "new", name: "new.md", sha256: "5", author: person },
    { id: "own", name: "own.md", sha256: "6", author: agent },
  ]);
  assert.deepEqual(result.added, ["new.md"]);
  assert.deepEqual(result.changed, ["b.md"]);
  assert.equal(result.removedCount, 1);
  assert.equal(result.current.own, "6");
});

test("only screenshots people uploaded are news", () => {
  const result = diffScreenshots(
    ["old"],
    [
      { id: "old", externalKey: "upload#a" },
      { id: "ui", externalKey: "upload#b" },
      { id: "run", externalKey: "repo#shot.png" },
      { id: "bare", externalKey: null },
    ]
  );
  assert.equal(result.newCount, 1);
  assert.deepEqual(result.ids, ["old", "ui", "run", "bare"]);
});

test("the crontab keeps other lines and holds one line per project", () => {
  const line = cronLine("/work/game", "/usr/bin/node", "/work/game/tools/s.mjs");
  assert.match(line, /--quiet/);
  assert.match(line, /^\d+ \* \* \* \* cd '\/work\/game' && /);

  const installed = mergeCrontab("0 1 * * * backup\n", "/work/game", line);
  assert.equal(installed, `0 1 * * * backup\n${line}\n`);
  assert.equal(mergeCrontab(installed, "/work/game", line), installed);
  assert.equal(mergeCrontab(installed, "/work/game", null), "0 1 * * * backup\n");
  assert.equal(mergeCrontab(line + "\n", "/work/game", null), "");
  // A path that contains another project's isn't touched.
  const other = mergeCrontab(installed, "/work/gam", null);
  assert.equal(other, installed);
});

test("a path with a quote stays one shell word", () => {
  assert.match(cronLine("/a'b", "/n", "/s"), /cd '\/a'\\''b' &&/);
});

test("each project keeps its own minute", () => {
  assert.equal(scheduleMinute("/a"), scheduleMinute("/a"));
  assert.ok(scheduleMinute("/a") >= 0 && scheduleMinute("/a") < 60);
});

function projectDir(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  writeFileSync(
    join(dir, "project.json"),
    JSON.stringify({ project_id: "p1", ...extra })
  );
  writeFileSync(
    join(dir, ".env"),
    'ALGEBRAS_API_KEY="k-1"\nALGEBRAS_PLATFORM_URL=http://local:3000/\n'
  );
  return dir;
}

function fakePlatform(world) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: url.toString(), headers: init.headers });
    const path = url.pathname.replace("/api/v1/context/projects/p1", "");
    let data;
    if (path === "") {
      data = {
        project: { contextVersion: world.version, targetLangs: ["de"] },
      };
    } else if (path === "/files") {
      data = { items: world.files ?? [] };
    } else if (path === "/screenshots") {
      const items = world.shots ?? [];
      data = { items, total: items.length, page: 1, limit: 100 };
    } else if (path === "/changes") {
      data = {
        changes: world.changes ?? [],
        nextCursor: null,
        contextVersion: world.version,
      };
    } else if (path === "/translations") {
      const items = world.rows ?? [];
      data = { items, total: items.length, page: 1, limit: 100 };
    }
    return new Response(JSON.stringify({ status: "ok", data }), {
      status: world.status ?? 200,
      headers: { date: world.date ?? "Fri, 06 Nov 2026 12:00:00 GMT" },
    });
  };
  return { calls, fetchImpl };
}

test("config comes from project.json and .env, with no trailing slash", () => {
  const config = readConfig(projectDir());
  assert.deepEqual(config, {
    projectId: "p1",
    apiKey: "k-1",
    platform: "http://local:3000",
  });
  assert.equal(readConfig(mkdtempSync(join(tmpdir(), "none-"))), null);
});

test("a poll with no project is a quiet no-op", async () => {
  const dir = mkdtempSync(join(tmpdir(), "none-"));
  assert.deepEqual(await poll(dir), { skipped: true });
  assert.equal(existsSync(join(dir, ".algebras")), false);
});

test("the first poll records a baseline; later ones collect people's changes", async () => {
  const dir = projectDir();
  const world = {
    version: 5,
    files: [],
    shots: [{ id: "old", externalKey: "upload#old" }],
  };
  const { fetchImpl, calls } = fakePlatform(world);

  const first = await poll(dir, { fetchImpl });
  assert.equal(first.baseline, true);
  assert.equal(inboxSize(first.inbox), 0);
  assert.equal(calls[0].headers["x-api-key"], "k-1");
  assert.equal(readFileSync(join(dir, ".algebras/.gitignore"), "utf8"), "*\n");

  Object.assign(world, {
    version: 7,
    date: "Fri, 06 Nov 2026 13:00:00 GMT",
    shots: [
      { id: "old", externalKey: "upload#old" },
      { id: "ui", externalKey: "upload#new" },
      { id: "agent", externalKey: "repo#shot.png" },
    ],
    changes: [
      {
        createdAt: LATER,
        recordType: "STRING_CONTEXT",
        externalKey: "a.csv#1",
        actor: { type: "USER", userName: "Ada" },
        changes: [{ path: ["speaker", "value"] }],
      },
      {
        createdAt: LATER,
        recordType: "STRING_CONTEXT",
        actor: { type: "SCRIPT" },
        changes: [{ path: ["evaluation"] }],
      },
    ],
    rows: [
      row({
        approved: {
          text: "Starten",
          reviewedBy: { userId: "u1" },
          reviewedAt: "2026-11-06T12:30:00.000Z",
        },
      }),
    ],
    files: [
      { id: "f1", name: "lore.md", sha256: "1", author: { type: "USER" } },
    ],
  });
  const second = await poll(dir, { fetchImpl });

  assert.deepEqual(
    second.inbox.translations.map((t) => [t.kind, t.approvedText]),
    [["approved", "Starten"]]
  );
  assert.deepEqual(second.inbox.context, [
    {
      at: LATER,
      by: "Ada",
      recordType: "STRING_CONTEXT",
      externalKey: "a.csv#1",
      fields: ["speaker.value"],
    },
  ]);
  assert.deepEqual(second.inbox.files.added, ["lore.md"]);
  assert.equal(second.inbox.newScreenshots, 1);
  const text = summarize(second.inbox);
  assert.match(text, /1 translations approved or edited/);
  assert.match(text, /sync skill/);

  // It asks from the server's time of the previous poll.
  const asked = new URL(calls.find((c) => c.url.includes("/translations")).url);
  assert.equal(asked.searchParams.get("changedSince"), "2026-11-06T12:00:00.000Z");
  const changes = new URL(calls.find((c) => c.url.includes("/changes")).url);
  assert.equal(changes.searchParams.get("sinceVersion"), "5");

  // The next poll with nothing new keeps the news until it is acknowledged.
  Object.assign(world, { changes: [], rows: [], date: "Fri, 06 Nov 2026 14:00:00 GMT" });
  const third = await poll(dir, { fetchImpl });
  assert.equal(third.inbox.translations.length, 1);
  assert.equal(third.inbox.newScreenshots, 1);

  acknowledge(dir);
  assert.equal(inboxSize(loadInbox(dir)), 0);
});

test("news about a string replaces older news about it", async () => {
  const dir = projectDir();
  const world = { version: 1 };
  const { fetchImpl } = fakePlatform(world);
  await poll(dir, { fetchImpl });

  const approved = (text, at) =>
    row({
      approved: { text, reviewedBy: { userId: "u1" }, reviewedAt: at },
    });
  world.rows = [approved("Eins", "2026-11-06T12:30:00.000Z")];
  world.date = "Fri, 06 Nov 2026 13:00:00 GMT";
  await poll(dir, { fetchImpl });
  world.rows = [approved("Zwei", "2026-11-06T13:30:00.000Z")];
  world.date = "Fri, 06 Nov 2026 14:00:00 GMT";
  const { inbox } = await poll(dir, { fetchImpl });

  assert.deepEqual(inbox.translations.map((t) => t.approvedText), ["Zwei"]);
});

test("a failed poll moves nothing, so the next one sees the same changes", async () => {
  const dir = projectDir();
  const world = { version: 1 };
  const { fetchImpl } = fakePlatform(world);
  await poll(dir, { fetchImpl });
  const before = readFileSync(join(dir, ".algebras/sync/state.json"), "utf8");

  world.status = 500;
  await assert.rejects(poll(dir, { fetchImpl }));
  assert.equal(readFileSync(join(dir, ".algebras/sync/state.json"), "utf8"), before);
});
