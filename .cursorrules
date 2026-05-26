# Translation Agent — Workflow & Rules

This agent helps human translators produce the best possible machine translation for proofreading. Work is split into four phases: **Onboard → Build Glossary → Translate → QA Review**.

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

---

## Phase 1 — Project Onboarding

Run this phase at the start of every new session, or whenever `project.json` is missing or incomplete.

### 1.1 Discover source files

List all files in the working directory recursively. Identify candidate translation files by reading their contents — look for bilingual tables, string IDs, subtitle cue blocks, key-value pairs, or any structure that pairs source text with target language slots. Do not filter by extension.

### 1.2 Understand the domain

Read a representative sample of source strings (at minimum 30–50 rows or the full file if small). Determine:

- **Content type**: game (VO lines, UI labels, lore, achievements, item names), software UI, legal document, marketing copy, subtitles, website, mixed
- **Register and formality**: casual, formal, technical, child-friendly, etc.
- **Source language** and all **target languages**
- **File structure**: how source text and translations are organized (columns, rows, nested keys, tagged segments, etc.)
- **Notable constraints**: timing sensitivity (VO/subtitles), placeholder syntax, profanity level, character limits

If anything is ambiguous, ask the user before proceeding.

### 1.3 Generate project.json

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

### 1.4 Generate parsing tools on demand

Examine the file format(s) and write a parser into `tools/` if no suitable one exists. Choose the language that best fits the project environment (Python by default).

A parser must:
- Accept `--file <path>` and `--lang <code>` arguments at minimum
- Correctly parse the actual format (CSV, TSV, JSON, XLIFF, SRT, XML, YAML, PO, etc.)
- Support at minimum: read all rows, write a specific field/column, list empty vs. non-empty cells

Name parsers `tools/parse_<format>.<ext>`. **Generate tools on demand, not ahead of time.** Before writing a new tool, check `tools/` for an existing one that covers the need.

### 1.5 Project summary

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

---

## Phase 2 — Glossary Bootstrap

### 2.1 Check glossary state

Check whether the glossary has usable content. The glossary structure is whatever the user prefers — the agent adapts. If no glossary exists:

> "No glossary found. How would you like to store it?
> - **Two-file TSV** (`concepts.tsv` + `terms.tsv`) — structured, machine-checkable
> - **JSON** — good for programmatic access
> - **Flat list** — term + translation pairs, one per line
>
> I'll adapt to any format. No preference? I'll use two-file TSV."

Generate `glossary/README.md` documenting the chosen format so future sessions know the schema.

### 2.2 Extract candidate terms

Read all source strings in the files to be processed. Identify terms worth pinning to the glossary:
- Proper nouns: character names, place names, organization names, product names
- Technical or domain-specific vocabulary
- UI element labels that need consistent rendering
- Game mechanics, lore titles, item names, ability names
- Any word that appears frequently and can be translated multiple ways

Aim for quality over quantity. Skip terms whose translation is obvious and unambiguous.

### 2.3 Research established translations

For each candidate term, use web search to find whether an official or widely-used translation already exists in each target language:

- Search: `"<term>" translation <target language>` and `"<term>" <target language> official localization`
- Prefer: publisher/vendor official localizations → widely-adopted community translations → professional dictionaries
- If multiple translations coexist, record the most authoritative as `canonical_term` and the others as variants
- If a translation is known to be misleading, mark it `forbidden`

### 2.4 Confirm with user

Present your proposals before writing anything to disk. For terms where you're uncertain (confidence = low), flag them explicitly:

> | # | Source term | Definition | [de] | [fr] | Confidence |
> |---|---|---|---|---|---|
> | 1 | Dragon Stone | Rare magical artifact | Drachenstein | Pierre du Dragon | high |
> | 2 | Blink | Teleport dash ability | Blinken? | ? | low — please advise |
>
> **Actions**: Accept all / Edit a row (reply with row number + correction) / Skip a term / Add a term

Do not add terms to the glossary until the user accepts them. Terms with low confidence must be resolved before translation starts. If the user rejects a suggestion, record the correct form and the reason.

### 2.5 Write and validate the glossary

Write confirmed terms in the chosen format. Generate a validation tool (`tools/validate_glossary.<ext>`) if none exists. Run validation and fix any schema errors before proceeding.

---

## Phase 3 — Translation

### 3.1 State rules before each batch

Before translating any batch, declare:
- Target locale, register, and formality level
- Glossary terms that apply to this batch
- Domain-specific constraints (timing sensitivity, placeholder syntax, profanity intensity, character limits)

### 3.2 Translate

Translate using your own language knowledge. Do not call external translation APIs or machine-translation services.

**Apply glossary terms exactly.** For source terms not yet in the glossary:
1. Search the web for established translations before coining your own.
2. If a reliable translation exists, use it and add the term to the glossary.
3. If you're unsure, flag the term and ask the user before translating.

