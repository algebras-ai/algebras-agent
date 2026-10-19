---
name: onboard
description: Phase 1 of the Algebras translation workflow (Project Onboarding) — discover source files, understand the domain, pick the flow, take in client context without blocking, choose the fluency checks, and generate project.json and parsing tools. Entry point of the pipeline; run at the start of every new session or whenever project.json is missing or incomplete.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep]
---

# Phase 1 — Project Onboarding

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## Prerequisites

- None — this is the entry point of the four-phase pipeline (**Onboard → Glossary → Translate → QA**).
- If `project.json` already exists at the project root and every field is populated with real, non-placeholder values, this phase is already satisfied: confirm that with the user and move straight to the `glossary` skill (`algebras-agent:glossary`, or read `skills/glossary/SKILL.md` if skill invocation isn't available in this session). A `project.json` that lacks `project_type`, `fluency`, `context_files` (as a map by section), `context_coverage`, `screenshot_coverage`, `client_questions_file` or `file_flows` is incomplete — run the missing steps (1.2a, 1.2b, 1.2d) and fill those fields instead of skipping ahead. Keep every answer the user already gave; don't re-ask.

## 1.0 Project type

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

**Context pack.** Write `context_pack.json` in the project root from cited sources only, using the fields the flow lists under "Context pack" (characters and formality matrix for `games`; audience and quiz item roles for `edtech`; audience, locked statuses and legally locked ids for `fintech`; one address form, feature names and limits for `saas`). A formality cell the source marks as a client decision is `null`, not a default. Don't invent entries.

**Facts per string.** For each target language, record the facts the flow lists for that string. Language-forced person facts (speaker gender, addressee gender, addressee number, formality, pronoun referent, placeholder meaning) follow the table in `CONTEXT_REQUIREMENTS.md` and apply to dialogue, not to every UI label — re-check that table for the actual target languages. A fact is `resolved` only from a cited source: a client file, a column in the source table (`Speaker`, `Addressee`, `Comment`, `Context`, `Max length`, `Screenshot`, or a column that plays the same role), an official page quoted in the web pass, or an explicit user answer. An inference stays a `candidate` until the user confirms it. A matrix cell the source left for the client is a `conflict`. Anything else stays `open`. Don't guess.

Generate a reusable tool, `tools/context_facts.py`, if `tools/` doesn't already have one. Build it on the Phase 1 parser (if no parser exists yet, generate one now under the rules in 1.4, and let 1.4 reuse it). The tool is generic: no hardcoded column names, language codes or row ranges — pass the column roles, languages and file paths discovered in this project as arguments. It writes `context_facts.jsonl` in the project root, one line per string per target language, with only the facts that language forces for that string. Each fact has a `status` plus:

- `resolved` — `value` and `source` (file citation, `column:<name>`, URL, string id, or `user`)
- `candidate` — `value` and `reason`
- `conflict` — `readings` (each with its source)
- `open` — nothing else

```json
{"id": "120", "file": "dialog.csv", "row": 120, "lang": "fr", "facts": {"speaker_gender": {"status": "resolved", "value": "female", "source": "context/characters.md#mira"}, "formality": {"status": "open"}, "pronoun_referent": {"status": "candidate", "value": "the captain", "reason": "previous line names the captain; not confirmed"}}}
```

Test the tool on a small sample before running it on the full file. Count the unresolved (`open`, `candidate`, `conflict`) facts per type and language.

**Questions.** Use the flow's question list. Skip any question whose string count is 0. Phrase questions about facts, not about sections — "Who speaks rows 120 to 340, and to whom?", not "Please provide a social graph". Rank them by how many strings an answer would unblock (strings where it resolves at least one unresolved fact). Show the coverage table and at most 5 questions; every other question goes only to `client_questions.md`.

**Screenshots.** Link them in the order in `CONTEXT_REQUIREMENTS.md`: a table column, then a file named after the string key or row, then a capture spec. `screenshot_coverage` is the fraction of strings linked to a screenshot (0.0–1.0). Every flow needs screenshots for UI strings. If none are linked, one of the 5 questions is the single screenshot ask — screenshots in a column, files named by key, or a playable build. Ask it once. If they have a playable build and want automated capture, write a runner spec into `tools/` (Playwright for browser, PyAutoGUI for desktop, Appium for mobile) and don't run it without explicit later permission. If the content has no UI, the status is `not needed for this content type` and there is no screenshot question.

**Client question list.** Write `client_questions.md` in the project root, for the project manager to forward to the client. Deduplicate. Each question records the fact type, the affected languages, the number of strings it unblocks, and 2 example rows:

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

Don't wait for answers before 1.3. Whenever the user answers — during the 1.5 confirmation or later — set the fact to `resolved` with source `user` in `context_facts.jsonl` (and `context_pack.json` if it's a project-level object), and update `client_questions.md`.

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
  "non_latin_langs": [],
  "glossary_id": null,
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

## 1.5 Project summary

Before any translation work, output a summary and wait for user confirmation:

> **Project summary**
> - Project type: [games / edtech / fintech / saas / general] — [declared / inferred / default] [· per-file flows for `general`] [· note any mismatch with what the files contain]
> - Content: [what is being translated — e.g. "RPG game — UI labels, VO lines, lore, achievements"]
> - Source: [language] · [field/column] · [file(s)]
> - Targets: [list of target languages]
> - Existing translations: [per language: N of M segments already translated — kept, not re-translated]
> - Context: [one line per present or partial section — section, status, source file; "no client context files found" if none] · screenshot coverage [N%]
> - Open facts: [unresolved facts per target language, and the single top question — full list in `client_questions.md`]
> - Fluency checks: [none / isolated / context / both]
> - Glossary: [N active terms / empty / missing]
> - Tools available: [list of scripts in tools/]
>
> Does this look right? If anything is wrong, tell me now before I proceed.

Do not start Phase 2 until the user confirms or corrects this summary.

## Next

Once the user has confirmed the project summary (1.5), continue with Phase 2 — invoke the `glossary` skill (`algebras-agent:glossary`) if skill invocation is available in this session, otherwise open and follow `skills/glossary/SKILL.md` in full.
