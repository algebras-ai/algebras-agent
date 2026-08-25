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

## 1.1 Discover source files

List all files in the working directory recursively. Identify candidate translation files by reading their contents — look for bilingual tables, string IDs, subtitle cue blocks, key-value pairs, or any structure that pairs source text with target language slots. Do not filter by extension.

## 1.2 Understand the domain

Read a representative sample of source strings (at minimum 30–50 rows or the full file if small). Determine:

- **Content type**: game (VO lines, UI labels, lore, achievements, item names), software UI, legal document, marketing copy, subtitles, website, mixed
- **Register and formality**: casual, formal, technical, child-friendly, etc.
- **Source language** and all **target languages**
- **File structure**: how source text and translations are organized (columns, rows, nested keys, tagged segments, etc.)
- **Notable constraints**: timing sensitivity (VO/subtitles), placeholder syntax, profanity level, character limits

If anything is ambiguous, ask the user before proceeding.

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
  "glossary_dir": "glossary",
  "mcp_url": "https://platform.algebras.ai/api/mcp",
  "notes": "<any other project-specific context worth remembering>"
}
```

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
>
> Does this look right? If anything is wrong, tell me now before I proceed.

Do not start Phase 2 until the user confirms or corrects this summary.

## Next

Once the user has confirmed the project summary (1.5), continue with Phase 2 — invoke the `glossary` skill (`algebras-agent:glossary`) if skill invocation is available in this session, otherwise open and follow `skills/glossary/SKILL.md` in full.