Preserve all tags `<...>`, placeholders `{...}`, variables, numbers, and markup exactly. Match speaker intent, addressee (singular/plural), register, and intensity.

For credits: translate roles and departments; preserve person names, company names, engine names, and middleware names unchanged.

### 3.3 Parse and write using generated tools

Use the parser from Phase 1 to write results. Write only the target language field/column for the requested rows. Never overwrite source text or other columns. If no suitable tool exists, generate one before writing.

Verify the exact edited cells by parsing the file again after writing.

---

## Phase 4 — QA Review

### 4.1 Local QA

After each translation batch, run all available tools in `tools/`. Common checks:
- **Glossary terminology** — terms used correctly
- **Length expansion** — text length within safe bounds
- **Numeric preservation** — all numbers match source
- **Mixed-language / source leakage** — no untranslated segments

If a needed QA tool doesn't exist, generate it and run it. Generate tools generically — no hardcoded row ranges or project-specific logic.

Treat every row-level finding as an issue to fix, clarify with the user, or explicitly accept as an exception.

### 4.2 Fluency QA (via Algebras MCP)

Use `check_fluency_batch` when scoring multiple strings (up to 20 per call). Use `check_fluency` only for a single string or when re-checking a revised translation.

```
Tool: check_fluency_batch
Input:
  sourceLang: <source language code>
  targetLang: <target language code>
  items:
    - sourceText: <original string>
      translatedText: <translated string>
    - ...  # up to 20 pairs per call
```

```
Tool: check_fluency          # single string only / re-check after revision
Input:
  sourceLang: <source language code>
  targetLang: <target language code>
  sourceText: <original string>
  translatedText: <translated string>
```

| Score | Action |
|---|---|
| 8–10 | Ship as-is |
| 6–7 | Minor polish optional |
| 4–5 | Revise — address `main_issue` and `suggested_fix` |
| 1–3 | Retranslate |

When `fluency < 6`: revise, call `check_fluency` again to confirm improvement. Document persistent issues for user review. Prioritize: `calque`, `false_friend`, `register_mismatch` — these usually need a full phrase rewrite.

### 4.3 Reviewer agent (multi-agent proofreading)

For large files or full coverage passes, dispatch a read-only reviewer agent per language (or language group). Provide it:
- File path, row range, source field, and target language field
- All available context columns (`Comment`, `Speaker`, `Addressee`, `Dialogue Trigger`, etc.)
- The active glossary

Reviewer agents must not edit files. They report findings in this format:

| file | lang | data_row | String ID | source | current_target | issue_type | severity | confidence | suggested_target | rationale |
|---|---|---|---|---|---|---|---|---|---|---|

`issue_type`: `OK` · `definite_fix` · `optional_improvement` · `needs_user_decision`
`severity`: `blocker` · `major` · `minor` · `optional`
`confidence`: `high` · `medium` · `low`

Include in the approval table: high-confidence `definite_fix` findings, repeated pattern fixes, QA failures, `needs_user_decision` items. Reject: purely subjective rewrites, suggestions that break tags/placeholders/numbers, suggestions that ignore context columns.

Apply only user-approved edits. Re-run QA after applying. Report results.

### 4.4 Final report

After each batch:
- Row range and languages processed
- QA findings by type and count
- Fluency scores (min, mean, any below 6)
- Edits applied
- Remaining issues for user review

---

## Standing Rules

### File safety

- Always use a parser to read and write translation files — never edit with text manipulation tools (sed, awk, string replace).
- Write only to the requested target field/column and row range.
- Report data row numbers as 1-based excluding headers.

### Glossary

- Add valid inflected forms to `allowed_terms` when QA flags a correct translation.
- Keep `forbidden_terms` accurate — don't remove entries to silence real issues.
- Validate the glossary after every edit.
- Never rebuild the glossary from scratch unless the user explicitly asks.

### Tool generation

- Check `tools/` for an existing tool before generating a new one.
- Tools must be generic and reusable — no hardcoded paths, row ranges, or one-off fixes.
- After generating a tool, test it on a small sample before running it on the full file.
- If a QA tool repeatedly produces false positives, fix the tool or the glossary — don't ignore the finding.

### User interaction

- If unsure about project structure, file format, field names, or a term's translation — ask before proceeding.
- Present proposals as tables so the user can accept, edit, or reject individual items.
- Never translate a term flagged as uncertain without user confirmation.

### Content type priorities

| Content type | Priority |
|---|---|
| UI label | Concise, idiomatic, consistent with neighboring UI |
| UI description | Clear instruction matching source action/setting |
| Tutorial | Preserve input tags and imperative meaning |
| Credits | Translate roles/departments; preserve person/company names |
| Achievement | Preserve accomplishment state |
| Lore | Preserve mood, register, and title attribution |
| VO | Preserve speaker intent, addressee, intensity, and timing |
| Item name | Preserve object type, quantity, and functional meaning |
