---
name: qa
description: Phase 4 of the Algebras translation workflow (QA Review) — local QA with the project flow's checks, full-corpus terminology consistency, reading the fluency scores captured during translation (context-free baseline and/or context-aware decisions, no new calls), reviewer-agent proofreading, and the context report. Requires at least one batch already translated and written to disk.
allowed-tools: ["Bash(git rev-parse:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(node tools/run-report.mjs:*)", Read, Write, Edit, Glob, Grep, Agent, mcp__algebras__list_glossary_terms, mcp__algebras__count_glossary_terms, mcp__algebras__detect_languages_batch, mcp__algebras__check_fluency, mcp__algebras__check_fluency_batch, mcp__algebras__get_project_context, mcp__algebras__list_strings, mcp__algebras__record_translations, mcp__algebras__set_translation_status, mcp__algebras__list_translations]
---

# Phase 4 — QA Review

## Prerequisites

- Requires at least one batch already translated and written to the target file(s) (Phase 3, step 3.3) for the language/rows in scope — this phase has nothing to check against otherwise. If nothing has been translated yet: invoke the `translate` skill (`algebras-agent:translate`) first, or read `skills/translate/SKILL.md` if skill invocation isn't available in this session.
- Context comes from the Algebras platform project named by `project.json`'s `project_id` (`CONTEXT_REQUIREMENTS.md`, "Where context lives"). At the start of this phase, read it fresh — `get_project_context`, and `list_strings` to the end of its cursor — since people may have edited it in the platform UI during translation. Refresh `tools/context_cache.json` from it if a local tool needs the context.
- 4.2's full-corpus consistency tool (`tools/check_term_consistency.<ext>`) should already exist from the `translate` skill's 3.4 first run; if it doesn't, generate it here (see 4.2) before proceeding.

## 4.1 Local QA

After each translation batch, run all available tools in `tools/`, plus the checks listed under "QA emphasis" for `project.json`'s `project_type` in `PROJECT_TYPES.md` (or the file's entry in `file_flows`). Common checks:
- **Length expansion** — text length within safe bounds. Games: short UI expanded by more than 30% (or past a stated limit) is a finding.
- **Numeric preservation** — all numbers match source. Fintech: currency codes, IBANs, masked card numbers and license numbers match too.
- **Mixed-language / source leakage** — no untranslated segments, except names the flow's `keep` list leaves as in the source. Checked with `detect_languages_batch` (see below).
- **Flow-specific** — edtech: option count, option order and the marked correct option are unchanged, and feedback still names that option. Fintech: a locked status uses the glossary term, and a legally locked string doesn't read weaker than the source (a finding for the user, never an automatic rewrite). SaaS: ICU and placeholder syntax match, and a help article uses the same label as the translated UI button. Games: tags intact, and a `resolved` formality marker the target doesn't use is a finding to review.
- **Resolved facts honored** — a string whose platform context has a confirmed fact (speaker gender, address form, referent, item role) uses it; a string with an unresolved fact doesn't commit to it unless it is tagged `agent-choice` or `provisional` (`tags` in `tools/fluency_scores.jsonl`).

