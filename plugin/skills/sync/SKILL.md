---
name: sync
description: Apply what people changed in the Algebras platform UI to this project — approved and edited translations go into the repo's files, context changes and new reference files are taken in. Use when the session reports platform changes, when the user asks to sync with the platform, and before starting a new batch if `.algebras/sync/inbox.json` has news.
allowed-tools: ["Bash(node tools/platform-sync.mjs:*)", "Bash(git status:*)", "Bash(git diff:*)", Read, Write, Edit, Glob, Grep, mcp__algebras__list_translations, mcp__algebras__list_context_changes, mcp__algebras__get_project_context, mcp__algebras__list_strings, mcp__algebras__get_string_context, mcp__algebras__list_context_files, mcp__algebras__read_context_file, mcp__algebras__list_screenshots, mcp__algebras__get_screenshot]
---

# Sync with the platform

People review and edit this project in the Algebras platform. `platform-sync.mjs` polls for that once an hour and when a session starts, and collects it in `.algebras/sync/inbox.json`. This skill applies it. The platform is the source of truth; the repo's files follow it.

## 1. Read the inbox

Run `node tools/platform-sync.mjs` for a fresh poll (if `tools/platform-sync.mjs` is missing, copy it from the plugin's `sync/` folder), then read `.algebras/sync/inbox.json`:

- `translations[]`: `{kind, externalKey, language, sourceText, approvedText, draftText}`. `kind` is `approved` (a person approved or edited it), `draft` (a person saved a draft) or `rejected` (a person rejected the draft).
- `context[]`: `{at, by, recordType, externalKey, fields}`, context changes made by people.
- `files`: `{added, changed, removedCount}`, reference files people changed.
- `newScreenshots`: how many screenshots were added.

Nothing in the inbox? Say so and stop.

## 2. Translations

An `externalKey` is `<file>#<id>`, so it names the file and the row. Use the project's parser (`tools/parse_*`, onboard 1.4), never text manipulation.

| `kind` | In the file |
|---|---|
| `approved` | Write `approvedText` |
| `draft` | Leave the file. A draft isn't approved yet: list it for the user |
| `rejected` | Write `approvedText` if there is one. With none, leave the file and list the string: its text was turned down and needs a new translation |

Before writing:

- Run `git status` on the translation files. If a file has uncommitted changes, show the user the strings that would be overwritten (the file's text next to the platform's) and ask, for that file only. Files with no uncommitted changes are updated without asking.
- Don't record what you write back with `record_translations`: the platform already has it, and a machine draft would replace a person's.
- `project.json`'s `files` is `[]`: there are no files to write. Report the changes and go on.

After writing, re-read the changed cells with the parser, and run the local checks for tags and placeholders on them (`qa` skill's 4.1). A failure doesn't undo the write: report it, since a person chose that text.

Work on the same branch the run uses (`translate` skill's 3.0).

## 3. Context

Read the changed records (`get_project_context`, `get_string_context`). If this session holds context in memory or in `tools/context_cache.json`, replace it. A person's change outranks an inference: if it touches a string already translated, list the string and ask whether to retranslate it. Translate only after the user says so.

## 4. Files and screenshots

`list_context_files`, then read the added and changed ones with `sendToAi` true (`read_context_file`) and take in what they settle, following `CONTEXT_REQUIREMENTS.md`. Don't copy them into the repo. New screenshots: `list_screenshots`, and look at the ones with `sendToAi` true when they help with an open fact (`get_screenshot`).

## 5. Finish

Tell the user, per language: translations written, drafts waiting, strings that need a new translation, context changes taken in, and anything you need them to decide. Then run `node tools/platform-sync.mjs --ack`, which empties the inbox. Run it only after everything above is applied, so an interrupted sync stays in the inbox.
