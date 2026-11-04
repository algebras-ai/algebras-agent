# TM-first run: result (checkpoint B4)

Run on 2026-11-04 against a local platform (review API, translation memory,
glossary counter) and ai-service, following `docs/tm-first-checkpoint.md`.
Everything was seeded and run through the platform's REST API with a scratch
API key; every row the run created and the key were deleted afterwards.

**Result: pass.** No string found in translation memory was sent to
translation, every written string was recorded for review, and glossary
compliance before and after the final glossary pass is reported per language
and agrees with `glossary_compliance.json`.

## Input

- A game's UI and dialogue strings (gettext PO), English source, 3 target
  languages (pl, tr, pt-BR).
- Sample: 24 strings per language — 12 with an earlier translation from an
  older export of the same project, 12 without one. 69 distinct strings were
  imported into a scratch platform project.
- Translation memory: the 12 earlier translations per language (36 in all)
  recorded with `record_translations` (`origin: manual`, stored as approved).
- Glossary: 57 terms from the project's own glossary, all approved; case mode
  `capitals` for names and `ignore` for ordinary words. Fluency: `none`.

## Translation memory

| lang | approved matches | written as is | re-translated (check failed) | misses translated |
|---|---|---|---|---|
| pl | 13 | 13 | 0 | 11 |
| tr | 12 | 11 | 1 | 12 |
| pt-BR | 12 | 12 | 0 | 12 |

pl has 13 matches from 12 seeds because one unseeded sample string has the
same source text as a seeded one. The tr re-translation is a match whose
numbers differed from the source; it went to a single-string step-3 fix, as
3.2.0 says.

## Run checks (`run-report.mjs`)

| check | result |
|---|---|
| TM-hit strings sent to a translate call | **0** |
| Written strings | 72 |
| Recorded as drafts (`record_translations`, machine) | 36 |
| Approved matches not recorded again (already the string's approved translation) | 36 |
| Written strings not recorded | **0** |
| Compliance recomputed from the pass log = `glossary_compliance.json` | yes |
| Exit code | 0 |

A copy of the run's logs with one approved match added to a step-3 call fails
the report (`TM-hit strings sent to translation: 1`, exit 1).

## Glossary compliance (before → after the final pass)

| lang | strings with terms | MISS before | compliant before | MISS after | compliant after | term occurrences before | term occurrences after |
|---|---|---|---|---|---|---|---|
| pl | 13 | 2 | 84.6% | 2 | 84.6% | 15/18 (83.3%) | 15/18 (83.3%) |
| tr | 11 | 4 | 63.6% | 4 | 63.6% | 8/13 (61.5%) | 8/13 (61.5%) |
| pt-BR | 8 | 3 | 62.5% | 1 | 87.5% | 6/10 (60%) | 8/10 (80%) |

Final pass status per language (strings): pl 22 ok, 1 accepted, 1 user;
tr 20 ok, 4 user; pt-BR 21 ok, 2 fixed, 1 user.

- 6 of the 7 MISSes left after the pass are approved translation-memory
  matches: older human translations that predate the glossary's current
  terms. The final pass never overwrites an approved translation, so they go
  to the user (`status: user`).
- 1 is a source-side false match (a two-word term matched across two
  separate words of a longer name); the translation is correct and it is
  `accepted` with that reason.
- 2 machine-translated MISSes were fixed by the final pass (pt-BR).
- Strings with a glossary gap (a term with no rendering in that language,
  not counted as a MISS): tr 1, pt-BR 4.

## What the run changed in the skills

- **Participants in the TM lookup.** Approved translations are stored with the
  string's speaker and addressee as its platform context holds them,
  including values the context evaluator suggested. A first attempt that
  passed plain source strings matched only 2 of 12 seeds per language; the
  translate skill (3.2.0) passes the stored values.
- **Glossary gaps.** The counter reports a term with no definition in the
  target language with `targetCount: 0`. The skills (translate 3.4/3.5,
  qa 4.2) report it as a glossary gap, not a MISS a re-translation could
  fix.

## Platform findings (reported to the platform pane)

- At run time `POST /translation/translate-batch` accepted only `pt_BR`,
  while projects, the review API, the TM lookup and the glossary counter
  accepted `pt-BR`; the run translated with `pt_BR`. The platform branch
  accepts both spellings from commit `d78ea9c`.
- One `translate-batch` call returned a 500 once; the same call succeeded on
  retry.
