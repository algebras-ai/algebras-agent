#!/usr/bin/env node
// Uploads the project's context files to its Algebras platform project, so the
// team and later sessions have them: POST /api/v1/context/projects/{id}/files.
//
//   node tools/upload-context-files.mjs [--dry-run] [file ...]
//
// With no files it takes every path in project.json's `context_files`, except
// the `screenshots` section, which has its own upload. A file's name on the
// platform is its path from the project root, so re-running replaces changed
// files and leaves the rest alone. Run from the project root. Needs
// ALGEBRAS_API_KEY in the environment or ./.env. Node 18+, no dependencies.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./platform-sync.mjs";

const MAX_PER_REQUEST = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 30 * 1024 * 1024;

// Unique paths from `context_files`, a map of section to paths.
export function contextFilePaths(project) {
  const sections = project.context_files ?? {};
  const paths = Object.entries(sections).flatMap(([section, files]) =>
    section === "screenshots" ? [] : files
  );
  return [...new Set(paths)];
}

// Requests within the platform's limits; files it can't take come back apart.
export function planUploads(files) {
  const tooLarge = files.filter((file) => file.size > MAX_FILE_BYTES);
  const requests = [];
  let current = [];
  let bytes = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) continue;
    if (
      current.length > 0 &&
      (current.length >= MAX_PER_REQUEST || bytes + file.size > MAX_REQUEST_BYTES)
    ) {
      requests.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.size;
  }
  if (current.length > 0) requests.push(current);
  return { requests, tooLarge };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const listed = args.filter((arg) => !arg.startsWith("--"));
  const dir = process.cwd();
  const config = readConfig(dir);
  if (!config) {
    throw new Error("Needs project_id in project.json and ALGEBRAS_API_KEY.");
  }
  const project = JSON.parse(readFileSync("project.json", "utf8"));
  const paths = listed.length ? listed : contextFilePaths(project);
  const missing = paths.filter((path) => !existsSync(resolve(dir, path)));
  for (const path of missing) console.warn(`Skipped, not found: ${path}`);
  const { requests, tooLarge } = planUploads(
    paths
      .filter((path) => !missing.includes(path))
      .map((path) => ({ path, size: statSync(resolve(dir, path)).size }))
  );
  for (const file of tooLarge) {
    console.warn(`Skipped, over 25 MB: ${file.path}`);
  }
  if (dryRun) {
    const count = requests.flat().length;
    console.log(`Would upload ${count} files in ${requests.length} request(s).`);
    return;
  }

  const url = `${config.platform}/api/v1/context/projects/${encodeURIComponent(config.projectId)}/files`;
  const totals = { created: 0, replaced: 0, unchanged: 0 };
  for (const request of requests) {
    const form = new FormData();
    for (const { path } of request) {
      form.append("file", new Blob([readFileSync(resolve(dir, path))]), path);
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": config.apiKey },
      body: form,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `Upload failed (${response.status}): ${body?.error?.message ?? response.statusText}`
      );
    }
    for (const item of body.data.items) totals[item.status] += 1;
  }
  console.log(
    `Context files: ${totals.created} created, ${totals.replaced} replaced, ` +
      `${totals.unchanged} unchanged.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
