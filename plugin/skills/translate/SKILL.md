---
name: translate
description: Phase 3 of the Algebras translation workflow (Translation) — check each batch for ambiguity (resolved/open/conflict facts), reuse matching translations from translation memory, translate only the misses via the Algebras MCP tools with the glossary and resolved facts, measure fluency as the project's setting says (context-free on a no-glossary translation, context-aware on the written text with neighbors and locks, both, or none), run a mid-batch consistency check against everything already translated, and fix glossary misses in one final glossary pass after all batches. Requires a completed project.json and a confirmed glossary.
allowed-tools: ["Bash(git rev-parse:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(node tools/run-report.mjs:*)", Read, Write, Edit, Glob, Grep, WebSearch, mcp__algebras__translate_text, mcp__algebras__translate_batch, mcp__algebras__translate_batch_async, mcp__algebras__get_translate_batch_async_status, mcp__algebras__check_fluency, mcp__algebras__check_fluency_batch, mcp__algebras__create_glossary_term, mcp__algebras__set_glossary_term_status, mcp__algebras__list_glossary_terms, mcp__algebras__count_glossary_terms, mcp__algebras__lookup_translation_memory, mcp__algebras__record_translations, mcp__algebras__get_project_context, mcp__algebras__update_project_context, mcp__algebras__list_strings, mcp__algebras__get_string_context, mcp__algebras__update_string_contexts, mcp__algebras__list_context_changes]
---

# Phase 3 — Translation

## Prerequisites

- Requires a complete `project.json` (Phase 1) with a `project_id` (onboard 1.6, or a platform-only project from onboard 1.0). If it's missing or incomplete: invoke the `onboard` skill (`algebras-agent:onboard`) first, or read `skills/onboard/SKILL.md` if skill invocation isn't available in this session.
- Requires a glossary that has been through user confirmation (Phase 2, step 2.4) — an intentionally-empty glossary is fine, as long as the user explicitly agreed to proceed without one. If the glossary hasn't been confirmed yet: invoke the `glossary` skill (`algebras-agent:glossary`) first, or read `skills/glossary/SKILL.md`.
- Never translate against a glossary term still flagged low-confidence — resolve it with the user first.
- Context comes from the Algebras platform project, not from local files (`CONTEXT_REQUIREMENTS.md`, "Where context lives"). This phase needs no `context_pack.json` or `context_facts.jsonl` and never creates them.

## Session start: read the context

Once per session, before the first batch:

1. `get_project_context` with `project.json`'s `project_id`. Keep the project context and its `version`.
2. `list_strings`, following the cursor to the end. Keep each string's context and `version`, and the project's context version as `last_seen_version`.

Keep this in memory. When a local tool needs the context (e.g. `tools/fluency_ctx.py` in 3.3b), write it to `tools/context_cache.json` and pass that file to the tool; it's a disposable copy, refreshed whenever the context is re-read, and never edited by hand.

## Optional: glossary deduplication

Before translating the first batch of the session, if the glossary already has confirmed content (Phase 2): ask the user whether to run a deduplication pass across all glossary terms first, to catch exact duplicates, near-duplicate variants, and conflicting canonical translations before they propagate into translations.