**Untranslated check.** For every string written in scope (translated strings and TM matches; existing translations kept from onboard 1.2c are out of scope), per target language, call `detect_languages_batch` with `sourceLanguage`, `targetLanguage`, `items` and `keepTerms` — at most 500 items per call, ids unique within a call:
- `items` — `{ "id": "<string id>", "text": "<target text>", "sourceText": "<source text>", "isUiText": true|false }`. Set `isUiText` from the string's platform context: `true` when `placement.contentType` is `ui` or `menu`, `false` for any other content type. When the string has no content type, use the file's flow only if the whole file is interface text (a UI string table, an app's message catalog); otherwise leave `isUiText` out.
- `keepTerms` — texts the project keeps as in the source on purpose, for this target language: approved glossary terms whose target rendering equals the source term (ignoring case), the flow's `keep` list, and the character names in the project context (`characters[].name`). Send only the entries that equal some item's whole `text` in the call (ignoring case and surrounding punctuation) — that is the only case the tool uses them for — and at most 1,000 entries of up to 200 characters each.

A target of 1–3 words identical to its source comes back `skipped` (`kept_term`) when it equals a keep term, `untranslated` (`same_as_source_common_word`) when it is UI text made only of common words, and otherwise `unsure` (`same_as_source`). Use only `results[].id`, `status`, `reason` and `counts`:
- `untranslated` — the target is in the source language. A finding: re-translate it (a step-3 fix, as in the `translate` skill's 3.2) or record it as an accepted exception with the user's reason.
- `unsure` (short text, a short copy of the source, no letters, unreliable detection, or a third language) and `skipped` (a kept term, or names, numbers or placeholders only) — list them for review with their reason. They are not failures.
- `translated` — nothing to do.

Write one line per string to `tools/untranslated_check.jsonl` — `{"id", "file", "targetLang", "status", "reason", "resolution"}`, `resolution` being `fixed`, `accepted` or `null` — updated in place. On a later run, send only strings edited since. If the tool returns 400 for a language (not supported), report that language as "not checked" and continue with the others.

Glossary terminology and cross-batch consistency are handled separately and more rigorously — see the `translate` skill's 3.4 (mid-batch) and 4.2 below (full-corpus).

If a needed QA tool doesn't exist, generate it and run it. Generate tools generically — no hardcoded row ranges or project-specific logic.

Treat every row-level finding as an issue to fix, clarify with the user, or explicitly accept as an exception.

## 4.2 Terminology & Cross-Reference Consistency QA

Run the full-corpus pass of the same tool used in the `translate` skill's 3.4:

```
tools/check_term_consistency.<ext> --scope full
```

If this tool doesn't exist yet, generate it before the first batch (ideally at the same time as 3.4's first run). It must be generic and format-agnostic, built on top of the Phase 1 parser, and support both `--scope full` and `--scope batch`:

- **Method A — exact-duplicate source check**: group all segments by identical source text across all files/languages. Any group where the same exact source text has 2+ distinct target renderings is a confirmed inconsistency — this check has effectively no false positives.
- **Method B — term-embedding check**: for every candidate term that also appears as a standalone segment somewhere (source text == the term exactly), treat that segment's target as the canonical rendering. Every other segment whose source text contains the term as a whole word should have a target that contains the canonical rendering (tolerant of inflection/word order). Mismatches are a heuristic signal for human review, not a hard fact — expect more false positives on short, polysemous single words than on multi-word proper nouns/ability names.
- **Glossary-anchored check**: independently of in-corpus canonical terms, verify that glossary terms are used correctly in each translated segment. Use the `count_glossary_terms` MCP tool with `project.json`'s `glossary_id`, passing `sourceLanguage`, `sourceText`, `targetLanguage`, and `targetText` for each segment. The tool counts glossary term occurrences in the source and checks whether the correct target-language translations appear in the target text, handling lemma/inflection matching, case sensitivity per entry, and CJK word segmentation server-side. It returns confident matches (`matches`/`count`), ambiguous matches (`ambiguousMatches`/`ambiguousCount` with reasons like `lemma_only`, `all_caps_context`, `initial_capital_only`, `segmentation_boundary`), and a per-term `terms` comparison showing `sourceCount` vs `targetCount` — a term found in the source but missing from the target is a glossary compliance violation, unless the term has no definition in the target language (`targetTerm: null`) — that is a glossary gap to report, not a MISS. Batch segments in groups to avoid excessive calls (concatenate several short segments with a unique separator, or iterate over longer ones individually).
  - The `translate` skill's 3.5 already counted and fixed every string written this session: reuse `tools/glossary_pass.jsonl` and call `count_glossary_terms` only for strings in scope without a final 3.5 record (strings edited in 4.4, or outside 3.5's scope). A `deferred-3.5` finding in `tools/consistency_findings.jsonl` is resolved by that string's 3.5 status.
  - Report glossary compliance per target language before and after 3.5, from `tools/glossary_compliance.json`: strings with terms, MISS count, % compliant, and term occurrences (count and %). `count_glossary_terms` counts approved terms only.

