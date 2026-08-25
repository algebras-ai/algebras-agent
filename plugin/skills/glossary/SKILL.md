---
name: glossary
description: Phase 2 of the Algebras translation workflow (Glossary Bootstrap) — extract candidate terms, research established translations, and write a validated project glossary. Requires a completed project.json from the onboard phase.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, WebSearch]
---

# Phase 2 — Glossary Bootstrap

## Prerequisites

- Requires a complete `project.json` (Phase 1 output) — `source_lang`, `target_langs`, `files`, `source_field`, and `target_fields` must all be populated with real values, not placeholders.
- If `project.json` is missing or incomplete: stop and invoke the `onboard` skill (`algebras-agent:onboard`) first, or read `skills/onboard/SKILL.md` if skill invocation isn't available in this session.
- If the glossary already has usable content (per 2.1 below), most of this phase is a no-op — confirm its current state with the user and move straight to `translate`. Never rebuild an existing glossary from scratch unless the user explicitly asks.

## 2.1 Check glossary state

Check whether the glossary has usable content. The glossary structure is whatever the user prefers — the agent adapts. If no glossary exists:

> "No glossary found. How would you like to store it?
> - **Two-file TSV** (`concepts.tsv` + `terms.tsv`) — structured, machine-checkable
> - **JSON** — good for programmatic access
> - **Flat list** — term + translation pairs, one per line
>
> I'll adapt to any format. No preference? I'll use two-file TSV."

Generate `glossary/README.md` documenting the chosen format so future sessions know the schema.

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
- If multiple translations coexist, record the most authoritative as `canonical_term` and the others as variants
- If a translation is known to be misleading, mark it `forbidden`

## 2.4 Confirm with user

Present your proposals before writing anything to disk. For terms where you're uncertain (confidence = low), flag them explicitly:

> | # | Source term | Definition | [de] | [fr] | Confidence |
> |---|---|---|---|---|---|
> | 1 | Dragon Stone | Rare magical artifact | Drachenstein | Pierre du Dragon | high |
> | 2 | Blink | Teleport dash ability | Blinken? | ? | low — please advise |
>
> **Actions**: Accept all / Edit a row (reply with row number + correction) / Skip a term / Add a term

Do not add terms to the glossary until the user accepts them. Terms with low confidence must be resolved before translation starts. If the user rejects a suggestion, record the correct form and the reason.

## 2.5 Write and validate the glossary

Write confirmed terms in the chosen format. Generate a validation tool (`tools/validate_glossary.<ext>`) if none exists. Run validation and fix any schema errors before proceeding.

## Next

Once the glossary is written, validated, and every low-confidence term has been resolved with the user, continue with Phase 3 — invoke the `translate` skill (`algebras-agent:translate`) if skill invocation is available in this session, otherwise open and follow `skills/translate/SKILL.md` in full.
