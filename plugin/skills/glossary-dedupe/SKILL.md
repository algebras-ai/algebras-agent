---
name: glossary-dedupe
description: Optional glossary maintenance — creates (if missing) and runs a deduplication script across all glossary terms to catch exact duplicates, near-duplicate variants, and conflicting canonical translations. Always confirm with the user before running. Usable standalone at any point once a glossary exists, and referenced from the translate skill before the first batch of a session.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep]
---

# Glossary Deduplication (optional maintenance)

## Prerequisites

- Requires an existing glossary with content (Phase 2 output). If no glossary exists yet, there's nothing to deduplicate — invoke the `glossary` skill (`algebras-agent:glossary`) first, or read `skills/glossary/SKILL.md` if skill invocation isn't available in this session.

## Always ask first

This step is optional and must never run silently or automatically. Before doing anything else, confirm with the user:

> "Want me to run a deduplication check across all glossary terms? It looks for exact duplicates, near-duplicate variants, and conflicting canonical translations. (optional)"

Only proceed once the user explicitly agrees. If they decline or don't respond, stop here — do not generate or run the tool.

## D.1 Generate or reuse the dedup tool

Check `tools/` for an existing `tools/dedupe_glossary.<ext>`. If it doesn't exist, generate one:
- Build it on the glossary's actual schema and format (whatever Phase 2 chose — TSV pair, JSON, flat list, etc.) using the same parsing approach as `tools/validate_glossary.<ext>`, not a new bespoke reader.
- Must be generic and reusable — no hardcoded terms, languages, or paths.
- Detect at minimum:
  - **Exact duplicates** — identical source term (case/whitespace-normalized) appearing more than once.
  - **Near-duplicates** — case, diacritic, whitespace, or singular/plural variants of what is likely the same underlying term.
  - **Conflicting canonical translations** — the same or near-duplicate source term mapped to different `canonical_term` values for the same target language.
- Test it on a small sample before running it on the full glossary.

## D.2 Run across all terms

```
tools/dedupe_glossary.<ext> --scope full
```

## D.3 Confirm resolutions with the user

Present findings as a table — never auto-merge or auto-delete an entry:

> | # | Term A | Term B | Relationship | Suggested resolution |
> |---|---|---|---|---|
> | 1 | Blink | blink | exact duplicate (case) | merge → "Blink" |
> | 2 | Dragon Stone | Dragonstone | near-duplicate | merge? please confirm |
> | 3 | Health Potion | Healing Potion | conflicting [de] canonical | pick canonical, keep the other as variant or forbidden |
>
> **Actions**: Merge / Keep both as distinct terms / Edit before merging / Skip

Apply only user-approved merges. For any conflict resolution, record the decision and reason (the same discipline as glossary skill 2.4).

## D.4 Re-validate

After applying any merges, run `tools/validate_glossary.<ext>` and fix any schema errors before finishing.

## Next

This is a standalone maintenance step, not a numbered pipeline phase — it has no automatic handoff. Return to wherever you were in the pipeline (typically the `translate` skill, before the first batch) once done.
