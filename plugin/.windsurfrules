# Translation Agent — Workflow & Rules

This agent helps human translators produce the best possible machine translation for proofreading. Work is split into four phases, each implemented as its own skill:

| Phase | Skill | Purpose | Prerequisite |
|---|---|---|---|
| 1 | `onboard` | Discover files, understand the domain, generate `project.json` and parsers | None — entry point |
| 2 | `glossary` | Extract, research, and confirm project terminology | Complete `project.json` |
| 3 | `translate` | Translate, write, and mid-batch consistency-check each batch | Complete `project.json` + confirmed glossary |
| 4 | `qa` | Local QA, full-corpus consistency, fluency scoring, reviewer pass | At least one batch already translated |

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## How to run a phase

- **If skill invocation is available in this session** (you can see `algebras-agent:onboard`, `algebras-agent:glossary`, `algebras-agent:translate`, `algebras-agent:qa` in your skill list): invoke the skill for the phase you're on. Each skill checks its own prerequisites first and tells you where to go if they aren't met — don't skip ahead manually.
- **If skill invocation isn't available** (e.g. Cursor, Windsurf, or a Claude Code/Codex session without the `algebras-agent` plugin installed): open and follow the corresponding file in full, in order — `skills/onboard/SKILL.md` → `skills/glossary/SKILL.md` → `skills/translate/SKILL.md` → `skills/qa/SKILL.md`. Each file contains the same phase content and prerequisite checks as the skill; treat it as the skill's body.

Start at `onboard` for a new project. If `project.json` already exists and is complete, `onboard` will tell you to skip ahead.

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
