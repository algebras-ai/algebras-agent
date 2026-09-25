---
name: glossary-dedupe
description: Optional glossary maintenance — fetches every term from the glossary's Algebras platform record and checks for exact duplicates, near-duplicate variants, and conflicting canonical translations. Always confirm with the user before running. Usable standalone at any point once a glossary exists, and referenced from the translate skill before the first batch of a session.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, mcp__algebras__list_glossary_terms, mcp__algebras__update_glossary_term, mcp__algebras__delete_glossary_term]
---

# Glossary Deduplication (optional maintenance)

This still matters with an API-backed glossary: the platform does not enforce uniqueness on term text (`GlossaryTermDefinition` is keyed by `termId` + `language`, not by the term string), so exact and near-duplicate terms, and conflicting canonical translations, can and do accumulate across sessions exactly like they would in a local file.

## Prerequisites

- Requires an existing glossary with content (Phase 2 output) — `project.json`'s `glossary_id` must be set. If no glossary exists yet, there's nothing to deduplicate — invoke the `glossary` skill (`algebras-agent:glossary`) first, or read `skills/glossary/SKILL.md` if skill invocation isn't available in this session.

## Always ask first

This step is optional and must never run silently or automatically. Before doing anything else, confirm with the user:

> "Want me to run a deduplication check across all glossary terms? It looks for exact duplicates, near-duplicate variants, and conflicting canonical translations. (optional)"

Only proceed once the user explicitly agrees. If they decline or don't respond, stop here.

## D.1 Fetch every term

Call `list_glossary_terms` against `project.json`'s `glossary_id`, paging through the full result (it returns every term with its per-language `definitions`). This is the full-corpus source of truth — don't rely on term additions you happen to remember making earlier in the session.

## D.2 Detect duplicates

For a small glossary, reason over the fetched list directly. For a large one, generate `tools/dedupe_glossary.<ext>` that takes the JSON dump from D.1 as input (not a local glossary file — none exists) and detects, per language:
- **Exact duplicates** — two different `GlossaryTerm` entries whose `term` (case/whitespace-normalized) is identical for the same language.
- **Near-duplicates** — case, diacritic, whitespace, or singular/plural variants of what is likely the same underlying term.
- **Conflicting canonical translations** — the same or near-duplicate source-language term whose linked entries render a different target-language `term` for the same target language.

Test it on a small sample before running it over the full fetched list.

## D.3 Confirm resolutions with the user

Present findings as a table — never auto-merge or auto-delete an entry:

> | # | Term A | Term B | Relationship | Suggested resolution |
> |---|---|---|---|---|
> | 1 | Blink | blink | exact duplicate (case) | merge → "Blink" |
> | 2 | Dragon Stone | Dragonstone | near-duplicate | merge? please confirm |
> | 3 | Health Potion | Healing Potion | conflicting [de] canonical | pick canonical, keep the other flagged for the user |
>
> **Actions**: Merge / Keep both as distinct terms / Edit before merging / Skip

Apply only user-approved merges. For any conflict resolution, record the decision and reason (the same discipline as glossary skill 2.4).

## D.4 Apply merges via the API

For each approved merge: call `update_glossary_term` on the surviving `GlossaryTerm` with the union of both entries' `definitions` (the approved rendering per language), then `delete_glossary_term` on the redundant entry. There is no separate re-validation step — re-run `list_glossary_terms` afterward if you want to confirm the merge landed.

## Next

This is a standalone maintenance step, not a numbered pipeline phase — it has no automatic handoff. Return to wherever you were in the pipeline (typically the `translate` skill, before the first batch) once done.
