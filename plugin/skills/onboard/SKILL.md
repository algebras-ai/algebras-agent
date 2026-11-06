---
name: onboard
description: Phase 1 of the Algebras translation workflow (Project Onboarding) — discover source files, understand the domain, pick the flow, take in client context without blocking, choose the fluency checks, generate project.json and parsing tools, and sync the strings and context to the Algebras platform project. Entry point of the pipeline; run at the start of every new session or whenever project.json is missing or incomplete.
allowed-tools: ["Bash(node tools/context-readback.mjs:*)", Read, Write, Edit, Glob, Grep, mcp__algebras__import_project, mcp__algebras__get_context_schema, "Bash(node tools/upload-context-files.mjs:*)", "Bash(node tools/upload-screenshots.mjs:*)", "Bash(node tools/platform-sync.mjs:*)", mcp__algebras__get_project_context, mcp__algebras__list_strings, mcp__algebras__update_project_context, mcp__algebras__update_string_contexts, mcp__algebras__get_string_context]
---

# Phase 1 — Project Onboarding

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## Prerequisites

- None — this is the entry point of the four-phase pipeline (**Onboard → Glossary → Translate → QA**).
- If `project.json` already exists at the project root and every field is populated with real, non-placeholder values, this phase is already satisfied: confirm that with the user and move straight to the `glossary` skill (`algebras-agent:glossary`, or read `skills/glossary/SKILL.md` if skill invocation isn't available in this session). A `project.json` that lacks `project_type`, `fluency`, `context_files` (as a map by section), `context_coverage`, `screenshot_coverage`, `client_questions_file` or `file_flows` is incomplete — run the missing steps (1.2a, 1.2b, 1.2d) and fill those fields instead of skipping ahead. A `project.json` without `project_id` has not been synced to the platform: run 1.6. Keep every answer the user already gave; don't re-ask.

## 1.0 Project type

**Existing platform project.** People can create a project in the Algebras platform (name, type, languages, optional glossary) and pass its id to the agent. When the user gives a project id (or names a project), read it first: `get_project_context` for the project's `name`, `type`, `sourceLang`, `targetLangs`, `glossaryId` and context, and `list_strings` for its strings. Record the id as `project.json`'s `project_id` — this project is the one the run uses; never create a second one. Then:

- **The project has strings and the working directory has no translation files** — the platform already holds the strings and their context. Write a `project.json` with its `project_id`, source and target languages, and the glossary id the project links to, plus `project_type` (declared, from the project's `type` as below, or inferred from the strings in 1.2a), `files: []`, `context_files` with `[]` for every section, `context_coverage` with `not_needed` for every section, `screenshot_coverage: 0.0`, `client_questions_file` and `file_flows: {}`. This `project.json` is complete. Skip 1.1–1.4 and 1.6, ask 1.2d if `fluency` isn't set, and show the 1.5 summary from what the platform returned. Translations are then written back to the files the user points to, or the user is asked where they go; with no files, the platform project is where they land (translate 3.3 and 3.3a).
- **The project has no strings, or the user has local files to add to it** — run 1.1–1.4 as usual, then import into this project in 1.6 (see "Importing into an existing project" there). Take `source_lang`, `target_langs` and `glossary_id` for `project.json` from the project, not from the files; take `project_type` from the project's `type` unless the user declared one (`GAME` → `games`; `APP_UI` → `saas`, or `fintech` when the files are a payments, banking or insurance product; anything else → infer in 1.2a). Compare them with what the files show — a source language that differs, a target language the files have that the project lacks or the reverse, a glossary the files' client glossary would contradict — and tell the user about each difference in the 1.5 summary. Never change the project's settings to match the files without the user's OK; they can change them in the platform or tell you to.

Check whether the user declared a project type — e.g. `Project type: saas` or "Use the games flow" in their prompt. Valid types: `games`, `edtech`, `fintech`, `saas`, `general`. If none was declared, don't ask: 1.2a infers it from the strings, falling back to `general`.

Read `PROJECT_TYPES.md` and `CONTEXT_REQUIREMENTS.md` (in the project root, next to this workflow's `CLAUDE.md`/`AGENTS.md`; if they aren't there, fetch them from `https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin/`) and use the type's flow for the rest of the pipeline:
- It tells 1.1 which files to scan first, and 1.2b which context sections, facts and questions matter.
- It seeds `domain` in 1.3 (`games` → `game`, `edtech` → `edtech`, `fintech` → `fintech`, `saas` → `software`; `general` → derive it in 1.2). With a declared type, don't ask the user about the domain — only flag it in 1.5 if the files clearly contradict the declared type.

## 1.1 Discover source files

List all files in the working directory recursively. Identify candidate translation files by reading their contents — look for bilingual tables, string IDs, subtitle cue blocks, key-value pairs, or any structure that pairs source text with target language slots. Do not filter by extension. Start with the locations the project type's flow lists under "Scan first", but don't stop there.

After the translation files are identified, classify every other file against the eight sections of `CONTEXT_REQUIREMENTS.md` (Glossary, History & decisions, Universe, Tone of voice, Social graph, UX screenshots, Integrations, Files). Read each file and classify it by content, not by name; a file that covers two sections is listed under both. Never modify client context files. Settled decisions in History & decisions are sources for `resolved` facts; open questions already written there go to the client question list and are not asked again.

## 1.2 Understand the domain

Read a representative sample of source strings (at minimum 30–50 rows or the full file if small). Determine:

- **Content type**: game (VO lines, UI labels, lore, achievements, item names), educational content (lessons, quizzes, course pages), financial product (payments, statements, fees, KYC, disclaimers), software UI (app strings, emails, help center), legal document, marketing copy, subtitles, website, mixed
- **Register and formality**: casual, formal, technical, child-friendly, etc.
- **Source language** and all **target languages**
- **File structure**: how source text and translations are organized (columns, rows, nested keys, tagged segments, etc.)
- **Notable constraints**: timing sensitivity (VO/subtitles), placeholder syntax, profanity level, character limits

If anything is ambiguous, ask the user before proceeding.

## 1.2a Pick the flow

If the user declared a type (1.0), use it. Otherwise infer it from the sample in 1.2 — `games`, `edtech`, `fintech` or `saas` when the content clearly fits one, `general` when it doesn't or the repo mixes several. Record the choice as `project_type` and say in 1.5 whether it was declared or inferred.

For `general`, classify each translation file as `games`, `edtech`, `fintech`, `saas` or `plain` and record the map as `file_flows`. Don't build a character matrix for a file that has no speakers.

## 1.2b Context intake

This step never blocks the pipeline. Show one coverage table and at most 5 questions, then continue whether or not the user answers. The fact statuses, tags and authority order used here are defined in `CONTEXT_REQUIREMENTS.md` ("Fact model", "Authority order").

**Coverage table.** Compare the files classified in 1.1 with the sections the flow needs and the facts each target language forces. One row per section:

| Section | Status | Source file | Strings that depend on it |
|---|---|---|---|
| Tone of voice | partial | context/tone.md | 180 |

Status is `present`, `partial`, `missing`, or `not needed for this content type`. `present` means the file covers the facts this content type needs from that section; `partial` means a file was classified there but some of those facts are still open. Count the strings for which that section is the natural source of a language-forced fact or of a disambiguation the source text doesn't contain. Sections not needed for this content type show 0.

**Web product pass.** Once per project, search the product's official site, store page and wiki (see `CONTEXT_REQUIREMENTS.md`, "Web product pass"). Open the page, quote the line that supports a fact, and keep the URL — a search snippet is not evidence. A marketing page that uses du/Sie or tu/vous is a clue; it resolves the address form only when it shows this same UI, or the project has an explicit setting. Two official sources that disagree become a `conflict` with both URLs.

The platform project is where context lives (`CONTEXT_REQUIREMENTS.md`, "Where context lives"). The files this step writes are the input for the import in 1.6: they let the intake run and be tested locally before anything is sent.

**Prefill as much as the project answers.** `CONTEXT_SCHEMA.md` lists every field of the project's context and of a string's context, and where each value usually is; `get_context_schema` returns the same structure from the platform. Go through it field by field, not only the facts a target language forces: the platform, the translation and the people reviewing all read these records. Structure in the file is evidence: a column, a key prefix, a sheet name or the order of the strings gives `contentType`, `screen`, `section`, `previousKey`, and placeholders can be listed from the source text itself. Work through the "Prefill checklist" there before 1.6, and say in 1.5 what stayed empty and why.

**Context pack.** Write `context_pack.json` in the project root from cited sources only, using the fields the flow lists under "Context pack" (characters and formality matrix for `games`; audience and quiz item roles for `edtech`; audience, locked statuses and legally locked ids for `fintech`; one address form, feature names and limits for `saas`). A formality cell the source marks as a client decision is `null`, not a default. Don't invent entries.

**Facts per string.** For each target language, record the facts the flow lists for that string. Language-forced person facts (speaker gender, addressee gender, addressee number, formality, pronoun referent, placeholder meaning) follow the table in `CONTEXT_REQUIREMENTS.md` and apply to dialogue, not to every UI label — re-check that table for the actual target languages. A fact is `resolved` only from a cited source: a client file, a column in the source table (`Speaker`, `Addressee`, `Comment`, `Context`, `Max length`, `Screenshot`, or a column that plays the same role), an official page quoted in the web pass, or an explicit user answer. An inference stays a `candidate` until the user confirms it. A matrix cell the source left for the client is a `conflict`. Anything else stays `open`. Don't guess.

Generate a reusable tool, `tools/context_facts.py`, if `tools/` doesn't already have one. Build it on the Phase 1 parser (if no parser exists yet, generate one now under the rules in 1.4, and let 1.4 reuse it). The tool is generic: no hardcoded column names, language codes or row ranges — pass the column roles, languages and file paths discovered in this project as arguments. It writes `context_facts.jsonl` in the project root, one line per string per target language, with who speaks and is addressed where the source says so (`speaker`, `addressee`, as character ids) and only the other facts that language forces for that string. Each fact has a `status` plus:

- `resolved` — `value` and `source`
- `candidate` — `value` and `source`, with the reason in the source's `quote`. An inference with no document behind it cites its own string: `{"kind": "string", "ref": "<externalKey>", "quote": "<reason>"}`
- `conflict` — `readings`, each `{"value": ..., "source": {...}}`
- `open` — nothing else

Values and sources use the platform's vocabulary (`CONTEXT_REQUIREMENTS.md`, "How a status is stored on the platform"), so the import carries them unchanged: gender `Masc`, `Fem` or `Neut`; number `Sing` or `Plur`; formality `Infm` or `Form`; a source is `{"kind", "ref", "quote"}`. A pronoun referent is named `pronoun_referent[<text>]` and a placeholder `placeholder_meaning[<name>]`, each with its platform fields as `value` (`{"characterId": "..."}`, `{"meaning": "...", "kind": "count"}`).

```json
{"externalKey": "dialog.csv#120", "lang": "fr", "facts": {"speaker": {"status": "resolved", "value": "mira", "source": {"kind": "string", "ref": "dialog.csv#120:column:Speaker"}}, "speaker_gender": {"status": "resolved", "value": "Fem", "source": {"kind": "document", "ref": "context/characters.md#mira", "quote": "Mira, the ship's captain; she"}}, "formality": {"status": "open"}, "pronoun_referent[he]": {"status": "candidate", "value": {"characterId": "captain"}, "source": {"kind": "string", "ref": "dialog.csv#119", "quote": "previous line names the captain; not confirmed"}}}}
```

Test the tool on a small sample before running it on the full file. Count the unresolved (`open`, `candidate`, `conflict`) facts per type and language.

The `externalKey` (`<file>#<id or row>`, see `CONTEXT_REQUIREMENTS.md`, "Where each fact goes") matches the line to the platform string, now and on every later import.

**Questions.** Use the flow's question list. Skip any question whose string count is 0. Phrase questions about facts, not about sections — "Who speaks rows 120 to 340, and to whom?", not "Please provide a social graph". Rank them by how many strings an answer would unblock (strings where it resolves at least one unresolved fact). Show the coverage table and at most 5 questions; every other question goes only to `client_questions.md`.

**Screenshots.** Link them in the order in `CONTEXT_REQUIREMENTS.md`: a table column, then a file named after the string key or row, then a capture spec. `screenshot_coverage` is the fraction of strings linked to a screenshot (0.0–1.0). Every flow needs screenshots for UI strings. If none are linked, one of the 5 questions is the single screenshot ask — screenshots in a column, files named by key, or a playable build. Ask it once. If they have a playable build and want automated capture, write a runner spec into `tools/` (Playwright for browser, PyAutoGUI for desktop, Appium for mobile) and don't run it without explicit later permission. If the content has no UI, the status is `not needed for this content type` and there is no screenshot question.

**Client question list.** Each question becomes a `question` note on the platform project in 1.6. Write `client_questions.md` in the project root as the copy for the project manager to forward to the client. Deduplicate. Each question records the fact type, the affected languages, the number of strings it unblocks, and 2 example rows:

```markdown
# Client questions

## 1. Who speaks rows 120 to 340, and to whom?

- Fact: speaker_gender, addressee_gender, formality
- Languages: fr, ja
- Strings unblocked: 220
- Examples:
  - Row 120: "I told you to wait."
  - Row 134: "You never listen."
```

Don't wait for answers before 1.3. An answer that comes before 1.6 goes into the import files: the fact becomes `resolved` with source `user` in `context_facts.jsonl` (or `context_pack.json` for a project-level object), and the question leaves `client_questions.md`. An answer after 1.6 is written to the platform the way the translate skill writes facts (3.1b): `update_string_contexts` or `update_project_context` with `baseVersion` and source `{"kind": "user"}`, the question note updated, and `client_questions.md` regenerated from the notes.

## 1.2c Existing translations (translation memory)

For each target language, count the segments that already have a non-empty translation. These are the project's translation memory: they are kept as-is, are never sent for translation again (unless the user explicitly asks to retranslate them), and serve as the reference for terminology and style in Phases 2–3. Note the per-language counts for the 1.5 summary.

## 1.2d Fluency checks

Ask the user once which fluency checks translate should run, and record the answer as `project.json`'s `fluency`. Fluency scores are a self-check of the agent's own translation, not an independent QA pass. Show the options with their approximate cost per string of N words:

| `fluency` | What translate does per batch | Approx. cost per string |
|---|---|---|
| `none` | Glossary translation only — no fluency score | N words |
| `isolated` | A no-glossary translation scored on its own (context-free), then the glossary translation that gets written | 2N + 10 words |
| `context` | The glossary translation that gets written, scored with its neighbor strings and approved choices (context-aware) | N + 10 words |
| `both` | Both scores: the isolated one on the no-glossary translation and the context-aware one on the written text | 2N + 20 words |

If the user's prompt already says `Fluency: none|isolated|context|both`, use that and don't ask. When running non-interactively (e.g. the Algebras GitHub Action) with no `Fluency:` line, use `isolated`. Never re-ask once `fluency` is recorded; the user can change it later by telling you, and only strings translated after the change follow the new setting.

## 1.3 Generate project.json

Write `project.json` based on what you've discovered. Do not copy a template — derive every field from the actual files:

```json
{
  "name": "<project name inferred from content or filename>",
  "domain": "<game|edtech|fintech|software|legal|marketing|subtitles|document|other>",
  "project_type": "<games|edtech|fintech|saas|general>",
  "fluency": "<none|isolated|context|both>",
  "content_type_notes": "<one-sentence description of what is being translated>",
  "source_lang": "<BCP 47 code>",
  "target_langs": ["<code>", "..."],
  "files": ["<relative path>", "..."],
  "source_field": "<column name, JSON key, or XPath — whatever locates source text>",
  "target_fields": {
    "<lang_code>": "<column name / key>"
  },
  "glossary_id": null,
  "project_id": null,
  "mcp_url": "https://platform.algebras.ai/api/mcp",
  "notes": "<any other project-specific context worth remembering>",
  "context_files": { "<section>": ["<relative path>", "..."] },
  "context_coverage": { "<section>": "present|partial|missing|not_needed" },
  "screenshot_coverage": 0.0,
  "client_questions_file": "client_questions.md",
  "file_flows": {}
}
```

`project_type` comes from 1.2a and is what later phases use to pick the flow from `PROJECT_TYPES.md`; `domain` follows it (`games` → `game`, `edtech` → `edtech`, `fintech` → `fintech`, `saas` → `software`; for `general`, derive `domain` from the files). `fluency` comes from 1.2d.

The context fields come from 1.1 and 1.2b. `context_files` is keyed by section — `glossary`, `history`, `universe`, `tone_of_voice`, `social_graph`, `screenshots`, `integrations`, `files` — with `[]` when a section has no file. `context_coverage` stores `present`, `partial`, `missing` or `not_needed` per section. `screenshot_coverage` is a fraction from 0.0 to 1.0. `file_flows` maps a translation file to its flow when `project_type` is `general`; otherwise it is `{}`.

`project_id` stays `null` here — 1.6 imports the project to the Algebras platform and fills it in. When the user gave an existing project (1.0), it is that project's id from the start, and `source_lang`, `target_langs` and `glossary_id` are the project's.

`glossary_id` stays `null` here — the `glossary` skill (Phase 2) creates the glossary on the Algebras platform and fills this in. There is no local glossary directory or file to set up.

If you can't determine a field with confidence, prompt the user:

> "I found these potential source fields: `[list]`. Which one contains the strings to translate?"

## 1.4 Generate parsing tools on demand

Examine the file format(s) and write a parser into `tools/` if no suitable one exists. Choose the language that best fits the project environment (Python by default).

A parser must:
- Accept `--file <path>` and `--lang <code>` arguments at minimum
- Correctly parse the actual format (CSV, TSV, JSON, XLIFF, SRT, XML, YAML, PO, etc.)
- Support at minimum: read all rows, write a specific field/column, list empty vs. non-empty cells

Name parsers `tools/parse_<format>.<ext>`. **Generate tools on demand, not ahead of time.** Before writing a new tool, check `tools/` for an existing one that covers the need.

## 1.6 Sync to platform

Import the project into the Algebras platform, which holds its context from now on. Map the files from 1.2b by the tables in `CONTEXT_REQUIREMENTS.md` ("How a status is stored on the platform", "Where each fact goes"):

- **Project:** `name`, `sourceLang`, `targetLangs` and `type` from `project.json` (`games` → `GAME`; `saas` and `fintech` → `APP_UI`; others by `domain`: `marketing` → `MARKETING`, `subtitles` → `SUBTITLES`, `document`/`legal` → `DOCUMENT`, a website → `WEBSITE`, else `OTHER`), and `glossaryId` if `glossary_id` is already set.
- **Project context**, from `context_pack.json`: `description` from the universe or product description; `characters` (id = a slug of the name) with gender (the key is required: `null` when no source decides it), `description`, `aliases` and `number` where the sources give them; `relations`, one per direction, with `description` and `register` per language from the formality matrix (a cell the client must decide is `null`); `defaults.uiAddressesUser`, `defaults.narratorGender` and `defaults.protagonist` where they apply; `defaults.userRegister` for the product's one address form (a form the client must decide is left out and added to `issues`, since this field can't hold `null`); `style.tone` and `style.brief` from the tone-of-voice files; `notes`: settled decisions from History & decisions as `decision`, and every client question from 1.2b as `question` (the fact, the languages, the strings it unblocks, two example rows). The flow's pack fields use the platform's values here: gender `f`/`m` becomes `Fem`/`Masc`, `T`/`V` becomes `Infm`/`Form`, and a citation (`ev`) becomes the fact's `source`. A pack field with no platform field of its own (`keep`, `audience`, locked terms and so on) goes in `notes` with `kind: "note"`, so nothing stays behind in the file.
- **Strings**, one per source string: `externalKey`, `sourceText`, and its `context` built from that string's `context_facts.jsonl` lines (all target languages merged into one record). `resolved` → `confirmed` with its source; `candidate` → `suggestion` with its source; `conflict` → the fact is left out and the string's `issues` gets `{"field": "<fact path>", "lang": "<lang, for a per-language fact>", "kind": "conflict", "readings": [...]}` (a gender conflict goes on the same string as `speaker.gender` or `addressee.gender`); `open` → the fact is left out. `placement` (`contentType` on every string, `maxLength`, `screen`, `note`), `discourse` (`section`, `scene`, `previousKey` for running text), `placeholders` (each one in the source) and a per-string `style.tone` follow `CONTEXT_SCHEMA.md`. A flow's own fact with no field (`item_role`, `money_state` and so on) goes in `placement.note` as `<fact>: <value>`.

Generate `tools/platform_import.py` (generic: reads `project.json`, `context_pack.json` and `context_facts.jsonl`, prints the payload as JSON) if `tools/` doesn't have it, and check its output on a few strings with every status before sending the full set. Save the full payload as `tools/platform_import.json`; the read-back below compares against it.

**Importing into an existing project** (a `project_id` the user gave, or one from an earlier run): pass it as `projectId`, and leave out `name`, `type`, `sourceLang`, `targetLangs` and `glossaryId` — the import overwrites the project's settings with any of them you send, and the project's settings win (see 1.0). Send one only when the user asked to change it. If the project already has context (`get_project_context` returned a non-empty `context.data`), leave `context` out of the import too — it replaces the whole project context — and add the local project facts with `update_project_context` and the context's `version` as `baseVersion` (`CONTEXT_REQUIREMENTS.md`, "Writes"), keeping what the platform already holds; a fact that disagrees with the platform's is a `conflict`, not an overwrite.

**Strings that already exist on the platform.** An import is authoritative: a `context` it carries replaces the stored one, including what people edited in the UI. So read the project's strings first (`list_strings`), and import a string with `context` only when the platform doesn't have it yet. A string it already has is sent with `externalKey` and `sourceText` only, and its local facts are added the way the translate skill writes facts (3.1b, with `baseVersion`, keeping what the platform already holds); a fact that disagrees with the platform's is a `conflict`, not an overwrite.

Call `import_project` with the payload. If `project.json` already has a `project_id`, pass it: the import then updates that project, matching strings by `externalKey`, so re-running 1.6 after a change to the files updates the same strings instead of creating new ones. Send large projects in chunks of about 200 strings per call: the project fields and `context` go in the first call only, and the rest carry the `project_id` from the first call and their strings. Write the returned `project_id` into `project.json` right after the first call, so a crash doesn't orphan the project.

An import starts a context evaluation in the background, which adds suggestions and evaluation flags and moves record versions; it can take minutes to start writing. Wait for it before reading back: call `list_strings` every 15 seconds or so until every string's `context.data` has `evaluation`, for at most 5 minutes. If it hasn't finished by then, read back anyway and tell the user how many strings have no evaluation yet; evaluation never blocks the pipeline, and later writes handle moved versions (`CONTEXT_REQUIREMENTS.md`, "Writes").

Then read it back: save `get_project_context`'s result and every page of `list_strings`'s `items` as `tools/context_readback.json` (`{"project": ..., "strings": [...]}`), and run `node tools/context-readback.mjs` from the project root. If `tools/context-readback.mjs` doesn't exist, copy it and `run-report.mjs` from the plugin's `reports/` folder (or download both from `https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin/reports/`) into `tools/` first. It compares every local fact with its platform field by value, status and source, and the sent project context, placement and discourse value by value; it prints counts, and `--details` adds the string keys. Exit code 1 means something was lost or differs: fix the payload and import again, or report it to the user before 1.5 if the platform can't hold it. `no_status_field` counts facts the platform stores without a status or source (referents, placeholders, a flow's own facts). Also report, per target language, the strings with missing facts (`list_strings` with `missingFact`). Translate and QA read context from the platform from here on.

