---
name: onboard
description: Phase 1 of the Algebras translation workflow (Project Onboarding) — discover source files, understand the domain, and generate project.json and parsing tools. Entry point of the pipeline; run at the start of every new session or whenever project.json is missing or incomplete.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep]
---

# Phase 1 — Project Onboarding

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## Prerequisites

- None — this is the entry point of the four-phase pipeline (**Onboard → Glossary → Translate → QA**).
- If `project.json` already exists at the project root and every field is populated with real, non-placeholder values, this phase is already satisfied: confirm that with the user and move straight to the `glossary` skill (`algebras-agent:glossary`, or read `skills/glossary/SKILL.md` if skill invocation isn't available in this session).

## 1.0 Project type

Check whether the user declared a project type — e.g. `Project type: saas` or "Use the games flow" in their prompt. Valid types: `games`, `edtech`, `saas`, `general`. If none was declared, use `general` (don't ask).

Read `PROJECT_TYPES.md` (in the project root, next to this workflow's `CLAUDE.md`/`AGENTS.md`; if it isn't there, fetch `https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin/PROJECT_TYPES.md`) and use the declared type's flow for the rest of the pipeline:
- It tells 1.1 which files to scan first and 1.2b which context files to look for.
- It seeds `domain` in 1.3 (`games` → `game`, `edtech` → `edtech`, `saas` → `software`; `general` → derive it in 1.2). With a declared type, don't ask the user about the domain — only flag it in 1.5 if the files clearly contradict the declared type.

## 1.1 Discover source files

List all files in the working directory recursively. Identify candidate translation files by reading their contents — look for bilingual tables, string IDs, subtitle cue blocks, key-value pairs, or any structure that pairs source text with target language slots. Do not filter by extension. Start with the locations the project type's flow lists under "Scan first", but don't stop there.

## 1.2 Understand the domain

Read a representative sample of source strings (at minimum 30–50 rows or the full file if small). Determine:

- **Content type**: game (VO lines, UI labels, lore, achievements, item names), educational content (lessons, quizzes, course pages), software UI (app strings, emails, help center), legal document, marketing copy, subtitles, website, mixed
- **Register and formality**: casual, formal, technical, child-friendly, etc.
- **Source language** and all **target languages**
- **File structure**: how source text and translations are organized (columns, rows, nested keys, tagged segments, etc.)
- **Notable constraints**: timing sensitivity (VO/subtitles), placeholder syntax, profanity level, character limits

If anything is ambiguous, ask the user before proceeding.

## 1.2b Context files

Look for material that explains the content without being translated itself: specs, design documents, product docs, lore bibles, style guides, brand voice guides, glossaries in other formats, and screenshots of the UI already in the repo. The project type's flow lists what matters most. Record what you find in `project.json`'s `context_files` (relative paths). Don't translate these files unless the user asks — they are reference material for glossary extraction (Phase 2) and for each translation batch (Phase 3).

## 1.2c Existing translations (translation memory)

For each target language, count the segments that already have a non-empty translation. These are the project's translation memory: they are kept as-is, are never sent for translation again (unless the user explicitly asks to retranslate them), and serve as the reference for terminology and style in Phases 2–3. Note the per-language counts for the 1.5 summary.

## 1.3 Generate project.json

Write `project.json` based on what you've discovered. Do not copy a template — derive every field from the actual files:

```json
{
  "name": "<project name inferred from content or filename>",
  "domain": "<game|edtech|software|legal|marketing|subtitles|document|other>",
  "content_type_notes": "<one-sentence description of what is being translated>",
  "source_lang": "<BCP 47 code>",
  "target_langs": ["<code>", "..."],
  "files": ["<relative path>", "..."],
  "context_files": ["<relative path to a spec, doc, lore file, style guide, or screenshot>", "..."],
  "source_field": "<column name, JSON key, or XPath — whatever locates source text>",
  "target_fields": {
    "<lang_code>": "<column name / key>"
  },
  "non_latin_langs": [],
  "glossary_id": null,
  "mcp_url": "https://platform.algebras.ai/api/mcp",
  "notes": "<any other project-specific context worth remembering>"
}
```

`domain` is what later phases use to pick the flow from `PROJECT_TYPES.md` (`game` → games, `edtech` → edtech, `software` → saas, anything else → general), so a declared project type must be reflected here.

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
> - Project type: [games / edtech / saas / general] — [declared / default] [· note any mismatch with what the files contain]
> - Content: [what is being translated — e.g. "RPG game — UI labels, VO lines, lore, achievements"]
> - Source: [language] · [field/column] · [file(s)]
> - Targets: [list of target languages]
> - Existing translations: [per language: N of M segments already translated — kept, not re-translated]
> - Context files: [N found — list the most relevant few]
> - Glossary: [N active terms / empty / missing]
> - Tools available: [list of scripts in tools/]
>
> Does this look right? If anything is wrong, tell me now before I proceed.

Do not start Phase 2 until the user confirms or corrects this summary.

## Next

Once the user has confirmed the project summary (1.5), continue with Phase 2 — invoke the `glossary` skill (`algebras-agent:glossary`) if skill invocation is available in this session, otherwise open and follow `skills/glossary/SKILL.md` in full.
