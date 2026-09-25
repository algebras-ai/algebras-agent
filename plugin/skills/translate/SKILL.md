---
name: translate
description: Phase 3 of the Algebras translation workflow (Translation) — translate each batch via the Algebras MCP tools in three steps (a no-glossary translation, a separate fluency measurement, then the final glossary-applied version that gets written), and run a mid-batch consistency check against everything already translated. Requires a completed project.json and a confirmed glossary.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, WebSearch, mcp__algebras__translate_text, mcp__algebras__translate_batch, mcp__algebras__translate_batch_async, mcp__algebras__get_translate_batch_async_status, mcp__algebras__check_fluency, mcp__algebras__check_fluency_batch, mcp__algebras__create_glossary_term, mcp__algebras__list_glossary_terms]
---

# Phase 3 — Translation

## Prerequisites

- Requires a complete `project.json` (Phase 1). If it's missing or incomplete: invoke the `onboard` skill (`algebras-agent:onboard`) first, or read `skills/onboard/SKILL.md` if skill invocation isn't available in this session.
- Requires a glossary that has been through user confirmation (Phase 2, step 2.4) — an intentionally-empty glossary is fine, as long as the user explicitly agreed to proceed without one. If the glossary hasn't been confirmed yet: invoke the `glossary` skill (`algebras-agent:glossary`) first, or read `skills/glossary/SKILL.md`.
- Never translate against a glossary term still flagged low-confidence — resolve it with the user first.

## Optional: glossary deduplication

Before translating the first batch of the session, if the glossary already has confirmed content (Phase 2): ask the user whether to run a deduplication pass across all glossary terms first, to catch exact duplicates, near-duplicate variants, and conflicting canonical translations before they propagate into translations.

