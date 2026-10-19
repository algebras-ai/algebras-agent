# Translation Agent — Workflow & Rules

This agent helps human translators produce the best possible machine translation for proofreading. Work is split into four phases, each implemented as its own skill:

| Phase | Skill | Purpose | Prerequisite |
|---|---|---|---|
| 1 | `onboard` | Discover files, pick the flow, take in client context (coverage, facts, client questions), choose the fluency checks, generate `project.json` and parsers | None — entry point |
| 2 | `glossary` | Extract, research, and confirm project terminology | Complete `project.json` |
| 3 | `translate` | Check each batch for ambiguity, translate it with the glossary and resolved facts, measure fluency as the project's setting says (context-free, context-aware, both, or none), and mid-batch consistency-check it | Complete `project.json` + confirmed glossary |
| 4 | `qa` | Local QA with the flow's checks, full-corpus consistency, reviewer pass, and reporting the fluency scores `translate` already captured (no new calls) plus context coverage | At least one batch already translated |

The agent is format-agnostic. Do not assume any particular file extension, column structure, or glossary format. Generate tools and config on demand as you learn the project.

## How to run a phase

- **If skill invocation is available in this session** (you can see `algebras-agent:onboard`, `algebras-agent:glossary`, `algebras-agent:translate`, `algebras-agent:qa` in your skill list): invoke the skill for the phase you're on. Each skill checks its own prerequisites first and tells you where to go if they aren't met — don't skip ahead manually.
- **If skill invocation isn't available** (e.g. Cursor, Windsurf, or a Claude Code/Codex session without the `algebras-agent` plugin installed): open and follow the corresponding file in full, in order — `skills/onboard/SKILL.md` → `skills/glossary/SKILL.md` → `skills/translate/SKILL.md` → `skills/qa/SKILL.md`. Each file contains the same phase content and prerequisite checks as the skill; treat it as the skill's body.

Start at `onboard` for a new project. If `project.json` already exists and is complete, `onboard` will tell you to skip ahead.

## Project types

The user may declare a project type — `Project type: games|edtech|fintech|saas|general`, or "Use the `<type>` flow". Each type is a flow defined in `PROJECT_TYPES.md`: what to scan first, which context facts to collect and which questions to ask, what the glossary, translation and QA should emphasize. What the context sections hold is in `CONTEXT_REQUIREMENTS.md`. The pipeline stays the same. `onboard` reads the declared type (or infers it) and records it as `project.json`'s `project_type`; later phases read the flow from there.

## Fluency checks

`onboard` asks once which fluency checks to run and records it as `project.json`'s `fluency`: `none`, `isolated` (context-free score of a no-glossary translation), `context` (context-aware score of the written text, with neighbor strings and approved choices), or `both`. A `Fluency: <setting>` line in the prompt answers it up front; non-interactive runs default to `isolated`. `translate` runs only the chosen checks, measures each string at most once per mode, and logs both scores separately; `qa` makes no fluency calls except an optional, confirmed pass over unscored strings. All scores are a self-check of the agent's own translation.

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

### Context

- Never guess a context fact. A fact is resolved only from a cited source: a client file, a column in the source table, an official page for the same UI, or an explicit user answer. An inference stays a `candidate` until the user confirms it.
- Missing context never blocks the pipeline. Unresolved facts stay `open`, go to `client_questions.md`, and translation uses wording that does not commit to the unknown fact.
- Ask little at the start. The intake step shows one coverage table and at most 5 questions, ranked by how many strings each answer unblocks. Everything else goes to the client question list.
- Only `resolved` facts and glossary hits are locks — for translation and for context-aware fluency. `agent-choice`, `provisional` and `glossary-candidate` never are.
- What to collect is specified in `CONTEXT_REQUIREMENTS.md`. Which of that a project needs is the flow in `PROJECT_TYPES.md`: `games`, `edtech`, `fintech`, `saas`, or `general`.

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
| Payment status | Use the locked term for that money state |
| Disclaimer | Preserve legal force; do not soften it |
| Help article | UI labels referenced in the text must match the translated UI exactly |
