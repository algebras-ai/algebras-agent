---
name: translate
description: Phase 3 of the Algebras translation workflow (Translation) — check each batch for ambiguity (resolved/open/conflict facts), translate it via the Algebras MCP tools with the glossary and resolved facts, measure fluency as the project's setting says (context-free on a no-glossary translation, context-aware on the written text with neighbors and locks, both, or none), and run a mid-batch consistency check against everything already translated. Requires a completed project.json and a confirmed glossary.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, WebSearch, mcp__algebras__translate_text, mcp__algebras__translate_batch, mcp__algebras__translate_batch_async, mcp__algebras__get_translate_batch_async_status, mcp__algebras__check_fluency, mcp__algebras__check_fluency_batch, mcp__algebras__create_glossary_term, mcp__algebras__list_glossary_terms, mcp__algebras__count_glossary_terms]
---

# Phase 3 — Translation

## Prerequisites

- Requires a complete `project.json` (Phase 1). If it's missing or incomplete: invoke the `onboard` skill (`algebras-agent:onboard`) first, or read `skills/onboard/SKILL.md` if skill invocation isn't available in this session.
- Requires a glossary that has been through user confirmation (Phase 2, step 2.4) — an intentionally-empty glossary is fine, as long as the user explicitly agreed to proceed without one. If the glossary hasn't been confirmed yet: invoke the `glossary` skill (`algebras-agent:glossary`) first, or read `skills/glossary/SKILL.md`.
- Never translate against a glossary term still flagged low-confidence — resolve it with the user first.

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

The `qa` skill's 4.6 commits the result on this branch at the end.

## 3.1 State rules before each batch

Read the translation rules for `project.json`'s `project_type` in `PROJECT_TYPES.md`. If `file_flows` names a flow for this file, use that flow's rules instead.

Before translating any batch, declare:
- Target locale, register, and formality level. If formality is not `resolved` for this batch, declare it as open instead of choosing a level.
- Glossary terms that apply to this batch, using the flow's glossary emphasis
- The flow's constraints (timing sensitivity, placeholder syntax, profanity intensity, character limits; for games: tags, VO length, short UI; for edtech: assessment lock and reading level; for fintech: locked statuses and legally locked strings; for saas: ICU and length)
- Which `context_files` (from `project.json`) are relevant to this batch — read them before translating it
- The `resolved` facts for this batch, each with its source, and the facts that are still `open`, `candidate` or in `conflict` — from `context_facts.jsonl` and `context_pack.json`, after 3.1b
- Which fluency checks run, from `project.json`'s `fluency` (see 3.2)

Only send segments that don't have a translation yet. Segments that are already translated in the repo (onboard 1.2c) are kept as-is and used as reference — don't retranslate or overwrite them unless the user explicitly asks.

## 3.1b Ambiguity check

Before translating, find what the batch's strings leave undecided — the points where the target language forces a choice the source doesn't make. Work per cluster (strings that share a speaker pair, a screen, a glossary entry or a template), one answer per cluster or per file, not per token. Fact statuses, tags and the authority order are in `CONTEXT_REQUIREMENTS.md`.