This is optional and must never run without explicit agreement. If the user agrees, invoke the `glossary-dedupe` skill (`algebras-agent:glossary-dedupe`) if skill invocation is available in this session, otherwise read and follow `skills/glossary-dedupe/SKILL.md` in full — it creates the deduplication tool (if one doesn't exist yet) and runs it. If the user declines, skip straight to 3.0.

## 3.0 Pre-translation checkpoint (large projects)

Before writing the first translation of the session, count the total source segments across all files to be translated.

If the project has **more than 2,000 source segments**, treat it as large and add a version-control safety net:

1. Check whether `PROJECT_ROOT` is already a git repository (`git rev-parse --is-inside-work-tree`).
2. If it isn't, propose running `git init` to the user — do not run it silently. Explain why: a baseline makes any future mid-batch tooling issue or bad edit trivially recoverable via `git diff` / `git checkout`.
3. Once a repo exists (new or pre-existing), propose committing the current pre-translation state as a baseline checkpoint (e.g. `git commit -m "pre-translation baseline"`). Always confirm with the user first — if the repo already has uncommitted changes, do not fold them into your baseline commit or commit over someone else's in-progress work; ask how they want to handle it first.

Skip this step entirely for projects at or under the 2,000-segment threshold — a small file doesn't need git ceremony.

## 3.1 State rules before each batch

Before translating any batch, declare:
- Target locale, register, and formality level
- Glossary terms that apply to this batch
- Domain-specific constraints (timing sensitivity, placeholder syntax, profanity intensity, character limits)

## 3.2 Translate — three steps per batch

Fluency is measured **once**, on the pre-glossary translation, and never again — this is a product decision, not a technical default. Every batch goes through the `algebras` MCP server's tools in exactly this order, as three separate calls — never generate the translated text yourself, never combine steps, and never skip straight to step 3:

**Step 1 — no-glossary translation.** Call `translate_batch` (or `translate_text` for a single string) **without** `glossaryId` and **without** `fluency` (omit it — this is a plain translation call, not the inline-fluency shortcut). This translation is a throwaway — do not write it to the target file, do not show it to the user as the "result." Its only purpose is to feed step 2.

**Step 2 — measure fluency, as its own call.** Call `check_fluency_batch` (or `check_fluency` for a single string) with `items` built from step 1's `{sourceText, translatedText}` pairs. This is a genuinely separate tool from `translate_batch` — don't use the `fluency: true` inline flag on step 1 instead of this; the two are not interchangeable for this flow, since the point is three distinct, auditable calls. Append one line per string to `tools/fluency_scores.jsonl`:

```json
{"id": "<string/row id>", "sourceLang": "en", "targetLang": "de", "sourceText": "...", "fluency": { "value": 8.4, "idiomatic": 8, "collocational": 9, "discourse": 8, "pragmatic": 9, "calque": 8, "issue_type": "none", "severity": null, "problematic_phrase": null, "suggested_fix": null, "main_issue": null } }
```

If the API skipped scoring for a given string (it does this for long text), write `"fluency": null` rather than leaving the row out — that tells the `qa` skill's 4.3 the string was genuinely never scored, as opposed to scored-and-good. This log is the **only** source of fluency data from here on — never call `check_fluency`/`check_fluency_batch` again, and never pass `fluency: true` on any translate call, for a string that already has an entry here, even if it gets revised later.

**Step 3 — final, with glossary.** Call `translate_batch`/`translate_text` (or `translate_batch_async` — see below) again on the same texts, this time **with** `glossaryId` set to `project.json`'s `glossary_id`, and without `fluency` — this call's output is what actually gets written in 3.3. Step 1's translation is discarded; only step 3's is kept.

For steps 1 and 3: chunk to ≤20 texts per call (the API's hard cap on `translate_batch`/`translate_batch_async`); step 2's `check_fluency_batch` shares the same 20-item cap, so keep the same chunking across all three steps. If the batch you declared in 3.1 is larger, sub-chunk it here without changing what counts as "the batch" for 3.4's consistency check.

Pick the tool per step, independently:
- Steps 1 and 3 (`translate_batch` vs `translate_batch_async` + poll `get_translate_batch_async_status`) — `translate_batch` is the default, blocking until done; reach for the async form when dispatching several chunks (or several of these steps) concurrently and polling while you do other work is actually faster than waiting on each in turn. No fixed size threshold — use your judgment.
- `translate_text`/`check_fluency` — only for a single string (a one-off re-translation after a fix, or a chunk of exactly one). If it's a fresh string with no `tools/fluency_scores.jsonl` entry yet, it still needs its own step-1/step-2/step-3 sequence; if it's a revision of an already-scored string, skip straight to step 3 — it already has a score, and it doesn't get another one.
- **Agentic pipeline** (`POST /translation/agentic-translate`, then poll `GET /translation/agentic-translate/{id}` with `curl -H "X-Api-Key: $ALGEBRAS_API_KEY" "$ALGEBRAS_PLATFORM_URL/api/v1/translation/agentic-translate..."`) — the one case that's direct HTTP rather than MCP, because no MCP tool wraps it yet. Reserve it for the step-3 (glossary) call on strings where the extra "human-like" quality is worth **4x the credit cost** — hero/marketing copy. Steps 1-2 (the fluency baseline) still come from ordinary `translate_batch`/`check_fluency_batch` calls as above; don't call `check_fluency` again afterward to score the agentic result — per the no-second-measurement rule, once a string has a step-2 score, that's its only score.

Pass `contexts` (per-text, aligned by index) on both translate steps whenever you have row-level context (`Comment`, `Speaker`, `Addressee`, etc.) that would help the translation — the API doesn't see your project's columns unless you hand it over.

**Apply glossary terms exactly (step 3).** For source terms not yet in the glossary:
1. Search the web for established translations before coining your own.
2. If a reliable translation exists, create it immediately via `create_glossary_term` (see the `glossary` skill's 2.5 for the shape) rather than waiting until end of batch — later texts in this same session should get to use it too.
3. If you're unsure, flag the term and ask the user before translating.

The API returns translated text; it doesn't know your project's markup conventions unless you tell it. After step 3's response, verify yourself: all tags `<...>`, placeholders `{...}`, variables, numbers, and markup preserved exactly; speaker intent, addressee (singular/plural), register, and intensity matched. Use `prompt` on the translate call to steer this (e.g. "preserve all `{placeholder}` tokens exactly") when a chunk needs it, and re-translate (`translate_text`, with `glossaryId` and no `fluency`) any result that got it wrong rather than hand-editing the API's output yourself — this is a step-3 fix, not a new step 1/2.

For credits: translate roles and departments; preserve person names, company names, engine names, and middleware names unchanged — use `prompt` to convey this per chunk if the default output isn't respecting it.

## 3.3 Parse and write using generated tools

Use the parser from Phase 1 to write results. Write only step 3's (glossary-applied) output — never step 1's throwaway translation. Write only the target language field/column for the requested rows. Never overwrite source text or other columns. If no suitable tool exists, generate one before writing.

Verify the exact edited cells by parsing the file again after writing.

## 3.4 Mid-batch consistency check

After writing each batch (3.3), run the consistency-checking tool in incremental mode before moving to the next batch:

```
tools/check_term_consistency.<ext> --scope batch --batch <ids/range>
```

If this tool doesn't exist yet, generate it now — see the `qa` skill's 4.2 for the full method specification. It must be generic and format-agnostic, built on top of the Phase 1 parser, and support both `--scope full` and `--scope batch`.

This applies two checks — full method descriptions are in the `qa` skill's 4.2 — restricted to the rows in the batch just written, compared against everything already translated for that language (prior batches, other files, and the glossary):

- **Method A** (exact-duplicate source, zero heuristics): the batch's source strings that also occur elsewhere in the corpus must have the same target rendering everywhere.
- **Method B** (term-embedding, heuristic): terms with an established canonical rendering elsewhere in the corpus must be rendered consistently when embedded inside this batch's sentences.

**Review every finding before dismissing or accepting it** — the script raises signals, not verdicts. For each one, read the actual source/target context and append one line to `tools/consistency_findings.jsonl`:
- `confirmed` (status stays `open`) if it's a real inconsistency, or
- `false_positive` with a short reason if it isn't (e.g. a different part of speech, a deliberate valid variant, a polysemous homograph).

**This is a soft gate**: do not block starting the next batch on a confirmed finding. Leave it `open` in the findings log so the `qa` skill's full pass (4.2) has a ready-made map of everything flagged along the way, rather than fixing drift ad hoc mid-flow or losing track of it. Exception: if the fix is trivial and unambiguous (apply the already-established canonical rendering, no judgment call involved), you may fix it immediately and mark it `fixed-inline` in the same log instead of leaving it open.

## Next

Once translation is complete for the requested scope (all batches for this session translated and consistency-checked), continue with Phase 4 — invoke the `qa` skill (`algebras-agent:qa`) if skill invocation is available in this session, otherwise open and follow `skills/qa/SKILL.md` in full. To translate another batch, repeat from 3.1.
