# Checking a TM-first run

This procedure proves the translation-memory-first flow on a real project:
strings with an approved translation in memory (same source text, speaker and
addressee) skip translation, every written
translation is recorded for review, and glossary compliance is reported before
and after the final glossary pass (`translate` 3.5). It works for any project
the agent can parse — CSV, PO, JSON, XLIFF, a web or mobile codebase.

The project, its strings and everything derived from it stay local. Nothing
from the run is committed except an aggregate result (counts and percentages,
no strings, terms, keys or file names).

## What you need

- A local Algebras platform with the translation review API
  (`record_translations`, `set_translation_status`, `list_translations`),
  the translation memory lookup and the glossary term counter, plus the
  ai-service it calls.
- A scratch API key on that platform, used only for this run.
- A project to run on, read-only: a copy of its translation files in a run
  folder outside this repository (or in a gitignored folder). Never run the
  project's own scripts.
- Earlier translations for part of its strings (a previous release, an older
  export, the project's history), to seed translation memory.

## 1. Prepare the run folder

Copy the project's source and target files into the run folder. Pick a sample
per target language that mixes strings with an earlier translation (expected
TM hits) and strings without one (expected misses); a few dozen strings per
language is enough. Make sure some of the sample strings contain glossary
terms.

Point the agent at the local platform: register the MCP server
`http://localhost:<port>/api/mcp` with the scratch key (AGENTS.md, Step 2),
and set `ALGEBRAS_PLATFORM_URL` for any direct REST call.

## 2. Onboard and glossary

Run `onboard` on the run folder: it imports the strings into a new platform
project and writes `project.json`. Run `glossary` and approve the terms the
project's own glossary or terminology confirms (2.6), so the counter has
approved terms to count.

## 3. Seed translation memory through the review API

For the sample strings that have an earlier translation, record that
translation on the platform project and approve it — the same calls the `qa`
skill's 4.6 makes:

- `record_translations` with `origin: "manual"` for translations people
  wrote (recorded as approved), or
- `record_translations` with `origin: "machine"`, then `set_translation_status`
  `approved`, for translations you are confirming as the reviewer.

Use the strings' `externalKey` from the import. Never write translation rows
to the database directly.

## 4. Run the TM-first flow

Clear the sample strings' target text in the run folder's copy, then run
`translate` on the sample as usual: the TM lookup (3.2.0), translation of the
misses, recording (3.3a), the consistency checks (3.4) and the final glossary
pass (3.5). The skill writes `tools/tm_hits.jsonl`,
`tools/translate_calls.jsonl`, `tools/glossary_pass.jsonl` and
`tools/glossary_compliance.json`.

## 5. Check the run

From the run folder:

```bash
node tools/run-report.mjs            # Markdown
node tools/run-report.mjs --json     # for the result doc
node tools/run-report.mjs --details  # ids behind a failed check (stays local)
```

The run passes when:

- TM hits exist for every target language that had seeded translations;
- **TM-hit strings sent to translation: 0**;
- **not recorded: 0** — every written string was recorded for review;
- compliance before and after 3.5 is reported per target language, and
  `Matches glossary_compliance.json: yes`;
- the exit code is 0.

Optionally run `qa` 4.6 on a few drafts and run the report again to see the
review outcomes.

## 6. Record the result and clean up

Write the aggregate numbers from `--json` (TM hits per language and action,
leaks, recorded counts, compliance before and after per language) into a
result doc. Describe the input generically ("a game's UI strings, 3 target
languages, N strings per language") — no strings, terms, keys or file names.

Delete everything the run created on the local platform: the imported
project with its strings and their translation revisions, the scratch glossary
and its terms, the translation history rows made with the scratch key, and the
scratch key itself. Use the platform's delete endpoints where they exist
(glossaries have one); for the rest, a cleanup SQL that deletes only the ids
the run created. Keep the list of created ids in the run folder while you
work, so the cleanup is complete, and check afterwards that none of them is
left.