**Freeze gate first.** A frozen span is not decomposed:
- **Existing glossary card.** The source matches a confirmed glossary term — the approved form is required, and after translation it is counted as HIT or MISS (locally in 3.3b when the context-aware check runs; 3.4's glossary compliance check covers every setting). A **term-only** source (only existing glossary spans, e.g. `RESUME`, `Flight Dart`) stops here: no questions inside the span, and no context-aware fluency call later.
- **Repeating label, no card.** A short label, name or status that repeats in the file without a card is a `glossary-candidate`: translate it consistently and list it for the user (glossary 2.4 flow), but it is not a lock until a card exists.
- **Phraseologism.** A one-off sentence whose wording doesn't add up from its parts stays in the sentence; promote it to `glossary-candidate` only if it repeats or the user asks.
- **Bare word, no card** (`Potato`, `Flight`): its sense is `open`. A short homograph that isn't term-only is UNSURE, never a lock.

**Three questions** on whatever the gate left unfrozen:
1. **Referent** — what a pronoun, `you`, a status word or a missing object points at.
2. **Forced form** — gender, number, case; whether a placeholder like `{0}` or `[1]` is a name, a count, or a noun that inflects; the address form (tu/vous, du/Sie, ты/вы, tú/usted) — one choice per file or per speaker pair. A string with no address gets no formality fact.
3. **UI role** — label, button or description, which decides noun, imperative or infinitive for the whole cluster.

Give each point a status: `resolved` when `context_pack.json`, `context_facts.jsonl`, a cited string id, a source column, a screenshot or a quoted official page decides it; `conflict` when two sources or two string groups point different ways; otherwise `open`. For points still `open` or in `conflict`, run one leftover web search each (product name plus the string), open the page and quote the line; a page that disagrees with an existing source makes the point a `conflict`. Write each new or updated fact to `context_facts.jsonl` for the string and language it applies to.

**Handoff to 3.2:**
- `resolved` — a hard constraint; pass it with its evidence.
- `open` — the translation may commit to a reading only where the wording can't avoid it; tag that string `agent-choice` in its fact entry. An `agent-choice` is never evidence for another string.
- `conflict` — write one document note for the file (both readings, both sources), add the question to `client_questions.md`, and tag any wording that commits to a reading `provisional`.

Show the batch's ambiguity table before translating it, in the user's language:

| id | freeze | question | status | evidence or readings |
|---|---|---|---|---|

## 3.2 Translate and measure — per the fluency setting

Every translation and every score comes from the `algebras` MCP server's tools — never generate translated text or a fluency score yourself. Which calls run per batch depends on `project.json`'s `fluency` (chosen in onboard 1.2d; never re-ask):

| `fluency` | Calls per batch, in order |
|---|---|
| `none` | Step 3 |
| `isolated` | Step 1 → step 2 → step 3 |
| `context` | Step 3 → step 4 (3.3b) |
| `both` | Step 1 → step 2 → step 3 → step 4 (3.3b) |

Each string is measured **at most once per mode** — once context-free (step 2), once context-aware (step 4) — and never again, even if it is revised later. Never pass `fluency: true` on a translate call; the inline flag is not part of this flow. Translate a cluster's glossary-term and `resolved` rows before its `open`/`conflict` rows, so step 4's neighbor windows have translated neighbors.

**Step 1 — no-glossary translation (`isolated`, `both`).** Call `translate_batch` (or `translate_text` for a single string) **without** `glossaryId` and **without** `fluency`. This translation is a throwaway — do not write it to the target file, do not show it to the user as the "result." Its only purpose is to feed step 2.

**Step 2 — context-free fluency, as its own call (`isolated`, `both`).** Call `check_fluency_batch` (or `check_fluency` for a single string) with `items` built from step 1's `{sourceText, translatedText}` pairs and **no** `context` or `prompt` — this is the string-alone score. This is a genuinely separate tool from `translate_batch`; the point is distinct, auditable calls. Log the result as the entry's `fluency` (see "Fluency log" in 3.3b).

**Step 3 — final, with glossary (always).** Call `translate_batch`/`translate_text` (or `translate_batch_async` — see below) on the texts, **with** `glossaryId` set to `project.json`'s `glossary_id`, and without `fluency` — this call's output is what actually gets written in 3.3. Step 1's translation, if there was one, is discarded.

Chunk every call to ≤20 texts (the cap on `translate_batch`/`translate_batch_async` and `check_fluency_batch`), with the same chunking across the steps. If the batch you declared in 3.1 is larger, sub-chunk it here without changing what counts as "the batch" for 3.4's consistency check.

Pick the tool per step, independently:
- `translate_batch` vs `translate_batch_async` + poll `get_translate_batch_async_status` — `translate_batch` is the default, blocking until done; reach for the async form when dispatching several chunks (or several of these steps) concurrently and polling while you do other work is actually faster than waiting on each in turn. No fixed size threshold — use your judgment.
- `translate_text`/`check_fluency` — only for a single string (a one-off re-translation after a fix, or a chunk of exactly one). A fresh string with no `tools/fluency_scores.jsonl` entry yet still goes through the steps its setting requires; a revision of an already-scored string goes straight to step 3 and gets no new score.
- **Agentic pipeline** (`POST /translation/agentic-translate`, then poll `GET /translation/agentic-translate/{id}` with `curl -H "X-Api-Key: $ALGEBRAS_API_KEY" "$ALGEBRAS_PLATFORM_URL/api/v1/translation/agentic-translate..."`) — the one case that's direct HTTP rather than MCP, because no MCP tool wraps it yet. Reserve it for the step-3 (glossary) call on strings where the extra "human-like" quality is worth **4x the credit cost** — hero/marketing copy. Steps 1, 2 and 4 still use the ordinary MCP calls; the agentic result is scored by step 4 only if the setting includes it, and never twice.

**`contexts` and `prompt` on the translate steps.** Pass `contexts` (per-text, aligned by index) on steps 1 and 3 whenever you have row-level context — the API doesn't see your project's columns unless you hand it over:
- Row columns that help (`Comment`, `Speaker`, `Addressee`, `Context`, `Max length`, etc.).
- The `resolved` facts from `context_facts.jsonl` for that string and language, and the matching objects from `context_pack.json`.
- When the flow says neighbors matter, up to three source lines before the string and three after.
- Never send a `candidate`, `conflict` or `open` fact as if it were resolved, and never an `agent-choice` as evidence.

For a string with an unresolved fact, add a `prompt` instruction to choose wording that doesn't commit to it (a gender-neutral construction; a phrasing that avoids tu/vous until formality is known). Never invent a speaker, a learner's gender, or a customer's gender. Apply the rest of the flow's translation rules: games keep tags and don't choose an open formality; edtech keeps the marked correct option, the option order and the difficulty; fintech uses the locked status term, leaves identifiers and currency codes, and doesn't soften a legally locked string; saas keeps ICU and the length limit.

If the user answers a client question mid-run, update the matching lines in `context_facts.jsonl` (`resolved`, source `user`) and `client_questions.md`, then continue the current batch with those facts. Don't retranslate strings already written — list the affected string ids and ask whether to retranslate them.

**Apply glossary terms exactly (step 3).** For source terms not yet in the glossary:
1. Search the web for established translations before coining your own.
2. If a reliable translation exists, create it immediately via `create_glossary_term` (see the `glossary` skill's 2.5 for the shape) rather than waiting until end of batch — later texts in this same session should get to use it too.
3. If you're unsure, flag the term and ask the user before translating.

The API returns translated text; it doesn't know your project's markup conventions unless you tell it. After step 3's response, verify yourself: all tags `<...>`, placeholders `{...}`, variables, numbers, and markup preserved exactly; speaker intent, addressee (singular/plural), register, and intensity matched; `resolved` facts honored. Use `prompt` on the translate call to steer this (e.g. "preserve all `{placeholder}` tokens exactly") when a chunk needs it, and re-translate (`translate_text`, with `glossaryId` and no `fluency`) any result that got it wrong rather than hand-editing the API's output yourself — this is a step-3 fix, not a new step 1/2.

For credits: translate roles and departments; preserve person names, company names, engine names, and middleware names unchanged — use `prompt` to convey this per chunk if the default output isn't respecting it.

## 3.3 Parse and write using generated tools

Use the parser from Phase 1 to write results. Write only step 3's (glossary-applied) output — never step 1's throwaway translation. Write only the target language field/column for the requested rows. Never overwrite source text or other columns. If no suitable tool exists, generate one before writing.

Verify the exact edited cells by parsing the file again after writing.

## 3.3b Step 4 — context-aware fluency (`context`, `both`)

Run this after the batch is written, on the written step-3 text. It scores each string together with its neighbor strings and the choices already approved for it.

**Count terminology locally.** Never ask a model whether a glossary term matches. Fetch the glossary once per session with `list_glossary_terms` and save it to `tools/glossary_terms.json`. Then, for each string, find every glossary entry whose source term occurs in the source text and check the target:
- **HIT** — an approved form is in the target; record the target span.
- **MISS** — no approved form in the target.
- **UNSURE** — the source word is a short homograph (`Flight`, `Strong`, `Tied`) in a segment that isn't term-only and isn't capitalized mid-sentence.

Match rules: a stem plus a suffix of at most 4 letters for Russian and other heavily inflected languages, at most 3 for German; `*` matches any suffix; "also approved: …" in a definition is a second approved form; a multiword term hits when all its stems occur within a 3-token window, in any order. Placeholders are never terms. A **term-only** string (its source is only existing glossary spans) gets **no** step-4 call — record its HIT/MISS only.

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

Generate a reusable tool, `tools/fluency_ctx.py`, if `tools/` doesn't already have one: built on the Phase 1 parser, generic (no hardcoded columns, languages or paths), it computes HIT/MISS/UNSURE, picks the window and writes the `context` text per string. Test it on a small sample first.

**Call.** `check_fluency_batch` with `items` of `{sourceText, translatedText, context}` (≤20 per call), or `check_fluency` with `context` for a single string. The server scores the translation, uses the neighbors only for consistency and register, and does not flag the locked choices. Log the result as the entry's `fluency_ctx`.

### Fluency log

Write one line per string to `tools/fluency_scores.jsonl` when the batch's checks are done — update the line rather than adding a second one if step 2 and step 4 run at different times:

```json
{"id": "<string/row id>", "file": "<path>", "sourceLang": "en", "targetLang": "de", "sourceText": "...", "fluency": { "value": 8.4, "idiomatic": 8, "collocational": 9, "discourse": 8, "pragmatic": 9, "calque": 8, "issue_type": "none", "severity": null, "problematic_phrase": null, "suggested_fix": null, "main_issue": null }, "fluency_ctx": { "value": 8.8, "idiomatic": 9, "collocational": 9, "discourse": 9, "pragmatic": 9, "calque": 8, "issue_type": "none", "severity": null, "problematic_phrase": null, "suggested_fix": null, "main_issue": null }, "terms": { "hit": ["Drachenstein"], "miss": [], "unsure": [] }, "term_only": false, "ctx_neighbors": ["12", "40"] }
```

- `fluency` is the context-free score (step 2), `fluency_ctx` the context-aware score (step 4). A mode the project's setting doesn't include is `null`, never 0. A mode that ran but where the API skipped scoring (it does this for long text), or a string with no neighbors, is `null` plus `"fluency_skipped": "<reason>"` or `"fluency_ctx_skipped": "<reason>"` — that tells the `qa` skill the string was genuinely never scored, as opposed to scored-and-good.
- `terms`, `term_only` and `ctx_neighbors` come from step 4 (empty when step 4 doesn't run).
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
- **Glossary compliance** (via `count_glossary_terms`): for each segment in the batch, call `count_glossary_terms` with `project.json`'s `glossary_id`, passing `sourceLanguage`, `sourceText`, `targetLanguage`, and `targetText`. A term found in the source but missing from the target (i.e. `sourceCount > 0` but `targetCount == 0` in the per-term `terms` array) is a glossary compliance violation. Log these alongside Method A/B findings.

**Review every finding before dismissing or accepting it** — the script raises signals, not verdicts. For each one, read the actual source/target context and append one line to `tools/consistency_findings.jsonl`:
- `confirmed` (status stays `open`) if it's a real inconsistency, or
- `false_positive` with a short reason if it isn't (e.g. a different part of speech, a deliberate valid variant, a polysemous homograph).

**This is a soft gate**: do not block starting the next batch on a confirmed finding. Leave it `open` in the findings log so the `qa` skill's full pass (4.2) has a ready-made map of everything flagged along the way, rather than fixing drift ad hoc mid-flow or losing track of it. Exception: if the fix is trivial and unambiguous (apply the already-established canonical rendering, no judgment call involved), you may fix it immediately and mark it `fixed-inline` in the same log instead of leaving it open.

## Next

Once translation is complete for the requested scope (all batches for this session translated and consistency-checked), continue with Phase 4 — invoke the `qa` skill (`algebras-agent:qa`) if skill invocation is available in this session, otherwise open and follow `skills/qa/SKILL.md` in full. To translate another batch, repeat from 3.1.
