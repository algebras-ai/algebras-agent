---
name: onboard
description: Phase 1 of the Algebras translation workflow (Project Onboarding) — discover source files, classify client context, report gaps without blocking, and generate project.json and parsing tools. Entry point of the pipeline; run at the start of every new session or whenever project.json is missing or incomplete.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep]
---

# Phase 1 — Project Onboarding

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## Prerequisites

- None — this is the entry point of the four-phase pipeline (**Onboard → Glossary → Translate → QA**).
- If `project.json` already exists at the project root and every field is populated with real, non-placeholder values, this phase is already satisfied: confirm that with the user and move straight to the `glossary` skill (`algebras-agent:glossary`, or read `skills/glossary/SKILL.md` if skill invocation isn't available in this session). A file that lacks `context_files`, `context_coverage`, `screenshot_coverage`, or `client_questions_file` is incomplete — run 1.2b and fill those fields instead of skipping ahead.

## 1.1 Discover source files

List all files in the working directory recursively. Identify candidate translation files by reading their contents — look for bilingual tables, string IDs, subtitle cue blocks, key-value pairs, or any structure that pairs source text with target language slots. Do not filter by extension.

After the translation files are identified, classify every other file in the folder against the eight sections of `CONTEXT_REQUIREMENTS.md` (Glossary, History & decisions, Universe, Tone of voice, Social graph, UX screenshots, Integrations, Files). Read each file's contents and classify by content, not by file name. Do not modify client context files. A file that contains two sections is listed under both. Settled decisions in History & decisions are sources for resolved facts; open questions already written there go to the client question list and are not asked again.

## 1.2 Understand the domain

Read a representative sample of source strings (at minimum 30–50 rows or the full file if small). Determine:

- **Content type**: game (VO lines, UI labels, lore, achievements, item names), software UI, legal document, marketing copy, subtitles, website, mixed
- **Register and formality**: casual, formal, technical, child-friendly, etc.
- **Source language** and all **target languages**
- **File structure**: how source text and translations are organized (columns, rows, nested keys, tagged segments, etc.)
- **Notable constraints**: timing sensitivity (VO/subtitles), placeholder syntax, profanity level, character limits

If anything is ambiguous, ask the user before proceeding.

## 1.2b Context intake

This step never blocks the pipeline. Show one coverage table and at most 5 questions, then continue whether or not the user answers.

Read `CONTEXT_REQUIREMENTS.md` and compare the files classified in 1.1 with the facts each target language forces.

**Coverage table.** One row per section, for example:

| Section | Status | Source file | Strings that depend on it |
|---|---|---|---|
| Tone of voice | partial | context/tone.md | 180 |

Status is `present`, `partial`, `missing`, or `not needed for this content type`. `present` means the file covers the facts this content type needs from that section. `partial` means a file was classified there but some of those facts are still open. Count strings for which that section is the natural source of a language-forced fact or of a disambiguation the source text does not contain. Sections that are not needed for this content type show a count of 0.

**Facts per string.** For each target language, decide which language-forced facts each string needs (speaker gender, addressee gender, addressee number, formality, pronoun referent, placeholder meaning). Re-check the guidance table in `CONTEXT_REQUIREMENTS.md` for the actual target languages. A fact is resolved only from a cited source: a client file, a column in the source table (`Speaker`, `Addressee`, `Comment`, `Context`, `Max length`, `Screenshot`, or a column that plays the same role), or an explicit user answer. An inference stays a `candidate` until the user confirms it — a line in parentheses that looks like the protagonist's thought is a candidate, not a resolved speaker. Anything else stays `open`. Do not guess.

Generate a reusable tool, `tools/context_facts.py`, if `tools/` does not already have one. Build it on the Phase 1 parser. If no parser exists yet, generate one now under the same rules as 1.4, and let 1.4 reuse it. The tool is generic: no hardcoded column names, language codes, or row ranges. Pass the column roles, languages, and file paths discovered in this project as arguments. Do not bake those values into the script. It writes `context_facts.jsonl` in the project root, one line per string per language. Include only the facts that language forces for that string. Each fact is one of:

- `resolved` — `value` plus `source` (file citation, `column:<name>`, or `user`)
- `candidate` — `value` plus `reason` (an inference, not confirmed)
- `open` — no value

```json
{"id": "120", "file": "dialog.csv", "row": 120, "lang": "fr", "facts": {"speaker_gender": {"status": "resolved", "value": "female", "source": "context/characters.md#mira"}, "formality": {"status": "open"}, "pronoun_referent": {"status": "candidate", "value": "the captain", "reason": "previous line names the captain; not confirmed"}}}
```

Test the tool on a small sample before running it on the full file. Count unresolved (`open` and `candidate`) facts per type.

**Questions.** Group open facts into questions about facts, not about sections. "Who speaks rows 120 to 340, and to whom?" is the right shape. "Please provide a social graph" is not. Rank questions by how many strings an answer would unblock (strings for which the answer resolves at least one open fact). Show the coverage table and at most 5 questions. Every other question goes only to `client_questions.md`.

**Screenshots.** Link them in the priority order in `CONTEXT_REQUIREMENTS.md`: a table column, then a file name matching the string key or row, then a capture spec. `screenshot_coverage` is the fraction of strings linked to a screenshot, from 0.0 to 1.0. If none are linked and the content type needs screenshots (UI, games), one of the 5 questions is the single screenshot ask: whether the client has screenshots in a column or in files named by key, or a playable build. Ask it once. If they have a playable build and want automated capture, write a runner spec into `tools/` (Playwright for browser, PyAutoGUI for desktop, or Appium for mobile) and do not run it without an explicit later permission. Otherwise record the coverage and move on. If screenshots are not needed, status is `not needed for this content type` and there is no screenshot question.

**Client question list.** Write `client_questions.md` in the project root. This file is for the project manager to forward to the client. Deduplicate questions. Each one records the fact type, the affected languages, the number of strings it unblocks, and 2 example rows:

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

Do not wait for answers before 1.3. If the user answers during the 1.5 confirmation or later, update `context_facts.jsonl` and `client_questions.md` before translating: set the fact to `resolved` with source `user`.

## 1.3 Generate project.json

Write `project.json` based on what you've discovered. Do not copy a template — derive every field from the actual files:

```json
{
  "name": "<project name inferred from content or filename>",
  "domain": "<game|software|legal|marketing|subtitles|document|other>",
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
  "client_questions_file": "client_questions.md"
}
```

`glossary_id` stays `null` here — the `glossary` skill (Phase 2) creates the glossary on the Algebras platform and fills this in. There is no local glossary directory or file to set up.

Fill the four context fields from 1.2b. Keep every other field as above. Section keys are `glossary`, `history`, `universe`, `tone_of_voice`, `social_graph`, `screenshots`, `integrations`, `files`. Use `[]` when a section has no file. Store `not_needed` for "not needed for this content type". `screenshot_coverage` is a fraction from 0.0 to 1.0. `client_questions_file` is `client_questions.md`.

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
> - Content: [what is being translated — e.g. "RPG game — UI labels, VO lines, lore, achievements"]
> - Source: [language] · [field/column] · [file(s)]
> - Targets: [list of target languages]
> - Glossary: [N active terms / empty / missing]
> - Tools available: [list of scripts in tools/]
> - Context: [one line per present or partial section — section, status, source file. Omit missing and not-needed sections. If none are present or partial: "no client context files found"]
> - Open facts: [count of open facts per target language, and the single top question]
>
> Does this look right? If anything is wrong, tell me now before I proceed.

Do not start Phase 2 until the user confirms or corrects this summary.

## Next

Once the user has confirmed the project summary (1.5), continue with Phase 2 — invoke the `glossary` skill (`algebras-agent:glossary`) if skill invocation is available in this session, otherwise open and follow `skills/glossary/SKILL.md` in full.
