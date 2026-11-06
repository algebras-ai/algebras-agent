import assert from "node:assert/strict";
import { test } from "node:test";

import { contextFilePaths, planUploads } from "./upload-context-files.mjs";

test("takes every section's files once, leaving screenshots to their own upload", () => {
  assert.deepEqual(
    contextFilePaths({
      context_files: {
        universe: ["docs/lore.md", "docs/gdd.pdf"],
        tone_of_voice: ["docs/lore.md"],
        screenshots: ["shots/a.png"],
        files: [],
      },
    }),
    ["docs/lore.md", "docs/gdd.pdf"]
  );
  assert.deepEqual(contextFilePaths({}), []);
});

test("splits by count and size, and sets aside what the platform can't take", () => {
  const MB = 1024 * 1024;
  const small = Array.from({ length: 21 }, (_, i) => ({ path: `${i}.md`, size: 1 }));
  assert.deepEqual(
    planUploads(small).requests.map((r) => r.length),
    [20, 1]
  );

  const { requests, tooLarge } = planUploads([
    { path: "a", size: 20 * MB },
    { path: "b", size: 20 * MB },
    { path: "huge", size: 26 * MB },
  ]);
  assert.deepEqual(requests.map((r) => r.map((f) => f.path)), [["a"], ["b"]]);
  assert.deepEqual(tooLarge.map((f) => f.path), ["huge"]);
});
