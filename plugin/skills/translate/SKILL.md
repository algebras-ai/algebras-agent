---
name: translate
description: Phase 3 of the Algebras translation workflow (Translation) — translate each batch via the Algebras MCP tools, write it with a generated parser, and run a mid-batch consistency check against everything already translated. Requires a completed project.json and a confirmed glossary.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, WebSearch, mcp__algebras__translate_text, mcp__algebras__translate_batch, mcp__algebras__translate_batch_async, mcp__algebras__get_translate_batch_async_status, mcp__algebras__create_glossary_term, mcp__algebras__list_glossary_terms]
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

## 3.2 Translate

Translate every batch through the `algebras` MCP server's translation tools — never generate the translated text yourself. Chunk each batch to ≤20 texts per call (the API's hard cap on `translate_batch`/`translate_batch_async`); if the batch you declared in 3.1 is larger, sub-chunk it here without changing what counts as "the batch" for 3.4's consistency check.

Pick the tool per chunk:
- **`translate_batch`** — the default. Blocks until the whole chunk is done; use this unless you have a specific reason to prefer async.
- **`translate_batch_async`** + poll `get_translate_batch_async_status` — use when it actually buys you something: a large session where dispatching several chunks (or several target languages) concurrently and polling them while you do other work (writing/QA on an earlier chunk) is faster than waiting on each one in turn, or when you're also requesting `fluency` scoring and want to avoid blocking on the extra evaluation time. There's no fixed size threshold — use your judgment on whether overlapping the wait is worth the extra poll step for the situation at hand.
- **`translate_text`** — only for a single string (a one-off re-translation after a fix, or a chunk of exactly one).
- **Agentic pipeline** (`POST /translation/agentic-translate`, then poll `GET /translation/agentic-translate/{id}` with `curl -H "X-Api-Key: $ALGEBRAS_API_KEY" "$ALGEBRAS_PLATFORM_URL/api/v1/translation/agentic-translate..."`) — the one case that's direct HTTP rather than MCP, because no MCP tool wraps it yet. Reserve it for strings where the extra "human-like" quality is worth **4x the credit cost**: hero/marketing copy, or a string QA already flagged as low-fluency that a normal re-translation didn't fix. Don't use it as the default path for ordinary batches.

Always pass `glossaryId` = `project.json`'s `glossary_id` (when set) so confirmed terms are enforced automatically, and pass `contexts` (per-text, aligned by index) whenever you have row-level context (`Comment`, `Speaker`, `Addressee`, etc.) that would help the translation — the API doesn't see your project's columns unless you hand it over.

**Apply glossary terms exactly.** For source terms not yet in the glossary:
1. Search the web for established translations before coining your own.
2. If a reliable translation exists, create it immediately via `create_glossary_term` (see the `glossary` skill's 2.5 for the shape) rather than waiting until end of batch — later texts in this same session should get to use it too.
3. If you're unsure, flag the term and ask the user before translating.

The API returns translated text; it doesn't know your project's markup conventions unless you tell it. After each response, verify yourself: all tags `<...>`, placeholders `{...}`, variables, numbers, and markup preserved exactly; speaker intent, addressee (singular/plural), register, and intensity matched. Use `prompt` on the translate call to steer this (e.g. "preserve all `{placeholder}` tokens exactly") when a chunk needs it, and re-translate (`translate_text`) any result that got it wrong rather than hand-editing the API's output yourself.

For credits: translate roles and departments; preserve person names, company names, engine names, and middleware names unchanged — use `prompt` to convey this per chunk if the default output isn't respecting it.

## 3.3 Parse and write using generated tools

Use the parser from Phase 1 to write results. Write only the target language field/column for the requested rows. Never overwrite source text or other columns. If no suitable tool exists, generate one before writing.

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
