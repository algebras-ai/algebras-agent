# Context requirements

What the translation agent expects from the client, and how that material is used. The eight sections below are the Context entity of the Algebras Agentic Workspace. Onboarding imports a client folder laid out this way into the platform project without conversion.

Which sections a project needs, and which extra facts it collects, is the flow in `PROJECT_TYPES.md`: `games`, `edtech`, `fintech`, `saas`, or `general`. Games use the social graph and the speaker-to-listener matrix. The other flows use one address form for the whole product and do not build that matrix unless the file actually has speakers. The language-forced table below still decides which person facts a dialogue line needs.

A fact is resolved only from a cited source: one of these files, a column in the source table, an official page for the same UI, or an explicit answer from the user (see [Fact model](#fact-model)). The agent does not guess. If a file is missing, translation still runs; the unknown fact stays open and becomes a client question for the project manager to forward.

## Where context lives

The Algebras platform project is the single source of truth for context. Its project context (description, defaults, characters, relations, style, notes) and the per-string context of every string are stored on the platform, versioned, and read and written through the `algebras` MCP server's context tools: `import_project`, `get_project_context`, `update_project_context`, `list_strings`, `get_string_context`, `update_string_contexts` and `list_context_changes`. People edit the same records in the platform UI, so the agent re-reads them before each batch instead of trusting what it read earlier.

The full structure of both records, field by field with where to find each value, is in `CONTEXT_SCHEMA.md`.

`project.json`'s `project_id` names the platform project. Local files are never the store: `context_pack.json` and `context_facts.jsonl` are the import input onboard builds from the repo (see onboard 1.6), `tools/context_cache.json` is a disposable copy written only when a local tool needs the context, and `client_questions.md` is an export of the project's question notes.

**Versions.** Two numbers are easy to mix up. A record's own `version` (`context.version`, on the project context and on each string) is the `baseVersion` of a write to that record. The project-wide `contextVersion` (`project.contextVersion` from `get_project_context`, `contextVersion` from `list_strings`) moves with every change in the project and is what `changedSinceVersion` and `list_context_changes`' `sinceVersion` take.

**Writes.** A write replaces the whole record. Start from the `context.data` you read, change only the facts you mean to change, and send all of it, including `evaluation` and every other field, or what you leave out is lost. A write passes the version it was based on (`baseVersion`) and a `source`. A write based on a stale version is refused with a `conflict` and the server's current copy. Then the agent:

1. re-reads the record (`get_string_context` or `get_project_context`);
2. re-applies its change to the fresh copy if the change still makes sense there, and retries once;
3. if the retry conflicts too, or the fresh copy already decides the point differently, does not overwrite it: it reports the string, the server's value and who changed it (`list_context_changes`) to the user.

An `invalid` result means the payload broke the schema: fix it and retry, or report it. `not_found` means the string isn't on the platform: import it (onboard 1.6). `update_string_contexts` reports these per item, as `status`. `update_project_context` returns them as an error result with `error: "conflict"`, `"invalid"` or `"not_found"`, and a conflict there also carries `currentVersion` and `current`.

## The eight sections

| Section | What it holds | How the agent uses it | Needed for |
|---|---|---|---|
| Glossary | Terms with type, definition, translation, grammatical gender and variants per language | Imported into the platform glossary in the glossary phase; enforced in QA | All projects |
| History & decisions | Past decisions, notes, open questions | Prevents re-asking settled questions; open questions feed the client list | Optional |
| Universe | Setting, era, lore, product description | Sent as context with translation requests | Games, marketing |
| Tone of voice | Style guide per language, short brief, formality matrix by speaker and listener | Steers register; the matrix resolves tu/vous and speech levels | Games, marketing, UI |
| Social graph | Characters with gender and description; relationships with type and tone | Resolves speaker gender and formality per line | Games, dialogue, subtitles |
| UX screenshots | Images linked to string keys or row numbers, stored on the platform (`onboard` 1.6b) | Resolves UI meaning, length limits, and ambiguous labels | UI, games |
| Integrations | memoQ, Gridly, Google Sheets, GitHub settings | Recorded only; no live connection from the agent | Optional |
| Files | Any other reference documents | Stored on the platform (`onboard` 1.6b); read as reference when relevant | Optional |

## Accepted formats

Text: Markdown, TXT, DOCX, PDF, CSV, XLSX. Screenshots: PNG, JPG, GIF. Any file name is accepted. The agent classifies a file by what it contains, not by what it is called.

## Recommended folder layout

Optional. Never required. When a client wants a predictable place to put things:

```
context/glossary.*
context/tone_of_voice.*
context/characters.*
context/universe.*
context/screenshots/
```

Files outside this layout are still classified and used.

## Column hints in the source table

These columns resolve facts without any extra file:

| Column | Fact it resolves |
|---|---|
| Speaker | Who says the line |
| Addressee | Who is being spoken to |
| Comment | Notes, referent, placeholder meaning |
| Context | Scene, screen, or surrounding situation |
| Max length | UI length limit |
| Screenshot | Link or file name of the screen for that row |

A dialogue export with speaker and addressee columns usually resolves the largest number of open facts. Column names in the real file may differ; the agent matches them by what the column contains.

## Screenshot linking

The agent links a screenshot to a string in this order:

1. A table column that holds a link, a file name, or an image for that string key or row.
2. A file whose name matches the string key or row, such as `MENU_START.png`, `334.jpg`, or `row_334.png`.
3. A capture runner spec the agent can write when the client has a playable build: Playwright for a browser build, PyAutoGUI for a desktop build, or Appium for a mobile build. The agent writes the spec only; it does not run the capture unless the user explicitly allows it.

If none of the three is available, the agent skips screenshots and reports screenshot coverage as 0%.

## Language-forced facts

Guidance only. The agent re-checks this table for the project's actual target languages before treating a fact as not needed. A fact is required when that language's grammar forces a choice the English source does not encode.

French needs both speaker gender (agreement) and tu/vous. German needs du/Sie and singular vs plural "you" for most lines, and does not need speaker gender. Japanese needs a speech level, and does not need pronoun gender.

| Fact | Usually required | Usually not required |
|---|---|---|
| Speaker gender | French, Spanish, Italian, Portuguese, Russian, Polish, Arabic | German, Dutch, Swedish, English, Turkish, Chinese, Japanese, Korean |
| Addressee gender | French, Spanish, Italian, Portuguese, Russian, Polish, Arabic | German, Dutch, English, Turkish, Chinese, Japanese, Korean |
| Addressee number | French, German, Spanish, Italian, Portuguese, Russian, Polish, Dutch, Swedish, Turkish, Arabic, Chinese | English, Japanese, Korean |
| Formality | French (tu/vous), German (du/Sie), Spanish (tú/usted), Italian (tu/Lei), Portuguese (tu/você), Russian (ты/вы), Polish (ty/pan/pani), Dutch (jij/u), Turkish (sen/siz), Japanese (speech level), Korean (speech level), Arabic. Chinese 你/您 when the relationship is unequal | English, Swedish (du is the modern default) |
| Pronoun referent | French, Spanish, Italian, Portuguese, German, Russian, Polish, Dutch, Arabic, written Chinese (他/她/它) | Japanese, Korean. English when the source pronoun is already explicit |
| Placeholder meaning | Every target language when the token does not name its referent (`{0}`, `%s`). Gendered languages also need that referent's gender and number | A placeholder whose name is already explicit (`{player_name}`), unless agreement still needs a gender |

## Fact model

Every context fact the agent works with, whether it comes from onboard intake or from the per-batch ambiguity check in translate, has one of these statuses:

| Status | Meaning | Sent to translation | Lock for context-aware fluency |
|---|---|---|---|
| `resolved` | A cited source decides it: a client file, a source-table column, a string id, an official page for this same UI, or an explicit user answer | Yes, as a hard constraint with its evidence | Yes |
| `candidate` | An inference, not confirmed | No | No |
| `conflict` | Two sources disagree, or a source says the client must decide | No | No |
| `open` | Nothing decides it | No | No |

### How a status is stored on the platform

| Status | Platform record |
|---|---|
| `resolved` | The fact with `status: "confirmed"`, its `value`, and a `source` (`{kind, ref, quote?}`). The platform rejects a confirmed fact without a source. |
| `candidate` | The fact with `status: "suggestion"` and its `value`. When the inference rests on something specific (a neighbouring line, a document), cite it as the `source` and put the reason in `quote`. |
| `conflict` | The fact is not set, and the string's `issues` has `{field, lang?, kind: "conflict", readings: [{value, source}]}` with every reading and its source, which flags the string (`flagged` is true for any issue, or for an open important fact from the context evaluation; `list_strings` with `flagged: true` finds these). A conflict on a project fact goes in the project's `issues`. |
| `open` | The fact is not set. `list_strings` with `missingFact` finds these strings. |

Source kinds: a client file is `document` (`ref`: path and anchor, `quote`: the line); a source-table column is `string` (`ref`: `<externalKey>:column:<name>`); another string is `string` (`ref`: its external key); a screenshot is `screenshot`; an official web page is `document` (`ref`: the URL, `quote` required); an answer from the user is `user`; a glossary card is `glossary` (`ref`: the term id).

### Where each fact goes

| Fact | Platform field |
|---|---|
| Speaker | String `speaker` (a character id; a fact whose `value` is `null` for narration and UI) |
| Speaker gender | That character's `gender` in the project context. Gender doesn't vary by target language: one value for every language, and languages that disagree make a `conflict` |
| Addressee | String `addressee` (a character id, `"user"` for the product's user, a fact whose `value` is `null` for nobody in particular) |
| Addressee gender | That character's `gender` |
| Addressee number | String `addresseeNumber` (`Sing` or `Plur`) |
| Formality, per target language | `relations[].register[lang]` for a speaker-to-listener pair, `defaults.userRegister[lang]` for text addressed to the product's user, string `register[lang]` for a string that differs from both. Values `Infm` or `Form`. A matrix cell the client must decide is `null` |
| Pronoun referent | String `referents[]` (`text`, `characterId`, `gender`, `number`) |
| Placeholder meaning | String `placeholders[]` (`name`, `meaning`, `kind`: `count`, `name`, `number`, `date` or `other`, plus `gender`/`number` when agreement needs them) |
| UI role, length limit, screen | String `placement` (`contentType`, `maxLength`, `screen`, `note`) |
| Scene, section, previous line | String `discourse` |
| Tone of voice, brief | Project `style.tone[lang]`, `style.brief[lang]` |
| Settled decisions, open client questions | Project `notes` with `kind: "decision"` or `kind: "question"` |

Each string has an `externalKey` built from its file and its id or row (`<file>#<id>`), so importing the same files again updates the same strings.

Tags record how a string was handled under an unresolved point. They are never evidence and never locks:

| Tag | Meaning |
|---|---|
| `agent-choice` | The agent picked a reading for an `open` point because the wording had to commit. The reason is a guess. |
| `provisional` | Wording written under a `conflict`. One document note explains the conflict. |
| `glossary-candidate` | A repeating label or formula with no approved glossary card yet: no card, or a card with `status: "candidate"`. It becomes a lock only after the user approves the card (the `glossary` skill's 2.6, or the platform UI). |

An `agent-choice` reading is written to the platform as a `suggestion` without a source, so nobody reads it as decided; a `provisional` string stays `flagged` through the conflict in its `issues`. The tags themselves are kept in the translate phase's fluency log (`tools/fluency_scores.jsonl`, `tags`).

Glossary term status is counted locally, never by a model: `HIT` (an approved card's form — its `term` or one of its `variants` — is in the target; that span is a lock), `MISS` (approved form absent), `UNSURE` (a homograph in a segment that is not term-only; no lock). A segment whose source is only existing glossary spans is **term-only**.

## Authority order

When sources disagree, the higher one wins:

1. The project glossary, for terms that already have a card.
2. The source file and client context: neighbors, keys, columns, descriptions, screenshots, the context files above.
3. Official pages for the same product and the same UI.
4. Anything else is a clue. Two clues that point different ways are recorded as a `conflict` with both sources; the agent does not pick a winner.

## Web product pass

Once per project, during onboard intake, the agent searches the product's official site, store page and wiki. It reads the page and quotes the line that supports a fact, with its URL. A search snippet is not evidence. A marketing page that uses du/Sie or tu/vous is a clue: it resolves the address form only when it shows this same UI, or when the project has an explicit setting. Later, the translate phase searches again only for points that are still `open` or in `conflict` (query: product name plus the string).