## 1.6b Store the context files and screenshots

The platform keeps the client's reference files and screenshots too, so the team sees them and later sessions don't depend on this machine. Copy the scripts into `tools/` first if they aren't there (`sync/upload-context-files.mjs`, `sync/platform-sync.mjs` and `capture/upload-screenshots.mjs` from the plugin, or download them from `https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin/`).

- **Context files.** `node tools/upload-context-files.mjs` uploads every path in `project.json`'s `context_files` except `screenshots`, up to 25 MB each. A file's name on the platform is its path from the project root, so a `document` source's `ref` still points at it. Re-running replaces changed files and leaves the rest. Ask first if a file looks private and isn't translation context (credentials, contracts, personal data); leave it out by passing the paths to upload.
- **Screenshots.** For the screenshots linked in 1.2b, write `screenshots_manifest.json` in the project root: `{"manifestVersion": 1, "runId": "repo", "game": "<project name>", "screenshots": [{"file": "<path from the project root>", "stringKeys": ["<externalKey>", "..."]}]}`, then run `node tools/upload-screenshots.mjs --manifest screenshots_manifest.json --project <project_id>`. PNG, JPEG or WebP only, up to 10 MB each. It prints `screenshot_coverage`: put that in `project.json`. People can add and map more in the platform.

Report what was stored in 1.5. A failed upload never blocks the pipeline: report it and go on.

