---
name: glossary
description: Phase 2 of the Algebras translation workflow (Glossary Bootstrap) — extract candidate terms, research established translations, and create a validated glossary on the Algebras platform. Requires a completed project.json from the onboard phase.
allowed-tools: [Read, Write, Edit, Glob, Grep, WebSearch, mcp__algebras__list_glossaries, mcp__algebras__create_glossary, mcp__algebras__get_glossary, mcp__algebras__create_glossary_term, mcp__algebras__bulk_create_glossary_terms, mcp__algebras__list_glossary_terms, mcp__algebras__list_glossary_term_types, mcp__algebras__create_glossary_term_type, mcp__algebras__set_glossary_term_status]
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

Then call `list_glossary_term_types` once and keep the keys it returns: the built-in types (`character`, `item`, `location`, `mechanic`, `ui_label`, `other`) plus the organization's own. Every term gets one of these keys as its `type`. Only built-in keys change how a term is handled (a `character` needs a gender in each gendered target language); the organization's own types are labels for grouping and filtering. If the project's terms need a category none of the keys fits, propose a new type in the 2.4 table — a lowercase snake_case `key` and a `name` — and create it with `create_glossary_term_type` only after the user accepts it; otherwise use `other`.

## 2.1b Import the client's glossary

Before extracting new candidates, check `project.json`'s `context_files.glossary`. If it lists client glossary files, read them and propose their terms for import — in the same confirmation table as 2.4, before any candidates extracted from source strings. Never import silently, and don't call `bulk_create_glossary_terms` until the user accepts the rows; accepted rows go through 2.5, skipped rows are not created. Skip terms the platform glossary already has — check each with `list_glossary_terms` and `search` (a case-insensitive substring of a term or definition, in any language).

Map each client term onto the term shape in 2.5:
- The client's type or category → the term's `type`, one of the keys from 2.1. A client category with no matching key is a proposed new type (2.1), or `other`.
- Definition and translation → each language's `definition` and `term`.
- Grammatical gender → that language's `gender` (`masculine`, `feminine`, `neuter`, `common` or `none`).
- Client glossaries often mark inflection and variants: `stem|ending` (no spaces around `|`) is an inflection stem — store the full form as the term; `variant | variant` (spaces around `|`), a second target column or a gendered form (e.g. a feminine form of a title) is a second approved form — store the first as the `term` and the others in that language's `variants` as `{ "gender": ..., "term": ... }` (`gender: "none"` for a form that isn't gendered, such as a synonym); `*` is a prefix wildcard — store the base form. The local term matching in translate (step 4) reads `variants`.

Then continue with 2.2 for terms that are still missing.

## 2.2 Extract candidate terms

Read all source strings in the files to be processed. Identify terms worth pinning to the glossary:
- Proper nouns: character names, place names, organization names, product names
- Technical or domain-specific vocabulary
- UI element labels that need consistent rendering
- Game mechanics, lore titles, item names, ability names
- Any word that appears frequently and can be translated multiple ways

Aim for quality over quantity. Skip terms whose translation is obvious and unambiguous.

Use the project's flow (`project.json`'s `project_type`, or the file's entry in `file_flows`; see "Glossary emphasis" in `PROJECT_TYPES.md`) to decide which kinds of terms matter most — e.g. games: identical rendering across UI, quests and dialogue; edtech: one subject term across every lesson, code/formulas/units untranslated; fintech: one term per money state and fee, where a near-synonym of a locked status is the wrong term; saas: feature names and UI actions, so help text can match the button — and read the files in `project.json`'s `context_files` — lore bibles, product docs and style guides are prime sources of names and terminology. Where the repo already has translations (onboard 1.2c), use their existing renderings as the first candidate for each term.

## 2.3 Research established translations

For each candidate term, use web search to find whether an official or widely-used translation already exists in each target language:

- Search: `"<term>" translation <target language>` and `"<term>" <target language> official localization`
- Prefer: publisher/vendor official localizations (for `fintech`: the client's existing legal translations, then the regulator's published glossary) → widely-adopted community translations → professional dictionaries
- If multiple translations coexist, pick the most authoritative one as the rendering you'll propose. An alternative that is also correct (an established synonym, or a gendered form) goes into that language's `variants`; one that is merely in use doesn't.
- If a translation is known to be misleading or actively wrong, don't create a term for it at all — the glossary only stores what to use, not what to avoid. Note the risk for the `translate` skill to watch for manually instead (there is no `forbidden` concept on the platform).

