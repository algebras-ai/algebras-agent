#!/usr/bin/env node
// Uploads the screenshots of a capture manifest to an Algebras platform
// project: POST /api/v1/context/projects/{id}/screenshots, in batches.
// The platform stores the images and links each one to the strings it shows.
//
//   node upload-screenshots.mjs --manifest runs/<name>/manifest.json \
//     --project <projectId> [--key-pattern 'segments.json#row-{row}'] \
//     [--batch 25] [--dry-run]
//
// Image paths in the manifest are relative to the manifest's folder. Needs
// ALGEBRAS_API_KEY (and optionally ALGEBRAS_PLATFORM_URL) in the environment
// or in ./.env. Node 18+, no dependencies.
//
// Re-running is safe: a screenshot is identified by the manifest's runId and
// its id, so a second upload replaces its image and links. If a batch fails,
// fix the cause and run the whole command again.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const MAX_PER_REQUEST = 50; // platform limit
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function fail(message) {
  console.error(message);
  console.error(
    "Usage: node upload-screenshots.mjs --manifest <path> --project <id> " +
      "[--key-pattern 'segments.json#row-{row}'] [--batch 25] [--dry-run]"
  );
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { batch: 25, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    const name = { "--manifest": "manifest", "--project": "project",
      "--key-pattern": "keyPattern", "--batch": "batch" }[arg];
    if (!name) fail(`Unknown argument: ${arg}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) {
      fail(`${arg} needs a value`);
    }
    opts[name] = value;
  }
  if (!opts.manifest || !opts.project) fail("--manifest and --project are required");
  opts.batch = Number(opts.batch);
  if (!Number.isInteger(opts.batch) || opts.batch < 1 || opts.batch > MAX_PER_REQUEST) {
    fail(`--batch must be 1 to ${MAX_PER_REQUEST}`);
  }
  return opts;
}

// Splits the screenshots so each request stays under the count and size
// limits.
function batches(shots, dir, maxCount) {
  const out = [];
  let current = [];
  let bytes = 0;
  for (const shot of shots) {
    const size = statSync(resolve(dir, shot.file)).size;
    if (current.length > 0 &&
        (current.length >= maxCount || bytes + size > MAX_REQUEST_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(shot);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

async function send(url, apiKey, manifest, shots, dir, opts) {
  const form = new FormData();
  form.set("manifest", JSON.stringify({ ...manifest, screenshots: shots }));
  if (opts.keyPattern) form.set("keyPattern", opts.keyPattern);
  if (opts.dryRun) {
    form.set("dryRun", "true");
  } else {
    for (const shot of shots) {
      const data = readFileSync(resolve(dir, shot.file));
      form.set(shot.file, new Blob([data]), shot.file.split("/").pop());
    }
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `${response.status} ${response.statusText}`;
    throw new Error(`Upload failed (${response.status}): ${message}`);
  }
  return body.data;
}

async function main() {
  loadDotEnv();
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ALGEBRAS_API_KEY;
  if (!apiKey) fail("ALGEBRAS_API_KEY is not set (environment or ./.env)");
  const platform = (process.env.ALGEBRAS_PLATFORM_URL ?? "https://platform.algebras.ai")
    .replace(/\/+$/, "");
  const url = `${platform}/api/v1/context/projects/${encodeURIComponent(opts.project)}/screenshots`;

  const manifestPath = resolve(opts.manifest);
  const dir = dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const shots = manifest.screenshots ?? [];
  if (shots.length === 0) fail("The manifest lists no screenshots");
  const missing = shots.filter((s) => !existsSync(resolve(dir, s.file)));
  if (missing.length > 0 && !opts.dryRun) {
    fail(`Missing images (${missing.length}): ${missing.slice(0, 10).map((s) => s.file).join(", ")}`);
  }

  const groups = opts.dryRun
    ? Array.from({ length: Math.ceil(shots.length / opts.batch) },
        (_, i) => shots.slice(i * opts.batch, (i + 1) * opts.batch))
    : batches(shots, dir, opts.batch);
  console.log(
    `${opts.dryRun ? "Checking" : "Uploading"} ${shots.length} screenshots of run ` +
      `${manifest.runId} to ${platform}, project ${opts.project}, in ${groups.length} request(s)`
  );

  const total = { created: 0, updated: 0, links: 0, unknownKeys: [], unlinked: [] };
  let coverage = null;
  for (const [i, group] of groups.entries()) {
    const data = await send(url, apiKey, manifest, group, dir, opts);
    total.created += data.screenshots.created;
    total.updated += data.screenshots.updated;
    total.links += data.links;
    total.unknownKeys.push(...data.unknownKeys);
    total.unlinked.push(...data.unlinked);
    coverage = data.coverage;
    console.log(`  ${i + 1}/${groups.length}: ${group.length} screenshots, ${data.links} links`);
  }

  const verb = opts.dryRun ? "would be" : "were";
  console.log(
    `Screenshots: ${total.created} ${verb} created, ${total.updated} ${verb} updated; ${total.links} links`
  );
  if (total.unknownKeys.length > 0) {
    console.warn(`Unknown string keys (${total.unknownKeys.length}):`,
      total.unknownKeys.slice(0, 20));
  }
  if (total.unlinked.length > 0) {
    console.warn(`Screenshots with no linked string (${total.unlinked.length}):`,
      total.unlinked.slice(0, 20));
  }
  if (coverage) {
    console.log(
      `screenshot_coverage: ${coverage.ratio.toFixed(3)} ` +
        `(${coverage.linkedStrings}/${coverage.totalStrings} strings)`
    );
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
