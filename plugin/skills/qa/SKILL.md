---
name: qa
description: Phase 4 of the Algebras translation workflow (QA Review) — local QA, full-corpus terminology consistency, Algebras fluency scoring, and reviewer-agent proofreading. Requires at least one batch already translated and written to disk.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, Agent]
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
- **Glossary-anchored check**: independently of in-corpus canonical terms, check every segment that contains an approved glossary term against the glossary's approved translation(s) for the current target language.

**Sizing mode**: for large projects (see the `translate` skill's 3.0 threshold), the tool should maintain an incremental cache (e.g. `tools/.consistency_cache.json` — source-text → seen targets, canonical term → stems) instead of re-parsing the whole corpus on every call. Treat the cache as disposable derived data: safe to delete, rebuilt automatically on the next run. Small projects can just rescan everything each time — simpler, and cheap at that scale.

**Merge with the running log**: read `tools/consistency_findings.jsonl` (populated by every 3.4 run this session) and deduplicate against the fresh full-scope findings by source+context+language. Resolve every item still `open`: fix it, ask the user, or record an explicit accepted exception with rationale — the same false-positive-review discipline from 3.4 applies here too. Don't move on with an `open` item unresolved.

## 4.3 Fluency QA (via Algebras MCP)

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

Apply only user-approved edits. Re-run QA after applying. Report results.

## 4.5 Final report

After each batch:
- Row range and languages processed
- QA findings by type and count
- Consistency QA: Method A / Method B / glossary-anchored findings — confirmed, false-positive, fixed-inline, and still-open counts
- Fluency scores (min, mean, any below 6)
- Edits applied
- Remaining issues for user review

## Next

This is the last phase for the current batch/scope. To translate another batch, go back to the `translate` skill (3.1). Otherwise, this pipeline run is complete.
