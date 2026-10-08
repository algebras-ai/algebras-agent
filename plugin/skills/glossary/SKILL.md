---
name: glossary
description: Phase 2 of the Algebras translation workflow (Glossary Bootstrap) — extract candidate terms, research established translations, and create a validated glossary on the Algebras platform. Requires a completed project.json from the onboard phase.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, WebSearch, mcp__algebras__list_glossaries, mcp__algebras__create_glossary, mcp__algebras__get_glossary, mcp__algebras__create_glossary_term, mcp__algebras__bulk_create_glossary_terms]
---

# Phase 2 — Glossary Bootstrap

Glossaries are not local files. They are a resource on the Algebras platform, created and populated through the `algebras` MCP server's glossary tools, and referenced from translation calls by `glossaryId`. This phase's job is to get a `glossary_id` into `project.json` and confirmed terms into that glossary — never to write a glossary file to disk.

## Prerequisites

- Requires a complete `project.json` (Phase 1 output) — `source_lang`, `target_langs`, `files`, `source_field`, and `target_fields` must all be populated with real values, not placeholders.
- If `project.json` is missing or incomplete: stop and invoke the `onboard` skill (`algebras-agent:onboard`) first, or read `skills/onboard/SKILL.md` if skill invocation isn't available in this session.
- If the glossary already has usable content (per 2.1 below), most of this phase is a no-op — confirm its current state with the user and move straight to `translate`. Never rebuild an existing glossary from scratch unless the user explicitly asks.

## 2.1 Check glossary state

If `project.json`'s `glossary_id` is already set, call `get_glossary` with it and treat that as the current state — skip straight to reporting the term count to the user (see below). Don't create a second glossary for the same project.

If `glossary_id` is `null`:
1. `list_glossaries` is paginated (50 per page by default) and each glossary in the response carries its full terms — don't assume the first page is the whole org. Page through it (`page: 1, 2, 3, ...`) checking each page for a name match against this project, and stop as soon as you find one or as soon as `pagination.totalPages` is exhausted. Cap it at 20 pages (1,000 glossaries) — if you haven't found a match by then, stop and ask the user rather than continuing to page indefinitely.
2. If a glossary already exists whose name matches this project (e.g. from an earlier session that didn't save it back to `project.json`), offer to reuse it instead of creating a duplicate.
3. Otherwise call `create_glossary` with a name derived from the project (e.g. `project.json`'s `name`) and `languages` set to `source_lang` plus every `target_langs` entry.
4. Write the returned glossary `id` into `project.json`'s `glossary_id` immediately, so a crash or restart doesn't orphan it.

Report the result: "Glossary `<name>` (`<id>`) — `<N>` existing terms" (or "0 — empty, ready for bootstrapping").

Before extracting new candidates in 2.2, check `project.json`'s `context_files.glossary`. If it lists one or more client glossary files, read them and propose those terms for import. Present them in the same confirmation table as 2.4, before any candidates extracted from source strings. Do not import silently, and do not call `bulk_create_glossary_terms` until the user accepts the rows. Accepted rows go through the 2.5 bulk create flow. Map each term's type, definition, translation, and grammatical gender onto the existing `definitions[]` shape — when the platform schema has no separate gender field, record grammatical gender inside the definition text. Terms the user skips are not created. Then continue with 2.2 for terms that are still missing.

## 2.2 Extract candidate terms

Read all source strings in the files to be processed. Identify terms worth pinning to the glossary:
- Proper nouns: character names, place names, organization names, product names
- Technical or domain-specific vocabulary
- UI element labels that need consistent rendering
- Game mechanics, lore titles, item names, ability names
- Any word that appears frequently and can be translated multiple ways

Aim for quality over quantity. Skip terms whose translation is obvious and unambiguous.

## 2.3 Research established translations

For each candidate term, use web search to find whether an official or widely-used translation already exists in each target language:

- Search: `"<term>" translation <target language>` and `"<term>" <target language> official localization`
- Prefer: publisher/vendor official localizations → widely-adopted community translations → professional dictionaries
- If multiple translations coexist, pick the most authoritative one as the rendering you'll propose — there's no separate "variants" slot in the platform's glossary schema, so don't try to record alternatives alongside it.
- If a translation is known to be misleading or actively wrong, don't create a term for it at all — the glossary only stores what to use, not what to avoid. Note the risk for the `translate` skill to watch for manually instead (there is no `forbidden` concept on the platform).

## 2.4 Confirm with user

Present your proposals before creating anything. For terms where you're uncertain (confidence = low), flag them explicitly:

> | # | Source term | Definition | [de] | [fr] | Confidence |
> |---|---|---|---|---|---|
> | 1 | Dragon Stone | Rare magical artifact | Drachenstein | Pierre du Dragon | high |
> | 2 | Blink | Teleport dash ability | Blinken? | ? | low — please advise |
>
> **Actions**: Accept all / Edit a row (reply with row number + correction) / Skip a term / Add a term

Do not create a glossary term until the user accepts it. Terms with low confidence must be resolved before translation starts. If the user rejects a suggestion, record the correct form and the reason.

## 2.5 Create the terms

Each accepted row becomes one glossary term with one `definitions[]` entry per language you have a confirmed rendering for — `language` (code), `term` (the rendering in that language), `definition` (a short, language-neutral gloss of what the term means; reuse the same definition text across languages unless the meaning itself shifts). For the row above:

```json
{
  "definitions": [
    { "language": "en", "term": "Dragon Stone", "definition": "Rare magical artifact" },
    { "language": "de", "term": "Drachenstein", "definition": "Rare magical artifact" },
    { "language": "fr", "term": "Pierre du Dragon", "definition": "Rare magical artifact" }
  ]
}
```

Push all accepted rows from this session in one `bulk_create_glossary_terms` call against `project.json`'s `glossary_id` (falls back to one `create_glossary_term` call per row if you're only adding a single term mid-translation — see the `translate` skill's 3.2). Check the response for partial failures (bulk create returns `successful`/`failed` when not everything lands) and surface any failures to the user rather than silently dropping them. There is no separate validation step — the platform enforces the schema on write.

## Next

Once accepted terms are created and every low-confidence term has been resolved with the user, continue with Phase 3 — invoke the `translate` skill (`algebras-agent:translate`) if skill invocation is available in this session, otherwise open and follow `skills/translate/SKILL.md` in full.
