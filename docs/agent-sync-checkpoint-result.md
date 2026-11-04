# Agent on the database: result (checkpoint C, agent side)

Run on 2026-11-04 against a local platform and the shared ai-service, acting as
the agent through the platform's MCP endpoint and REST API with a scratch
organization and API key. A temporary platform instance ran the phase's platform
branch; the shared ai-service and the instance it reports evaluation results to
ran the earlier code. Every row the run created was deleted afterwards. The UI side of C2 is the
platform's own check; here REST stands in for the UI.

**Result: C1-C4 pass on the agent side.** The runs found instructions in the
skills that lost data or could not be followed, and those are fixed (see
"What the runs changed in the skills").

## Input

- 36 strings from a real project's source file, with hand-written local context
  files covering every fact status, 2 target languages (C1, C2).
- 12 strings from the same file with no local context files, 2 target languages,
  a scratch glossary, fluency `none` (C3, C4). 10 strings per language were
  translated.

## C1: local context imports and reads back

Imported in chunks through `import_project`, after the context evaluation
finished, and compared with `reports/context-readback.mjs`.

| local status | facts compared | same | differ or missing | stored without status or source |
|---|---|---|---|---|
| resolved | 138 | 114 | 0 | 24 |
| candidate | 24 | 12 | 0 | 12 |
| conflict | 18 | 18 | 0 | 0 |
| open | 48 | 14 | 0 | 0 |

- The other 34 open facts have a value on the platform and are not differences:
  10 are suggestions the evaluation added, and 24 are formality covered by the
  project default. Imported suggestions kept their values through the evaluation.
- Strings: 36 local, 36 on the platform, 0 missing.
- Project context: 31 of 31 values the same. Placement and discourse: 24 of 24.
- Flagging, written through the platform branch: a conflict in a string's `issues`
  flags it, on an evaluated string too, and removing the issue clears the flag.
  A repeat of the read-back on that code gave 6 `not_flagged` results, all on
  strings whose last write was an evaluation result handled by the earlier code;
  the same string flagged correctly on its next write. Everything else matched.
- Facts stored without a status or source: pronoun referents, placeholder
  meanings and a flow's own facts have plain fields on the platform, so their
  content reads back but their status and source can't.

## C2: changes reach the other side; a stale write is refused

| check | result |
|---|---|
| A REST edit appears in `list_strings` with `changedSinceVersion` | 1 string, new value |
| `list_context_changes` shows the path and the actor | yes, `API_KEY` |
| A stale `update_string_contexts` | `conflict`, with `currentVersion` and `current`; nothing written |
| Re-read, re-apply, retry once | `ok`; REST reads the agent's value; the REST edit and `evaluation` are kept |
| A second stale write | `conflict`; nothing overwritten |
| A stale `update_project_context` | error result `conflict`, with the current copy; the retry is `ok` and both edits are kept |
| Unknown string | `not_found` |
| A confirmed fact with no source | `invalid` |
| Import of an edited string without `context` (what onboard does) | unchanged; the edit survives |
| Import of an edited string with `context` | the edit is overwritten, which is why onboard doesn't do this |
| A write that sends only some fields | `evaluation` and other fields are lost, which is why every write sends the whole record |

## C3: a platform-only project

| check | result |
|---|---|
| Project created first, then imported into by id | 12 strings created in it |
| Name, type, languages and glossary after the import | unchanged |
| Projects in the organization after the import | +0 |
| Translated and recorded as drafts, per language | 10 of 10 |
| Local context files read or created | 0 |
| Run report, first run | pass: 0 leaks, 20 of 20 recorded |

## C4: memory returns only approved translations

Each row is a lookup for a string whose translation was reviewed as stated.

| lookup | match |
|---|---|
| Approved, same source, speaker and addressee | yes |
| Approved, participants as the skill passes them (evaluator-suggested values) | yes |
| Approved, both participants stored as null, plain text | yes |
| Draft | no |
| Rejected | no |
| Different source text | no |
| Different speaker | no |
| Different addressee | no |
| Stored participants, lookup omits one or both | no |
| Stored as null, lookup sets a speaker or an addressee | no |
| Approved in another target language only | no |

Second run over the batch of 10: 2 approved matches, 8 misses, none of the
matches in the list sent to translation, and the run report passes (0 leaks; the
2 matches are the strings' own approved translations and are not recorded again).

## What the runs changed in the skills

- **Evaluation wait.** A context evaluation first wrote between 10 and about 230
  seconds after the import, so waiting for the version to stop moving ended too
  early. Onboard waits until every string has an evaluation, for at most 5
  minutes, then reports how many have none.
- **Platform-only projects.** `project.json` for a project with no local files is
  complete with empty context fields, and translate says where the work lands
  when there are no translation files.
- **Language spelling.** Translate says how to recover when a translate call
  refuses a code the project stores.
- **Evaluation noise.** Translate takes in the evaluation's writes and its own
  without telling the user: in the C1 project they were 115 of 118 change entries.
- **Character gender.** The key is required, with `null` when no source decides
  it; a character without it is `invalid`.

## Platform and ai-service findings

- `translate_batch` over MCP refuses `pt-BR` and accepts `pt_BR`, while projects,
  review and memory accept both.
- ai-service's `POST /v1/context/evaluate` returns 500 for an organization with
  the `custom_plan` entitlement: its entitlement enum doesn't have that value.
  No evaluation runs for that organization, and the import still succeeds.
- A chunked import can leave strings unevaluated. A request that arrives while a
  run is active gets `already_running` and no later run follows, so strings
  imported during it stay unevaluated: 24 of 36 in one run, still so after several
  minutes. Agents have no way to start another run.

## Not verified

- The UI itself (C2): REST stood in for it.
- The New project dialog: the project was created through REST.
- Evaluation results written by the platform branch: the shared services report
  to the earlier code, so flagging on that write path wasn't exercised here.
- The workflow files for other agents, which were not part of this run.
- Onboard's discovery steps against a repository: the context files were written
  by hand and the import payload by a local script following 1.6, so generating
  them with an agent wasn't exercised.