This is optional and must never run without explicit agreement. If the user agrees, invoke the `glossary-dedupe` skill (`algebras-agent:glossary-dedupe`) if skill invocation is available in this session, otherwise read and follow `skills/glossary-dedupe/SKILL.md` in full — it creates the deduplication tool (if one doesn't exist yet) and runs it. If the user declines, skip straight to 3.0.

## 3.0 Branch and checkpoint

Before writing the first translation of the session, set up where the work will land so the user can review it like any other change.

**Skip this step when running non-interactively in CI** (e.g. the Algebras GitHub Action) — the action manages branches and commits itself.

1. Check whether `PROJECT_ROOT` is a git repository (`git rev-parse --is-inside-work-tree`).
2. **Git repository:** if the current branch isn't already an `algebras/localize-*` branch from an earlier session, propose creating `algebras/localize-<YYYYMMDD>` from the current branch (`git checkout -b ...`) and confirm with the user first. If the working tree has uncommitted changes, don't fold them into your work or commit over someone else's in-progress work — ask how they want to handle them first (commit or stash them themselves, carry them onto the branch, or work on the current branch instead). If the user prefers to stay on the current branch, do that.
3. **Not a git repository:** count the total source segments across all files to be translated. If there are **more than 2,000**, propose running `git init` — do not run it silently. Explain why: a baseline makes any future mid-batch tooling issue or bad edit trivially recoverable via `git diff` / `git checkout`. For smaller projects, skip git entirely — a small file doesn't need git ceremony.
4. **Large projects (more than 2,000 source segments):** once a repo exists (new or pre-existing), propose committing the current pre-translation state as a baseline checkpoint (e.g. `git commit -m "pre-translation baseline"`), with the same confirmation and uncommitted-changes rules as step 2.

The `qa` skill's 4.7 commits the result on this branch at the end.

## 3.1 State rules before each batch

**Pull changes first.** People edit context in the platform UI while the agent works. Before each batch, call `list_strings` with `changedSinceVersion` = `last_seen_version`, and `list_context_changes` for who changed what. Replace the changed strings' contexts (and the project context, if it changed) with the fresh copies and advance `last_seen_version`. If a change touches a string in this batch, or a fact a string already written relied on, tell the user what changed and who changed it; for strings already written, list them and ask whether to retranslate.

Read the translation rules for `project.json`'s `project_type` in `PROJECT_TYPES.md`. If `file_flows` names a flow for this file, use that flow's rules instead.

Before translating any batch, declare:
- Target locale, register, and formality level. If formality is not `resolved` for this batch, declare it as open instead of choosing a level.
- Glossary terms that apply to this batch, using the flow's glossary emphasis
- The flow's constraints (timing sensitivity, placeholder syntax, profanity intensity, character limits; for games: tags, VO length, short UI; for edtech: assessment lock and reading level; for fintech: locked statuses and legally locked strings; for saas: ICU and length)
- Which `context_files` (from `project.json`) are relevant to this batch — read them before translating it
- The `resolved` facts for this batch, each with its source, and the facts that are still `open`, `candidate` or in `conflict` — from the platform context read above, after 3.1b
- Which fluency checks run, from `project.json`'s `fluency` (see 3.2)

Only send segments that don't have a translation yet. Segments that are already translated in the repo (onboard 1.2c) are kept as-is and used as reference — don't retranslate or overwrite them unless the user explicitly asks. The batch's untranslated segments go to translation memory first (3.2.0); only its misses are translated in 3.2.

## 3.1b Ambiguity check

Before translating, find what the batch's strings leave undecided — the points where the target language forces a choice the source doesn't make. Work per cluster (strings that share a speaker pair, a screen, a glossary entry or a template), one answer per cluster or per file, not per token. Fact statuses, tags and the authority order are in `CONTEXT_REQUIREMENTS.md`.

**Freeze gate first.** A frozen span is not decomposed:
- **Existing glossary card.** The source matches a glossary term with `status: "approved"` — the approved form is required (the target definition's `term`, or the entry in its `variants` whose `gender` the sentence needs), and after translation it is counted as HIT or MISS (locally in 3.3b when the context-aware check runs; 3.4's glossary compliance check covers every setting). A **term-only** source (only existing glossary spans, e.g. `RESUME`, `Flight Dart`) stops here: no questions inside the span, and no context-aware fluency call later.
- **Candidate card.** A glossary term with `status: "candidate"` is a `glossary-candidate`: render it as its card says and pass it in `contexts` so the batch stays consistent, but it is not a lock and is not counted as HIT or MISS. A `not_a_term` card is ignored.
- **Repeating label, no card.** A short label, name or status that repeats in the file without a card is a `glossary-candidate`: translate it consistently, record it in `tools/glossary_candidates.jsonl` (3.2) and list it for the user (glossary 2.4 flow), but it is not a lock until a card exists.
- **Phraseologism.** A one-off sentence whose wording doesn't add up from its parts stays in the sentence; promote it to `glossary-candidate` only if it repeats or the user asks.
- **Bare word, no card** (`Potato`, `Flight`): its sense is `open`. A short homograph that isn't term-only is UNSURE, never a lock.

**Three questions** on whatever the gate left unfrozen:
1. **Referent** — what a pronoun, `you`, a status word or a missing object points at.
2. **Forced form** — gender, number, case; whether a placeholder like `{0}` or `[1]` is a name, a count, or a noun that inflects; the address form (tu/vous, du/Sie, ты/вы, tú/usted) — one choice per file or per speaker pair. A string with no address gets no formality fact.
3. **UI role** — label, button or description, which decides noun, imperative or infinitive for the whole cluster.

Give each point a status: `resolved` when the platform context (a confirmed fact), a cited string id, a source column, a screenshot or a quoted official page decides it; `conflict` when two sources or two string groups point different ways; otherwise `open`. For points still `open` or in `conflict`, run one leftover web search each (product name plus the string), open the page and quote the line; a page that disagrees with an existing source makes the point a `conflict`.

**Write the facts to the platform.** Store each new or changed fact as `CONTEXT_REQUIREMENTS.md` maps it ("How a status is stored on the platform", "Where each fact goes"): string facts with `update_string_contexts` — one call per batch, up to about 200 items, each with the string's `baseVersion` and the fact's `source` — and project facts (a character's gender, a relation's register, a question note) with `update_project_context` and the project's `baseVersion`. A `conflict` sets the string's `flagged` and adds or extends a `question` note with both readings. Keep the versions the results return. Each item comes back `ok`, `conflict` or `invalid`; follow "Writes" in `CONTEXT_REQUIREMENTS.md` for the last two: re-read, retry once, then report to the user without overwriting.

**Handoff to 3.2:**
- `resolved` — a hard constraint; pass it with its evidence.
- `open` — the translation may commit to a reading only where the wording can't avoid it; tag that string `agent-choice` (in its fluency log line, `tags`) and write the reading as a `suggestion` with no source. An `agent-choice` is never evidence for another string.
- `conflict` — write one document note for the file (both readings, both sources), make sure the platform has the `question` note and the string is `flagged`, and tag any wording that commits to a reading `provisional` (in its fluency log line, `tags`).

Show the batch's ambiguity table before translating it, in the user's language:

| id | freeze | question | status | evidence or readings |
|---|---|---|---|---|

## 3.2.0 Translation memory lookup

Before step 1, look up the batch in translation memory and reuse earlier translations that fit. Run this after 3.1b — checking a draft needs the batch's `resolved` facts.

**Call.** One `lookup_translation_memory` call per batch, chunked to ≤100 texts per call. Pass:
- `texts` — the batch's source strings. When a string's speaker and addressee are known, pass it as `{ "text": "...", "speakerId": "...", "addresseeId": "..." }`; otherwise as a plain string.
- `sourceLanguage` — the explicit source language, never `auto` (rows stored with `auto` don't match an explicit language, and the reverse).
- `targetLanguage`.
- `glossaryId` — `project.json`'s `glossary_id` (omit it when the project has no glossary).

Approved matches are translations people approved in review — in the platform's review screen or the `qa` skill's 4.6. Each text comes back with `match: null` (a miss) or a match carrying `output`, `review`, `glossaryId`, `createdAt`, `translationType`, `contextNote`, `apiKey.name` and its id (`historyId`, or the revision id for an approved match).

**Glossary filter.** Use an `unreviewed` match only when its `glossaryId` equals `project.json`'s `glossary_id` (both empty when the project has no glossary). Step 1's no-glossary throwaway translations are stored in translation history too — the filter keeps them out. Treat a match that fails the filter as a miss and log it as `rejected-glossary`.

**Per match:**
- `review: "approved"` — a human-approved translation for the same source, speaker and addressee. Check tags `<...>`, placeholders `{...}`, variables and numbers; if they're intact, write it in 3.3 as is. If they're not, treat it like a failed draft below.
- `review: "unreviewed"` — a draft. Check it like a step-3 result (3.2): tags, placeholders, variables and numbers; speaker intent and addressee (singular/plural); register; the `resolved` facts from 3.1b. Unreviewed matches ignore speaker and context, so a match can come from a different speaker. Write it in 3.3 if it passes. If it doesn't, re-translate that string alone with `translate_text` (with `glossaryId`, no `fluency`) — a step-3 fix, not a new step 1/2.

**Only misses go to 3.2.** A string with a TM match is never part of a `translate_batch`/`translate_batch_async` call — not in step 1, not in step 3.

**Fluency for TM matches.** No step 1 or step 2: log `fluency: null` with `"fluency_skipped": "tm_hit"`. Step 4 (3.3b) runs on the written text when the setting includes it, like any other written string.

**TM log.** Append one line per matched string to `tools/tm_hits.jsonl`:

```json
{"id": "<string/row id>", "file": "<path>", "sourceLang": "en", "targetLang": "de", "sourceText": "...", "review": "unreviewed", "historyId": "<id>", "revisionId": null, "glossaryId": "<id>", "createdAt": "...", "apiKey": "<name>", "action": "written", "reason": null}
```

`action` is `written` (used as is), `retranslated` (draft failed a check — `reason` says which) or `rejected-glossary` (failed the glossary filter, translated as a miss). Misses aren't logged here.

**Call log.** Append one line per `translate_batch`, `translate_batch_async`, `translate_text` and `record_translations` call to `tools/translate_calls.jsonl`, so the run can be checked afterwards (3.5's run report):

```json
{"step": "3", "tool": "translate_batch", "targetLang": "de", "glossaryId": "<id>", "origin": null, "strings": [{"id": "<string/row id>", "file": "<path>"}], "time": "<ISO 8601>"}
```

`step` is `1` (no-glossary throwaway), `3` (final translation), `fix` (a single-string step-3 fix, including a failed TM draft), `3.5` (final glossary pass) or `record` (3.3a; `origin` is `machine`). The `qa` skill's 4.6 adds `review` lines: `set_translation_status` calls with their `status`, and `record_translations` calls with `origin: "manual"`. `strings` lists the strings the call sent, in the same `id`/`file` form as `tm_hits.jsonl`; `glossaryId` is `null` when the call had none. Log the call when you send it, not only when it succeeds.

## 3.2 Translate and measure — per the fluency setting

Every translation and every score comes from the `algebras` MCP server's tools — never generate translated text or a fluency score yourself. Every row starts with 3.2.0's TM lookup; the steps below run on its misses only. Which calls run per batch depends on `project.json`'s `fluency` (chosen in onboard 1.2d; never re-ask):

| `fluency` | Calls per batch, in order |
|---|---|
| `none` | TM lookup (3.2.0) → misses: step 3 |
| `isolated` | TM lookup (3.2.0) → misses: step 1 → step 2 → step 3 |
| `context` | TM lookup (3.2.0) → misses: step 3 → step 4 (3.3b); matches: step 4 |
| `both` | TM lookup (3.2.0) → misses: step 1 → step 2 → step 3 → step 4 (3.3b); matches: step 4 |

Each string is measured **at most once per mode** — once context-free (step 2), once context-aware (step 4) — and never again, even if it is revised later. Never pass `fluency: true` on a translate call; the inline flag is not part of this flow. Translate a cluster's glossary-term and `resolved` rows before its `open`/`conflict` rows, so step 4's neighbor windows have translated neighbors.

**Step 1 — no-glossary translation (`isolated`, `both`).** Call `translate_batch` (or `translate_text` for a single string) **without** `glossaryId` and **without** `fluency`. This translation is a throwaway — do not write it to the target file, do not show it to the user as the "result." Its only purpose is to feed step 2.

**Step 2 — context-free fluency, as its own call (`isolated`, `both`).** Call `check_fluency_batch` (or `check_fluency` for a single string) with `items` built from step 1's `{sourceText, translatedText}` pairs and **no** `context` or `prompt` — this is the string-alone score. This is a genuinely separate tool from `translate_batch`; the point is distinct, auditable calls. Log the result as the entry's `fluency` (see "Fluency log" in 3.3b).

**Step 3 — final, with glossary (always).** Call `translate_batch`/`translate_text` (or `translate_batch_async` — see below) on the texts, **with** `glossaryId` set to `project.json`'s `glossary_id`, and without `fluency` — this call's output is what actually gets written in 3.3. Step 1's translation, if there was one, is discarded.

Chunk every translate and fluency call to ≤20 texts (the cap on `translate_batch`/`translate_batch_async` and `check_fluency_batch`), with the same chunking across the steps. If the batch you declared in 3.1 is larger, sub-chunk it here without changing what counts as "the batch" for 3.4's consistency check.

Pick the tool per step, independently:
- `translate_batch` vs `translate_batch_async` + poll `get_translate_batch_async_status` — `translate_batch` is the default, blocking until done; reach for the async form when dispatching several chunks (or several of these steps) concurrently and polling while you do other work is actually faster than waiting on each in turn. No fixed size threshold — use your judgment.
- `translate_text`/`check_fluency` — only for a single string (a one-off re-translation after a fix, or a chunk of exactly one). A fresh string with no `tools/fluency_scores.jsonl` entry yet still goes through the steps its setting requires; a revision of an already-scored string goes straight to step 3 and gets no new score.
- **Agentic pipeline** (`POST /translation/agentic-translate`, then poll `GET /translation/agentic-translate/{id}` with `curl -H "X-Api-Key: $ALGEBRAS_API_KEY" "$ALGEBRAS_PLATFORM_URL/api/v1/translation/agentic-translate..."`) — the one case that's direct HTTP rather than MCP, because no MCP tool wraps it yet. Reserve it for the step-3 (glossary) call on strings where the extra "human-like" quality is worth **4x the credit cost** — hero/marketing copy. Steps 1, 2 and 4 still use the ordinary MCP calls; the agentic result is scored by step 4 only if the setting includes it, and never twice.

**`contexts` and `prompt` on the translate steps.** Pass `contexts` (per-text, aligned by index) on steps 1 and 3 whenever you have row-level context — the API doesn't see your project's columns unless you hand it over:
- Row columns that help (`Comment`, `Speaker`, `Addressee`, `Context`, `Max length`, etc.).
- The `resolved` (confirmed) facts from the string's platform context for that language, and the matching project objects (the speaker's and addressee's characters, the relation's register, the style brief).
- When the flow says neighbors matter, up to three source lines before the string and three after.
- Never send a `candidate`, `conflict` or `open` fact as if it were resolved, and never an `agent-choice` as evidence.

For a string with an unresolved fact, add a `prompt` instruction to choose wording that doesn't commit to it (a gender-neutral construction; a phrasing that avoids tu/vous until formality is known). Never invent a speaker, a learner's gender, or a customer's gender. Apply the rest of the flow's translation rules: games keep tags and don't choose an open formality; edtech keeps the marked correct option, the option order and the difficulty; fintech uses the locked status term, leaves identifiers and currency codes, and doesn't soften a legally locked string; saas keeps ICU and the length limit.

If the user answers a client question mid-run, write the answer to the platform: `update_string_contexts` for the strings it decides (confirmed, source `{"kind": "user"}`, clear `flagged` when it settles the conflict) or `update_project_context` for a project-level fact, with `baseVersion` as in 3.1b, and update or remove the `question` note. If `client_questions.md` exists, regenerate it from the notes. Then continue the current batch with those facts. Don't retranslate strings already written — list the affected string ids and ask whether to retranslate them.

**Apply glossary terms exactly (step 3).** For source terms not yet in the glossary:
1. Search the web for established translations before coining your own.
2. If a reliable translation exists, don't create a glossary term mid-batch. Append it to the local candidate list `tools/glossary_candidates.jsonl` (one line per term and language; add the string id to `string_ids` if the line exists), and pass it in `contexts` for later strings in the session so they render it the same way. A candidate is a consistency hint, never a lock. 3.5 pushes the list once, after all batches.

   ```json
   {"term": "Flight Dart", "translation": "Flugpfeil", "sourceLang": "en", "targetLang": "de", "evidence": "<quoted line>", "source_url": "https://...", "string_ids": ["12", "40"], "status": "local", "termId": null}
   ```
3. If you're unsure, flag the term and ask the user before translating.

The API returns translated text; it doesn't know your project's markup conventions unless you tell it. After step 3's response, verify yourself: all tags `<...>`, placeholders `{...}`, variables, numbers, and markup preserved exactly; speaker intent, addressee (singular/plural), register, and intensity matched; `resolved` facts honored. Use `prompt` on the translate call to steer this (e.g. "preserve all `{placeholder}` tokens exactly") when a chunk needs it, and re-translate (`translate_text`, with `glossaryId` and no `fluency`) any result that got it wrong rather than hand-editing the API's output yourself — this is a step-3 fix, not a new step 1/2.

For credits: translate roles and departments; preserve person names, company names, engine names, and middleware names unchanged — use `prompt` to convey this per chunk if the default output isn't respecting it.

## 3.3 Parse and write using generated tools

Use the parser from Phase 1 to write results. Write only step 3's (glossary-applied) output — never step 1's throwaway translation. Write only the target language field/column for the requested rows. Never overwrite source text or other columns. If no suitable tool exists, generate one before writing.

Verify the exact edited cells by parsing the file again after writing.

## 3.3a Record the written translations

Every translation written to a file is also recorded on the platform project as a draft for review, so people can approve it in the platform's review screen or in the `qa` skill's 4.6, and translation memory reuses it once approved. After writing a chunk, call `record_translations` with `project.json`'s `project_id` and one item per written string: `{ "externalKey": "<file>#<id>", "language": "<target>", "text": "<the written text>", "origin": "machine" }` — the `externalKey` onboard 1.6 imported the string with. Chunk the calls to the tool's item limit.

- This covers TM matches too. The one exception is an approved match that already is this string's own approved translation — recording it again would only add a duplicate draft.
- A step-3 fix (a re-translated failed TM draft or a broken placeholder) and a 3.5 fix are recorded the same way after they're written; the new draft replaces the string's earlier draft.
- `origin` is always `machine` here. `manual` is only for the user's own wording, in the `qa` skill's 4.6.
- Recording never approves. Approve only in 4.6, after the user's explicit OK.
- An item the platform can't match to a string (not imported yet) comes back as an error: report it and re-run onboard 1.6 for its file, then record it again.

## 3.3b Step 4 — context-aware fluency (`context`, `both`)

Run this after the batch is written, on the written step-3 text. It scores each string together with its neighbor strings and the choices already approved for it.

**Count terminology locally.** Never ask a model whether a glossary term matches. Fetch the glossary once per session with `list_glossary_terms` and save it to `tools/glossary_terms.json`, keeping each term's `type` and `status` and each definition's `gender` and `variants`. Then, for each string, find every approved glossary term whose source term occurs in the source text and check the target:
- **HIT** — an approved form is in the target; record the target span.
- **MISS** — no approved form in the target.
- **UNSURE** — the source word is a short homograph (`Flight`, `Strong`, `Tied`) in a segment that isn't term-only and isn't capitalized mid-sentence.

Match rules: a stem plus a suffix of at most 4 letters for Russian and other heavily inflected languages, at most 3 for German; `*` matches any suffix; each `variants[].term` of the target definition is another approved form, and so is an "also approved: …" note in the definition text of an older term; a multiword term hits when all its stems occur within a 3-token window, in any order. Each definition's `caseSensitivity` applies (`ignore`: any case; `capitals`: capitals must match); a term's `type` never changes how it matches. Placeholders are never terms. A **term-only** string (its source is only existing glossary spans) gets **no** step-4 call — record its HIT/MISS only.

**Build the neighbor window.** Same file and target language only, never another translator's text, at most 8 strings. Score each already-translated candidate:

| Signal | Weight |
|---|---|
| Shares an existing glossary entry | 3 |
| Shares a head noun in a noun phrase of ≤ 4 tokens | 3 |
| Same placeholder skeleton plus the same leading token | 2 |
| Shares a capitalized entity | 2 |
| Same template class (bare noun phrase, imperative, question) | 1 |

Keep candidates with total weight ≥ 2, highest first, and stop at about 600 source tokens. If none qualify, use up to 4 strings within ±2 in file order. A file with a single string has no window — log its `fluency_ctx` as `null` with reason `no_neighbors` and make no call.

**Compose `context`.** Locks are only HIT spans and `resolved` facts that apply to this string, each with short evidence. `agent-choice`, `provisional`, `glossary-candidate`, UNSURE, MISS, `candidate`, `conflict` and `open` are never locks. Use this plain-text layout:

```
Neighbors (same file, already translated):
- "<source>" -> "<translation>"
Locked (approved, do not flag):
- "<target span>" - glossary term
- informal address (du) - resolved, evidence: strings 12, 40
Notes: <optional short facts, e.g. speaker/addressee>
```

Never put glossary hit counts, fluency scores, the reasons from the decision log, or another translator's text into `context`. Keep it within 6,000 characters (trim neighbors from the lowest weight first); a call-level `prompt`, if any, is a short project instruction (e.g. the product register) within 2,000 characters.

Generate a reusable tool, `tools/fluency_ctx.py`, if `tools/` doesn't already have one: built on the Phase 1 parser, generic (no hardcoded columns, languages or paths), it computes HIT/MISS/UNSURE, picks the window and writes the `context` text per string. It reads the `resolved` facts from `tools/context_cache.json` (written from the platform context, see "Session start") and the tags from `tools/fluency_scores.jsonl`. Test it on a small sample first.

**Call.** `check_fluency_batch` with `items` of `{sourceText, translatedText, context}` (≤20 per call), or `check_fluency` with `context` for a single string. The server scores the translation, uses the neighbors only for consistency and register, and does not flag the locked choices. Log the result as the entry's `fluency_ctx`.

### Fluency log

Write one line per string to `tools/fluency_scores.jsonl` when the batch's checks are done — update the line rather than adding a second one if step 2 and step 4 run at different times:

```json
{"id": "<string/row id>", "file": "<path>", "sourceLang": "en", "targetLang": "de", "sourceText": "...", "fluency": { "value": 8.4, "idiomatic": 8, "collocational": 9, "discourse": 8, "pragmatic": 9, "calque": 8, "issue_type": "none", "severity": null, "problematic_phrase": null, "suggested_fix": null, "main_issue": null }, "fluency_ctx": { "value": 8.8, "idiomatic": 9, "collocational": 9, "discourse": 9, "pragmatic": 9, "calque": 8, "issue_type": "none", "severity": null, "problematic_phrase": null, "suggested_fix": null, "main_issue": null }, "terms": { "hit": ["Drachenstein"], "miss": [], "unsure": [] }, "term_only": false, "ctx_neighbors": ["12", "40"], "tags": [] }
```

- `fluency` is the context-free score (step 2), `fluency_ctx` the context-aware score (step 4). A mode the project's setting doesn't include is `null`, never 0. A mode that ran but where the API skipped scoring (it does this for long text), or a string with no neighbors, is `null` plus `"fluency_skipped": "<reason>"` or `"fluency_ctx_skipped": "<reason>"` — that tells the `qa` skill the string was genuinely never scored, as opposed to scored-and-good.
- `terms`, `term_only` and `ctx_neighbors` come from step 4 (empty when step 4 doesn't run).
- `tags` lists the string's `agent-choice` and `provisional` tags from 3.1b (empty when it has none).
- `decision`, `decision_reason` and `revised_after_scoring` are added later by the `qa` skill's 4.3.

This log is the **only** source of fluency data from here on — never call `check_fluency`/`check_fluency_batch` again for a string that already has a score in that mode.

After updating the JSONL log, also update `fluency_report.csv` in the project root — a user-facing report that can be opened in Google Sheets or Excel. Create it with headers on the first batch; append rows on subsequent batches. Columns:

```
id,source_lang,target_lang,source_text,fluency_score,idiomatic,collocational,discourse,pragmatic,calque,issue_type,severity,problematic_phrase,suggested_fix,main_issue,fluency_ctx_score,ctx_issue_type,ctx_severity,ctx_problematic_phrase,ctx_suggested_fix,term_hits,term_misses,decision,decision_reason,revised_after_scoring
```

The first 15 columns are the context-free score; the `ctx_` columns the context-aware one; `term_hits`/`term_misses` are counts. Leave a mode's columns empty when it is `null`. Quote fields that contain commas or newlines. This CSV is derived from the JSONL log — if the two ever diverge, the JSONL is authoritative.

## 3.4 Mid-batch consistency check

After writing each batch (3.3), run the consistency-checking tool in incremental mode before moving to the next batch:

```
tools/check_term_consistency.<ext> --scope batch --batch <ids/range>
```

If this tool doesn't exist yet, generate it now — see the `qa` skill's 4.2 for the full method specification. It must be generic and format-agnostic, built on top of the Phase 1 parser, and support both `--scope full` and `--scope batch`.

This applies three checks — full method descriptions are in the `qa` skill's 4.2 — restricted to the rows in the batch just written, compared against everything already translated for that language (prior batches, other files, and the glossary):

- **Method A** (exact-duplicate source, zero heuristics): the batch's source strings that also occur elsewhere in the corpus must have the same target rendering everywhere.
- **Method B** (term-embedding, heuristic): terms with an established canonical rendering elsewhere in the corpus must be rendered consistently when embedded inside this batch's sentences.
- **Glossary compliance** (via `count_glossary_terms`): for each segment in the batch, call `count_glossary_terms` with `project.json`'s `glossary_id`, passing `sourceLanguage`, `sourceText`, `targetLanguage`, and `targetText`. A term found in the source but missing from the target (i.e. `sourceCount > 0` but `targetCount == 0` in the per-term `terms` array) is a glossary MISS. Save each segment's result as its `before` record in `tools/glossary_pass.jsonl` (shape in 3.5), and log each MISS in `tools/consistency_findings.jsonl` with status `deferred-3.5`. Don't fix glossary MISSes here — 3.5 fixes them all in one pass.

**Review every finding before dismissing or accepting it** — the script raises signals, not verdicts. For each one, read the actual source/target context and append one line to `tools/consistency_findings.jsonl`:
- `confirmed` (status stays `open`) if it's a real inconsistency, or
- `false_positive` with a short reason if it isn't (e.g. a different part of speech, a deliberate valid variant, a polysemous homograph).

**This is a soft gate**: do not block starting the next batch on a confirmed finding. Leave it `open` in the findings log so the `qa` skill's full pass (4.2) has a ready-made map of everything flagged along the way, rather than fixing drift ad hoc mid-flow or losing track of it. Exception (Method A/B only, never a glossary MISS): if the fix is trivial and unambiguous (apply the already-established canonical rendering, no judgment call involved), you may fix it immediately and mark it `fixed-inline` in the same log instead of leaving it open.

## 3.5 Final glossary pass

Run once, after the last batch of the session (3.1–3.4 done for every batch), before QA. It fixes glossary MISSes in one pass and measures glossary compliance before and after.

**Scope.** Every string written this session, per target language — translated strings and TM matches. Existing translations kept from onboard 1.2c are out of scope.

**Pass log.** One line per string in `tools/glossary_pass.jsonl`, updated in place rather than appended twice:

```json
{"id": "<string/row id>", "file": "<path>", "targetLang": "de", "before": {"terms": [{"term": "Flight Dart", "sourceCount": 1, "targetCount": 0}], "miss": ["Flight Dart"]}, "status": "fixed", "after": {"terms": [{"term": "Flight Dart", "sourceCount": 1, "targetCount": 1}], "miss": []}, "reason": null}
```

`status`: `ok` (no MISS), `miss` (not fixed yet), `fixed`, `accepted` (a false positive — `reason` says why), `user` (waiting on or decided by the user). The pass is resumable: skip strings whose `status` is `ok`, `fixed`, `accepted` or `user`, and continue from the rest.

1. **Before.** For each string in scope without a `before` record (3.4 already recorded most of them), call `count_glossary_terms` with `project.json`'s `glossary_id`, `sourceLanguage`, `sourceText`, `targetLanguage` and `targetText`. A MISS is `sourceCount > 0` and `targetCount == 0` for a term in the `terms` array.
2. **Fix each MISS.** Re-translate the string with `translate_text`, with `glossaryId` and without `fluency`, and a `prompt` naming the approved forms of the missing terms. Verify tags, placeholders, numbers and `resolved` facts as in 3.2, write it with the parser (3.3), record it (3.3a), then call `count_glossary_terms` again and record `after` and `status`. Strings with the same source text are fixed together so Method A stays consistent. Don't re-score fluency: set `"revised_after_scoring": true` on the string's `tools/fluency_scores.jsonl` line.
   - A string written from an `approved` TM match is never overwritten — set `status: "user"` and list it for the user.
   - If a fixed string still misses the term, read it: an inflection, word order or homograph the counter didn't recognize is `accepted` with a reason; anything else goes to the user.
3. **Compliance.** Per target language, before and after the fixes: strings with at least one glossary term in the source, strings with a MISS, the share of strings without a MISS (%), and term occurrences found in the target out of those in the source (count and %). Write it to `tools/glossary_compliance.json`, keyed by target language:

   ```json
   {"de": {"before": {"strings_with_terms": 40, "miss": 6, "compliant_pct": 85.0, "occurrences_found": 51, "occurrences_source": 58, "occurrences_pct": 87.9},
           "after":  {"strings_with_terms": 40, "miss": 1, "compliant_pct": 97.5, "occurrences_found": 57, "occurrences_source": 58, "occurrences_pct": 98.3}}}
   ```

   A string counts once per term in its source: a term occurrence is found when the target has it (`min(targetCount, sourceCount)`); `after` is a string's `after` record, or its `before` record when it has none. Percentages have one decimal. Show it as a table:

   | lang | strings with terms | MISS before | compliant before | MISS after | compliant after | term occurrences before | term occurrences after |
   |---|---|---|---|---|---|---|---|

   `count_glossary_terms` counts approved terms only, so candidate terms aren't in these numbers.
4. **Push candidates once.** Show the `status: "local"` lines of `tools/glossary_candidates.jsonl` as a table (term, translation, language, evidence, strings). Push the rows the user accepts with `create_glossary_term`, with the `type`, each definition's `caseSensitivity` (the `glossary` skill's 2.5 case mode) and per-language `gender` when known (see 2.5 for the term shape), and mark each line `pushed` with the returned `termId`; mark rejected rows `rejected`. Pushed terms start as candidates. Then run the `glossary` skill's 2.6 approval table on them: approve with `set_glossary_term_status` only the rows the user approves there. Approved terms count in translation and the glossary check from the next batch or session; this session's written strings stay as they are.
5. **Run report.** Run `node tools/run-report.mjs` from the project root. If `tools/run-report.mjs` doesn't exist, copy it from the plugin's `reports/run-report.mjs` (or download `https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin/reports/run-report.mjs`) into `tools/` first. It checks the logs of this run: no TM-hit string went to a translate call (must be 0), every written string was recorded (3.3a), and the compliance numbers recomputed from `tools/glossary_pass.jsonl` agree with `tools/glossary_compliance.json`. It prints counts only; add `--details` to list the string ids behind a failed check. Exit code 1 means a check failed: show which, fix the cause (a missing record call, a wrong compliance number), and run it again. A leak can't be undone — report it to the user.

## Next

Repeat 3.1–3.4 for each batch. Once translation is complete for the requested scope (all batches for this session translated and consistency-checked), run 3.5 once, then continue with Phase 4 — invoke the `qa` skill (`algebras-agent:qa`) if skill invocation is available in this session, otherwise open and follow `skills/qa/SKILL.md` in full. To translate another batch later, repeat from 3.1 and run 3.5 again — its log covers only strings not yet passed.
