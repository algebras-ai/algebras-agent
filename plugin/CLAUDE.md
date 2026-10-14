# Translation Agent — Workflow & Rules

This agent helps human translators produce the best possible machine translation for proofreading. Work is split into four phases, each implemented as its own skill:

| Phase | Skill | Purpose | Prerequisite |
|---|---|---|---|
| 1 | `onboard` | Discover files, understand the domain, generate `project.json` and parsers | None — entry point |
| 2 | `glossary` | Extract, research, and confirm project terminology | Complete `project.json` |
| 3 | `translate` | Translate each batch in three steps — no-glossary translation, separate fluency measurement, then the final glossary-applied translation that gets written — and mid-batch consistency-check it | Complete `project.json` + confirmed glossary |
| 4 | `qa` | Local QA, full-corpus consistency, reviewer pass, and reporting the fluency baseline `translate` already captured (never re-measured) | At least one batch already translated |

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## How to run a phase

- **If skill invocation is available in this session** (you can see `algebras-agent:onboard`, `algebras-agent:glossary`, `algebras-agent:translate`, `algebras-agent:qa` in your skill list): invoke the skill for the phase you're on. Each skill checks its own prerequisites first and tells you where to go if they aren't met — don't skip ahead manually.
- **If skill invocation isn't available** (e.g. Cursor, Windsurf, or a Claude Code/Codex session without the `algebras-agent` plugin installed): open and follow the corresponding file in full, in order — `skills/onboard/SKILL.md` → `skills/glossary/SKILL.md` → `skills/translate/SKILL.md` → `skills/qa/SKILL.md`. Each file contains the same phase content and prerequisite checks as the skill; treat it as the skill's body.

Start at `onboard` for a new project. If `project.json` already exists and is complete, `onboard` will tell you to skip ahead.

## Project types

The user may declare a project type — `Project type: games|edtech|saas|general`, or "Use the `<type>` flow". Each type is a flow defined in `PROJECT_TYPES.md`: what to scan first, which context files to look for, what the glossary and QA should emphasize. The pipeline stays the same. `onboard` (1.0) reads the declared type (default `general`) and records it as `project.json`'s `domain`; later phases read the flow back from `domain`.

## Delivery

In a git repository, the work lands on its own branch (`algebras/localize-<YYYYMMDD>`, created in `translate` 3.0 with the user's confirmation) and is committed at the end of `qa` (4.6), so the user can review it like any other change. Never push or open a pull request unless the user asks.

---

## Standing Rules

### File safety

- Always use a parser to read and write translation files — never edit with text manipulation tools (sed, awk, string replace).
- Write only to the requested target field/column and row range.
- Report data row numbers as 1-based excluding headers.

### Glossary

- Glossaries live on the Algebras platform, not as local files. Create, read, update, and delete terms through the `algebras` MCP server's glossary tools (`create_glossary_term`, `list_glossary_terms`, `update_glossary_term`, `delete_glossary_term`, `count_glossary_terms`, etc.), and keep the working glossary's id in `project.json`'s `glossary_id`.
- Add valid inflected forms as their own term definitions when QA flags a correct translation.
- Never rebuild the glossary from scratch unless the user explicitly asks — update or delete individual terms instead.
- Optional deduplication across all glossary terms is available once a glossary exists — always ask the user first, never run automatically. See the `translate` skill's pre-batch step, or invoke the `glossary-dedupe` skill (`algebras-agent:glossary-dedupe`) directly at any time.

### Tool generation

- Check `tools/` for an existing tool before generating a new one.
- Tools must be generic and reusable — no hardcoded paths, row ranges, or one-off fixes.
- After generating a tool, test it on a small sample before running it on the full file.
- If a QA tool repeatedly produces false positives, fix the tool or the glossary — don't ignore the finding.
- Never mass-accept or mass-reject a batch of consistency findings from `check_term_consistency`. Review and log each one individually (see the `translate` skill's 3.4 and the `qa` skill's 4.2).

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
| Lesson | Keep explanations unambiguous and at the stated reading level |
| Quiz item | Preserve the question's meaning, answer-option order, and which option is correct |
| Email | Keep subject lines short; preserve placeholders, links, and the product's address form |
| Help article | UI labels referenced in the text must match the translated UI exactly |
