---
name: qa
description: Phase 4 of the Algebras translation workflow (QA Review) — local QA, full-corpus terminology consistency, reporting the fluency baseline already captured during translation, and reviewer-agent proofreading. Requires at least one batch already translated and written to disk.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, Agent, mcp__algebras__list_glossary_terms, mcp__algebras__count_glossary_terms]
---

# Phase 4 — QA Review

## Prerequisites

- Requires at least one batch already translated and written to the target file(s) (Phase 3, step 3.3) for the language/rows in scope — this phase has nothing to check against otherwise. If nothing has been translated yet: invoke the `translate` skill (`algebras-agent:translate`) first, or read `skills/translate/SKILL.md` if skill invocation isn't available in this session.
- 4.2's full-corpus consistency tool (`tools/check_term_consistency.<ext>`) should already exist from the `translate` skill's 3.4 first run; if it doesn't, generate it here (see 4.2) before proceeding.

## 4.1 Local QA

After each translation batch, run all available tools in `tools/`. Common checks:
- **Length expansion** — text length within safe bounds
- **Numeric preservation** — all numbers match source
- **Mixed-language / source leakage** — no untranslated segments

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
- **Glossary-anchored check**: independently of in-corpus canonical terms, verify that glossary terms are used correctly in each translated segment. Use the `count_glossary_terms` MCP tool with `project.json`'s `glossary_id`, passing `sourceLanguage`, `sourceText`, `targetLanguage`, and `targetText` for each segment. The tool counts glossary term occurrences in the source and checks whether the correct target-language translations appear in the target text, handling lemma/inflection matching, case sensitivity per entry, and CJK word segmentation server-side. It returns confident matches (`matches`/`count`), ambiguous matches (`ambiguousMatches`/`ambiguousCount` with reasons like `lemma_only`, `all_caps_context`, `initial_capital_only`, `segmentation_boundary`), and a per-term `terms` comparison showing `sourceCount` vs `targetCount` — a term found in the source but missing from the target is a glossary compliance violation. Batch segments in groups to avoid excessive calls (concatenate several short segments with a unique separator, or iterate over longer ones individually).

**Sizing mode**: for large projects (see the `translate` skill's 3.0 threshold), the tool should maintain an incremental cache (e.g. `tools/.consistency_cache.json` — source-text → seen targets, canonical term → stems) instead of re-parsing the whole corpus on every call. Treat the cache as disposable derived data: safe to delete, rebuilt automatically on the next run. Small projects can just rescan everything each time — simpler, and cheap at that scale.

**Merge with the running log**: read `tools/consistency_findings.jsonl` (populated by every 3.4 run this session) and deduplicate against the fresh full-scope findings by source+context+language. Resolve every item still `open`: fix it, ask the user, or record an explicit accepted exception with rationale — the same false-positive-review discipline from 3.4 applies here too. Don't move on with an `open` item unresolved.

## 4.3 Fluency (already measured during translation)

Fluency is measured exactly once per string, by the `translate` skill's 3.2 step 2 (`check_fluency_batch`/`check_fluency`, called separately from the step-1 no-glossary translation) — before this phase ever runs. **Never call `check_fluency`/`check_fluency_batch` again, and never pass `fluency: true` on a translate call, for a string that already has an entry in `tools/fluency_scores.jsonl`** — that includes strings you're about to revise in 4.4. This phase's job is to read and report that log, not to generate new scores.

Read `tools/fluency_scores.jsonl` for the rows/languages in scope. Apply the same score bands to what's already there, for context when deciding what else to flag:

| Score | Meaning |
|---|---|
| 8–10 | Strong |
| 6–7 | Minor issues |
| 4–5 | Notable issues (`main_issue`/`suggested_fix` on the logged entry) |
| 1–3 | Weak |
| `null` | Skipped by the API (long text) — report as unscored, not as a failure |

These scores describe step 1's *pre-glossary* translation, not the step-3, glossary-applied text that was actually written in 3.3 — the two can read differently. Treat the log as a diagnostic about the underlying translation quality independent of glossary effects, not a gate on the shipped text: **do not revise a string because of its fluency score, and do not re-score anything here.** A string revised for another reason (a consistency finding, a reviewer-flagged fix) keeps its original score in the log — it does not get a new one.

## 4.4 Reviewer agent (multi-agent proofreading)

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

Apply only user-approved edits. Re-run 4.1's local QA and 4.2's consistency checks on the edited rows — not fluency; an edited string keeps its original 4.3 score rather than getting a new one. Report results.

## 4.5 Final report

After each batch:
- Row range and languages processed
- QA findings by type and count
- Consistency QA: Method A / Method B / glossary-anchored findings — confirmed, false-positive, fixed-inline, and still-open counts
- Fluency scores from `tools/fluency_scores.jsonl` (min, mean, any below 6, any `null`/unscored) — labeled as the pre-glossary baseline, not a score of the shipped text
- Edits applied
- Remaining issues for user review

## Next

This is the last phase for the current batch/scope. To translate another batch, go back to the `translate` skill (3.1). Otherwise, this pipeline run is complete.