## 2.4 Confirm with user

Present your proposals before creating anything. For terms where you're uncertain (confidence = low), flag them explicitly:

> | # | Source term | Type | Definition | [de] | [fr] | Confidence |
> |---|---|---|---|---|---|---|
> | 1 | Dragon Stone | item | Rare magical artifact | Drachenstein (m.) | Pierre du Dragon (f.); also: Pierre de Dragon | high |
> | 2 | Blink | mechanic | Teleport dash ability | Blinken? | ? | low — please advise |
>
> New type proposed: `spell` — "Spell" (rows 4, 9). Accept / use `other` instead
>
> **Actions**: Accept all / Edit a row (reply with row number + correction) / Skip a term / Add a term

Show the grammatical gender for each rendering in a gendered language, and the variants after it. A `character` term whose gender is unknown in a gendered target language has low confidence. Do not create a glossary term until the user accepts it. Terms with low confidence must be resolved before translation starts. If the user rejects a suggestion, record the correct form and the reason.

## 2.5 Create the terms

Each accepted row becomes one glossary term. A new term starts as a `candidate`; 2.6 approves it.
- `type` — the type key from 2.4.
- `definitions[]` — one entry per language you have a confirmed rendering for: `language` (code), `term` (the rendering in that language), `definition` (a short, language-neutral gloss of what the term means; reuse the same definition text across languages unless the meaning itself shifts), `gender` for a language with grammatical gender, and `variants` for its other approved forms.

For the row above:

```json
{
  "type": "item",
  "definitions": [
    { "language": "en", "term": "Dragon Stone", "definition": "Rare magical artifact" },
    { "language": "de", "term": "Drachenstein", "definition": "Rare magical artifact", "gender": "masculine" },
    { "language": "fr", "term": "Pierre du Dragon", "definition": "Rare magical artifact", "gender": "feminine",
      "variants": [{ "gender": "feminine", "term": "Pierre de Dragon" }] }
  ]
}
```

Push all accepted rows from this session in one `bulk_create_glossary_terms` call against `project.json`'s `glossary_id` (falls back to one `create_glossary_term` call per row if you're only adding a single term mid-translation — see the `translate` skill's 3.2). Check the response for partial failures (bulk create returns `successful`/`failed` when not everything lands) and surface any failures to the user rather than silently dropping them. There is no separate validation step — the platform enforces the schema on write. An unknown `type` key fails the whole bulk call, so use only keys from 2.1 and types created there.

## 2.6 Approve the terms

New terms are candidates. Translation prompts and the glossary counter (`count_glossary_terms`) use approved terms only, so a term counts once it is approved. A term's status covers all its languages: `candidate`, `approved` or `not_a_term`.

Call `list_glossary_terms` with `status: "candidate"` — this covers the terms just created and candidates left from earlier sessions or from translate 3.5 — and show them as a table:

> | # | Source term | Type | [de] | [fr] | Created |
> |---|---|---|---|---|---|
> | 1 | Dragon Stone | item | Drachenstein (m.) | Pierre du Dragon (f.); also: Pierre de Dragon | this session |
> | 2 | Flight Dart | mechanic | Flugpfeil (m.) | Fléchette de vol (f.) | translate 3.5 |
>
> **Actions**: Approve all / Approve rows (list the numbers) / Mark a row not a term / Keep as candidate

Never approve a term the user hasn't approved in this table, and don't offer a low-confidence term until it's resolved. For each row the user approves, call `set_glossary_term_status` with `glossaryId`, the term's `termId` and `status: "approved"`; for a row they reject, `status: "not_a_term"`. The platform records the approval against the API key. The user can also approve terms on the glossary page in the Algebras platform UI.

Editing an approved term's texts, gender or variants with `update_glossary_term` (e.g. adding a variant or an inflected form) moves it back to `candidate`; changing only its `type` doesn't. After the user confirms the edit, approve it again with `set_glossary_term_status`.

Report how many terms are approved and how many are still candidates. Candidates left at this point are `glossary-candidate`s in translate: consistency hints, never locks.

## Next

Once accepted terms are created, every low-confidence term has been resolved with the user, and the user has decided which candidates to approve (2.6), continue with Phase 3 — invoke the `translate` skill (`algebras-agent:translate`) if skill invocation is available in this session, otherwise open and follow `skills/translate/SKILL.md` in full.
