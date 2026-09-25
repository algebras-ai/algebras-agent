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
  "glossary_id": null,
  "mcp_url": "https://platform.algebras.ai/api/mcp",
  "notes": "<any other project-specific context worth remembering>"
}
```

`glossary_id` stays `null` here — Phase 2 creates the glossary on the Algebras platform and fills this in. There is no local glossary directory or file.

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

Glossaries are not local files. They live on the Algebras platform, managed through the `algebras` MCP server's glossary tools (`list_glossaries`, `create_glossary`, `get_glossary`, `create_glossary_term`, `bulk_create_glossary_terms`, `update_glossary_term`, `delete_glossary_term`, `list_glossary_terms`), and referenced from translation calls by `glossaryId`.

### 2.1 Check glossary state

If `project.json`'s `glossary_id` is already set, call `get_glossary` with it and use that as the current state. If it's `null`: call `list_glossaries` first to avoid creating a duplicate for a project that already has one, otherwise call `create_glossary` with a name derived from the project and `languages` set to `source_lang` plus every `target_langs` entry. Write the returned `id` into `project.json`'s `glossary_id` right away.

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
- If multiple translations coexist, pick the most authoritative one to propose — the platform's glossary schema has no separate "variants" slot.
- If a translation is known to be misleading, don't create a term for it — there's no `forbidden` concept on the platform; just flag the risk for the QA phase instead.

### 2.4 Confirm with user

Present your proposals before creating anything. For terms where you're uncertain (confidence = low), flag them explicitly:

> | # | Source term | Definition | [de] | [fr] | Confidence |
> |---|---|---|---|---|---|
> | 1 | Dragon Stone | Rare magical artifact | Drachenstein | Pierre du Dragon | high |
> | 2 | Blink | Teleport dash ability | Blinken? | ? | low — please advise |
>
> **Actions**: Accept all / Edit a row (reply with row number + correction) / Skip a term / Add a term

Do not create a glossary term until the user accepts it. Terms with low confidence must be resolved before translation starts. If the user rejects a suggestion, record the correct form and the reason.

### 2.5 Create the terms

Each accepted row becomes one glossary term with one `definitions[]` entry per language (`language`, `term` = the rendering in that language, `definition` = a short language-neutral gloss reused across languages). Push accepted rows from this session in one `bulk_create_glossary_terms` call against `glossary_id` (or `create_glossary_term` for a single term added mid-translation). Check the response for partial failures and surface them to the user — the platform enforces the schema on write, so there's no separate local validation step.

---

## Phase 3 — Translation

### 3.1 State rules before each batch

Before translating any batch, declare:
- Target locale, register, and formality level
- Glossary terms that apply to this batch
- Domain-specific constraints (timing sensitivity, placeholder syntax, profanity intensity, character limits)

### 3.2 Translate — three steps per batch

Fluency is measured **once**, on the pre-glossary translation, and never again — a product decision, not a technical default. Every batch goes through the `algebras` MCP server's tools in exactly this order, as three separate calls — never generate the translated text yourself, never combine steps, and never skip straight to step 3:

**Step 1 — no-glossary translation.** Call `translate_batch` (or `translate_text` for a single string) **without** `glossaryId` and **without** `fluency`. Throwaway translation — don't write it, don't show it as the result. Its only purpose is to feed step 2.

**Step 2 — measure fluency, as its own call.** Call `check_fluency_batch` (or `check_fluency` for a single string) with `items` built from step 1's `{sourceText, translatedText}` pairs — a genuinely separate tool from `translate_batch`, not the `fluency: true` inline flag. Append one line per string to `tools/fluency_scores.jsonl`: `{"id": "...", "sourceLang": "en", "targetLang": "de", "sourceText": "...", "fluency": {...} }` — use `"fluency": null` if the API skipped scoring (long text) rather than omitting the row. This log is the **only** source of fluency data from here on — never call `check_fluency`/`check_fluency_batch` again, and never pass `fluency: true` on any translate call, for a string that already has an entry here, even if it gets revised later.

**Step 3 — final, with glossary.** Call `translate_batch`/`translate_text` again on the same texts, this time **with** `glossaryId` = `project.json`'s `glossary_id`, and without `fluency`. This call's output is what actually gets written in 3.3. Step 1's translation is discarded.

Chunk steps 1 and 3 to ≤20 texts per call (the API's hard cap); step 2's `check_fluency_batch` shares the same cap, so keep chunking consistent across all three. Pick the tool per step, independently:
- Steps 1 and 3 — `translate_batch` is the default; `translate_batch_async` + poll `get_translate_batch_async_status` when overlapping the wait actually helps (dispatching several chunks or several steps concurrently). No fixed size rule — use your judgment.
- `translate_text`/`check_fluency` — single strings only. A revision of an already-scored string skips straight to step 3; it doesn't get a second score.
- **Agentic pipeline** (`POST /translation/agentic-translate`, then poll `GET /translation/agentic-translate/{id}` via `curl -H "X-Api-Key: $ALGEBRAS_API_KEY" "$ALGEBRAS_PLATFORM_URL/api/v1/translation/agentic-translate..."`) — the one direct-HTTP case, since no MCP tool wraps it. Reserve for the step-3 call on high-value strings; it costs **4x** a normal call. Steps 1-2's score still come from ordinary calls as above — don't call `check_fluency` on the agentic result afterward.

Pass `contexts` (per-text, aligned by index) on both translate steps whenever row-level context would help.

**Apply glossary terms exactly (step 3).** For source terms not yet in the glossary:
1. Search the web for established translations before coining your own.
2. If a reliable translation exists, create it immediately via `create_glossary_term` (see Phase 2's 2.5) rather than waiting until end of batch.
3. If you're unsure, flag the term and ask the user before translating.

The API doesn't know your project's markup conventions unless you tell it — after step 3's response, verify yourself: all tags `<...>`, placeholders `{...}`, variables, numbers, and markup preserved exactly; speaker intent, addressee, register, and intensity matched. Use `prompt` to steer a chunk (e.g. "preserve all `{placeholder}` tokens exactly") and re-translate via `translate_text` (with `glossaryId`, no `fluency`) rather than hand-editing the API's output.

For credits: translate roles and departments; preserve person names, company names, engine names, and middleware names unchanged — convey this via `prompt` if needed.

### 3.3 Parse and write using generated tools

Use the parser from Phase 1 to write results. Write only step 3's (glossary-applied) output — never step 1's throwaway translation. Write only the target language field/column for the requested rows. Never overwrite source text or other columns. If no suitable tool exists, generate one before writing.

Verify the exact edited cells by parsing the file again after writing.

---

## Phase 4 — QA Review

### 4.1 Local QA

After each translation batch, run all available tools in `tools/`. Common checks:
- **Glossary terminology** — terms used correctly; fetch current terms via the `list_glossary_terms` MCP tool against `project.json`'s `glossary_id` (the glossary is a platform record, not a local file) and match against each term's per-language `definitions[].term`
- **Length expansion** — text length within safe bounds
- **Numeric preservation** — all numbers match source
- **Mixed-language / source leakage** — no untranslated segments

If a needed QA tool doesn't exist, generate it and run it. Generate tools generically — no hardcoded row ranges or project-specific logic.

Treat every row-level finding as an issue to fix, clarify with the user, or explicitly accept as an exception.

### 4.2 Fluency (already measured during translation)

Fluency is measured exactly once per string, by Phase 3's 3.2 step 2 (`check_fluency_batch`/`check_fluency`, a separate call from the step-1 no-glossary translation) — before this phase ever runs. **Never call `check_fluency`/`check_fluency_batch` again, and never pass `fluency: true` on a translate call, for a string that already has an entry in `tools/fluency_scores.jsonl`** — that includes strings you're about to revise in 4.3. This phase's job is to read and report that log, not generate new scores.

Read `tools/fluency_scores.jsonl` for the rows/languages in scope:

| Score | Meaning |
|---|---|
| 8–10 | Strong |
| 6–7 | Minor issues |
| 4–5 | Notable issues (`main_issue`/`suggested_fix` on the logged entry) |
| 1–3 | Weak |
| `null` | Skipped by the API (long text) — report as unscored, not a failure |

These scores describe step 1's *pre-glossary* translation, not the step-3, glossary-applied text actually written in 3.3 — the two can read differently. Treat the log as a diagnostic about translation quality independent of glossary effects, not a gate on the shipped text: **do not revise a string because of its fluency score, and do not re-score anything here.** A string revised for another reason keeps its original score — it does not get a new one.

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

Apply only user-approved edits. Re-run 4.1's local QA on the edited rows — not fluency; an edited string keeps its original 4.2 score rather than getting a new one. Report results.

### 4.4 Final report

After each batch:
- Row range and languages processed
- QA findings by type and count
- Fluency scores from `tools/fluency_scores.jsonl` (min, mean, any below 6, any `null`/unscored) — labeled as the pre-glossary baseline, not a score of the shipped text
- Edits applied
- Remaining issues for user review

---

## Standing Rules

### File safety

- Always use a parser to read and write translation files — never edit with text manipulation tools (sed, awk, string replace).
- Write only to the requested target field/column and row range.
- Report data row numbers as 1-based excluding headers.

### Glossary

- Glossaries live on the Algebras platform, not as local files. Create, read, update, and delete terms through the `algebras` MCP server's glossary tools (`create_glossary_term`, `list_glossary_terms`, `update_glossary_term`, `delete_glossary_term`, etc.), and keep the working glossary's id in `project.json`'s `glossary_id`.
- Add valid inflected forms as their own term definitions when QA flags a correct translation.
- Never rebuild the glossary from scratch unless the user explicitly asks — update or delete individual terms instead.

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