Then record where the project stands, so the first poll has a baseline: `node tools/platform-sync.mjs`.

## 1.5 Project summary

Run 1.6 first, so the summary reports what the platform holds. Before any translation work, output a summary and wait for user confirmation:

> **Project summary**
> - Project type: [games / edtech / fintech / saas / general] — [declared / inferred / default] [· per-file flows for `general`] [· note any mismatch with what the files contain]
> - Content: [what is being translated — e.g. "RPG game — UI labels, VO lines, lore, achievements"]
> - Source: [language] · [field/column] · [file(s)]
> - Targets: [list of target languages]
> - Platform project: [new / existing `<name>` (`<id>`)] [· each difference between the project's settings and the files — source language, target languages, glossary — and that the project's settings are used]
> - Existing translations: [per language: N of M segments already translated — kept, not re-translated]
> - Context: [one line per present or partial section — section, status, source file; "no client context files found" if none] · screenshot coverage [N%]
> - Platform project: [project_id] · [N strings] · [M flagged] — context is read from and written to the platform from here on
> - Stored on the platform: [N context files] · [N screenshots] · fields left empty from the prefill checklist and why
> - Open facts: [unresolved facts per target language, and the single top question — full list in `client_questions.md`]
> - Fluency checks: [none / isolated / context / both]
> - Glossary: [N active terms / empty / missing]
> - Tools available: [list of scripts in tools/]
>
> Does this look right? If anything is wrong, tell me now before I proceed.

Do not start Phase 2 until the user confirms or corrects this summary.

## Next

Once the user has confirmed the project summary (1.5), continue with Phase 2 — invoke the `glossary` skill (`algebras-agent:glossary`) if skill invocation is available in this session, otherwise open and follow `skills/glossary/SKILL.md` in full.