**Sizing mode**: for large projects (see the `translate` skill's 3.0 threshold), the tool should maintain an incremental cache (e.g. `tools/.consistency_cache.json` — source-text → seen targets, canonical term → stems) instead of re-parsing the whole corpus on every call. Treat the cache as disposable derived data: safe to delete, rebuilt automatically on the next run. Small projects can just rescan everything each time — simpler, and cheap at that scale.

**Merge with the running log**: read `tools/consistency_findings.jsonl` (populated by every 3.4 run this session) and deduplicate against the fresh full-scope findings by source+context+language. Resolve every item still `open`: fix it, ask the user, or record an explicit accepted exception with rationale — the same false-positive-review discipline from 3.4 applies here too. Don't move on with an `open` item unresolved.

## 4.3 Fluency (read from the translation log)

Fluency was measured during translation, as `project.json`'s `fluency` setting says (translate 3.2 step 2 and 3.3b step 4). **This phase makes no fluency calls** — it reads `tools/fluency_scores.jsonl`, decides what the scores mean, and reports. Never call `check_fluency`/`check_fluency_batch` for a string that already has a score in that mode, and never pass `fluency: true` on a translate call — that includes strings you're about to revise in 4.4. The only exception is the optional pass for unscored strings at the end of this section.

Every score here is a **self-check** of the agent's own translation, not an independent QA measurement — say so wherever you report it.

Read the log for the rows/languages in scope and branch on the setting:

**`none`** — report fluency as "not measured (project setting)". Nothing else to do here.

**`isolated`** (and the `fluency` half of `both`) — the context-free score describes step 1's *pre-glossary* translation, not the glossary-applied text that was written in 3.3. Treat it as a diagnostic about the underlying translation quality, not a gate on the shipped text. Bands:

| Score | Meaning |
|---|---|
| 8–10 | Strong |
| 6–7 | Minor issues |
| 4–5 | Notable issues (`main_issue`/`suggested_fix` on the logged entry) |
| 1–3 | Weak |
| `null` | Not scored — report as unscored, not as a failure |

**`context`, `both`** — the context-aware score describes the written text. Apply this decision table per string and write the outcome back into its log line as `decision` and `decision_reason`.

A **flag** is a `fluency_ctx` severity of critical or major, or a score ≤ 5.0 (`fluency_ctx`, and for `both` also `fluency`). Minor and cosmetic are not flags.

The **hint pattern** is computed from the logged hints across the same file and language, not from a new opinion:
- **contradictory** — the `suggested_fix` repeats another string's `problematic_phrase`, two hints propose different approved variants, or the fix would rewrite a pattern that at least two sibling strings scored ≥ 7 already use;
- **series** — at least two other strings share the first token of the `problematic_phrase` (e.g. `из`, `цель:`) or the same surface pattern;
- **isolated** — neither.
Contradictory wins over series, series over isolated.

| String | Flag | Lock touched | Hint pattern | `decision` |
|---|---|---|---|---|
| term-only | — (no call) | HIT | — | `term-hit` |
| term-only | — (no call) | MISS | — | `term-note` — terminology note |
| normal | no | — | — | `none` |
| normal | yes | `problematic_phrase` is exactly a locked span (HIT or `resolved` choice) | any | `suppressed` |
| normal | yes | phrase wider than the locked span | isolated | `kept-lower` — keep, one severity lower |
| normal | yes | a MISS term | isolated | `segment-error` plus the MISS |
| normal | yes | none | isolated | `segment-error` |
| normal | yes | MISS or none | series | `series-note` — one document note; the strings are capped at minor |
| normal | yes | any | contradictory | `contradictory-note` — one document note; the segment flags are suppressed |

`agent-choice`, `provisional` and `glossary-candidate` never count as a lock. Scores are never clamped — a suppressed string keeps its number. Don't revise a string automatically because of its score or decision: `segment-error` strings and document notes go into the report, and you may offer them in 4.4's approval table like any other finding.

**Unscored strings.** List the strings in scope that have no score in a mode the setting includes — the API skipped them (long text), they had no neighbors, they were translated before the setting changed, or they are existing translations kept from onboard 1.2c. Report them as unscored. You may offer **one** optional pass that scores only those strings with the chosen mode(s) — step 2's call for the context-free mode, step 4's (3.3b) for the context-aware one. Show the approximate word cost first (10 words per string per mode) and run it only after the user confirms. Already-scored strings are never re-scored.

Regenerate `fluency_report.csv` in the project root from the full `tools/fluency_scores.jsonl` — the translate skill maintains this file incrementally per batch, but regenerating it here ensures it reflects the final state, including `decision`, `decision_reason` and `revised_after_scoring`. Same columns as defined in the translate skill's 3.3b.

## 4.4 Reviewer agent (multi-agent proofreading)

For large files or full coverage passes, dispatch a read-only reviewer agent per language (or language group). Provide it:
- File path, row range, source field, and target language field
- All available context columns (`Comment`, `Speaker`, `Addressee`, `Dialogue Trigger`, etc.)
- The confirmed facts for those rows from the platform context, and which rows are tagged `agent-choice` or `provisional`
- The active glossary

Reviewer agents must not edit files. They report findings in this format:

| file | lang | data_row | String ID | source | current_target | issue_type | severity | confidence | suggested_target | rationale |
|---|---|---|---|---|---|---|---|---|---|---|

`issue_type`: `OK` · `definite_fix` · `optional_improvement` · `needs_user_decision`
`severity`: `blocker` · `major` · `minor` · `optional`
`confidence`: `high` · `medium` · `low`

Include in the approval table: high-confidence `definite_fix` findings, repeated pattern fixes, QA failures, `needs_user_decision` items. Reject: purely subjective rewrites, suggestions that break tags/placeholders/numbers, suggestions that ignore context columns.

Apply only user-approved edits, and record each edited string (the `translate` skill's 3.3a): `origin: "machine"` when the wording came from you or a reviewer agent, `origin: "manual"` when it is the user's own wording (that records it as approved). Re-run 4.1's local QA and 4.2's consistency checks on the edited rows — not fluency; an edited string keeps its original scores rather than getting new ones. Set `"revised_after_scoring": true` on its `tools/fluency_scores.jsonl` line and regenerate `fluency_report.csv`. Report results.

## 4.5 Final report

After each batch:
- Row range and languages processed
- QA findings by type and count
- Untranslated check per target language, from `tools/untranslated_check.jsonl`: untranslated (fixed / accepted / open), unsure, skipped as a kept term (`kept_term`), other skipped, and languages not checked
- Consistency QA: Method A / Method B / glossary-anchored findings — confirmed, false-positive, fixed-inline, and still-open counts
- Glossary compliance per target language, before and after the `translate` skill's 3.5 (counts and %, from `tools/glossary_compliance.json`), strings still missing a term (`accepted` or `user` in `tools/glossary_pass.jsonl`), glossary gaps (strings whose source has a term with no definition in the target language, from `gaps` in `tools/glossary_pass.jsonl`), glossary candidates pushed or kept local (`tools/glossary_candidates.jsonl`), and glossary terms still `candidate` on the platform (`list_glossary_terms` with `status: "candidate"`) — offer the `glossary` skill's 2.6 approval table for them
- Translation memory reuse per target language, from `tools/tm_hits.jsonl`: matches written as is and matches re-translated after a failed check
- The run report: `node tools/run-report.mjs` (the `translate` skill's 3.5 step 5 says where to get it) — TM-hit strings sent to translation (must be 0), written strings not recorded on the platform (must be 0), and whether the compliance numbers match the pass log. Re-run it after 4.6 to include the review outcomes
- Fluency self-check, per the project's `fluency` setting:
  - `none`: "not measured (project setting)"
  - context-free score (`isolated`, `both`): min, mean, any below 6 — labeled as the pre-glossary baseline, not a score of the shipped text
  - context-aware score (`context`, `both`): a scores table (`string id | fluency2 | fluencyScore-ctx | decision | reason`, listing every flagged string), counts per `decision`, and the document notes (series and contradictory patterns, conflicts)
  - Terminology: HIT / MISS / UNSURE counts and term-only strings, counted locally
  - Not locks: strings tagged `agent-choice` or `provisional`, and glossary candidates left unlocked
  - Unscored strings, and strings marked "revised after scoring"
  - All of it labeled a self-check of the agent's own translation, not independent QA
- Context, from the platform project: coverage per section from `project.json`'s `context_coverage`, screenshot coverage, `flagged` strings (conflicts and open important facts) and strings with missing facts per target language (`list_strings` with `flagged` and `missingFact`), and the top client questions from the project's `question` notes ranked by strings unblocked. Regenerate `client_questions.md` from those notes and point to it
- Edits applied
- Remaining issues for user review

## 4.6 Review translations

Translation memory reuses only approved translations, and every string written this run is a draft on the platform until someone approves it (the `translate` skill's 3.3a). When the user is done with this run's batches, offer to review the drafts here; they can also review them in the Algebras platform's review screen instead. Skip this step when running non-interactively in CI — the drafts stay drafts.

1. Call `list_translations` with `projectId` (`project.json`'s `project_id`), `language` (one target language at a time) and `status: "draft"`. It is paged: pass `page` (from 1) and `limit` (up to 100), and keep requesting the next page until you have read `total` rows. Each row has the string's `externalKey`, its source text, `draft` and `approved` (each with its revision `id` and `text`, or `null`) and `rejectedCount`.
2. Show the drafts as a table, in pages of about 50 rows:

   | # | string | source | draft | approved now | QA notes |
   |---|---|---|---|---|---|

   `approved now` is the string's current approved translation, if any. `QA notes` are this run's open or accepted findings for the string (4.1–4.4).

   **Actions**: Approve all on this page / Approve rows (list the numbers) / Edit a row (reply with the number and your wording) / Reject rows / Leave as draft
3. Apply exactly what the user said:
   - **approved** rows — `set_translation_status` with `projectId` and `items` of `{ "revisionId": <the row's draft id>, "status": "approved" }` (up to 500 per call). Never approve a row the user didn't approve; "approve all" covers only the page shown.
   - **edited** rows — the user's own wording: write it to the file with the parser, re-run 4.1's checks on it, and record it with `record_translations`, `origin: "manual"`, which the platform stores as approved. Wording you or a reviewer proposed and the user accepted is `origin: "machine"` and stays a draft until approved.
   - **rejected** rows — `set_translation_status` with `{ "revisionId": <the row's draft id>, "status": "rejected" }`. Ask whether to re-translate them (a step-3 fix, recorded as a new draft) or leave the file text for the user.
   - everything else stays a draft.
4. Report per target language: drafts shown, approved, edited (manual), rejected, left as draft.

## 4.7 Deliver on the branch

When the user is done with this run (no more batches to translate now), and the work is on a git branch (see the `translate` skill's 3.0; skip this step when running non-interactively in CI — the action commits itself):

1. Show `git status` and propose a commit containing the translated files, `project.json`, `fluency_report.csv` and `client_questions.md`. The context itself is on the platform project; leave `context_pack.json` and `context_facts.jsonl` (onboard's import input) out unless the user wants them committed. Leave `tools/` and the logs under it (`fluency_scores.jsonl`, `consistency_findings.jsonl`, `context_cache.json`, other caches) out unless the user wants them committed. Confirm with the user before committing.
2. Commit with a descriptive message, e.g. `Localize <project name>: <languages> via Algebras`.
3. Tell the user the branch name and how to review it — `git diff <base branch>...HEAD`, or push the branch and open a pull request. **Never push or open a pull request unless the user asks.**

## Next

This is the last phase for the current batch/scope. To translate another batch, go back to the `translate` skill (3.1). Otherwise, finish with 4.6 and 4.7 — this pipeline run is complete.
