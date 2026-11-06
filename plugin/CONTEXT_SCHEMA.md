# Context schema

The structure the platform stores for a project's context and for each string's context, and where to find each value in a client's project. Fill in everything the project's files can answer: the platform, the translation agent and the people reviewing all read from these records.

The `get_context_schema` MCP tool returns the same structure as JSON Schema from the code the platform enforces. If this page and the tool disagree, the tool is right. How values get their status is in `CONTEXT_REQUIREMENTS.md` ("Fact model").

## A fact

Most values below are facts, not plain values:

```json
{ "status": "confirmed", "value": "Fem", "source": { "kind": "document", "ref": "context/people.md#mira", "quote": "Mira, the ship's captain; she" } }
```

| Field | Meaning |
|---|---|
| `status` | `confirmed` (a cited source decides it; `source` required) or `suggestion` (an inference) |
| `value` | The value; its type is given per field below |
| `source` | `{kind, ref, quote?}`. `kind`: `document` (file path and anchor, or a URL), `string` (an external key, or `<externalKey>:column:<name>`), `screenshot` (a screenshot id), `glossary` (a term id), `user` (the user's answer) |
| `actor` | Who wrote it. The server fills this in; don't send your own |

A fact left out means still undecided. A fact whose `value` is `null` means decided: nobody speaks, or nobody in particular is addressed. Never write a guess as `confirmed`.

## Project context

One record per project: `get_project_context`, `update_project_context`, and the `context` of `import_project`.

| Field | Type | Fill it from |
|---|---|---|
| `description` | text | The universe or product description: lore, setting, era, what the product does. Shown as "Universe" in the UI |
| `characters[]` | list | Every person, narrator or named voice in a character sheet, a lore file or a speaker column |
| `characters[].id` | slug | A slug of the name. Speakers, addressees and relations refer to it |
| `characters[].name` | text | The name as the source writes it |
| `characters[].gender` | fact `Masc` / `Fem` / `Neut`, or `null` | A character sheet or pronouns in the lore. The key is required: `null` when no source decides it |
| `characters[].number` | fact `Sing` / `Plur` | A group that speaks as one (`Plur`). Leave out for ordinary people |
| `characters[].description` | text | One or two lines from the sheet: role, age, how they talk |
| `characters[].aliases` | list of text | Nicknames, titles and short forms the strings use for them |
| `characters[].glossaryTermId` | term id | The glossary term of the name, once the glossary exists |
| `relations[]` | list | One per direction: A speaking to B and B speaking to A are two relations |
| `relations[].from`, `.to` | character id | `to` may also be `"user"` |
| `relations[].description` | text | How they relate: siblings, boss and employee, strangers |
| `relations[].register` | per language: fact `Infm` / `Form`, or `null` | The formality matrix or the tone guide. `null` means the client must decide |
| `defaults.uiAddressesUser` | true / false | Whether interface text speaks to the user directly (mostly true for apps and game menus) |
| `defaults.narratorGender` | fact `Masc` / `Fem` / `Neut`, or `null` | The narrator or first-person protagonist |
| `defaults.protagonist` | character id | The character the player or reader is |
| `defaults.userRegister` | per language: fact `Infm` / `Form` | How the product addresses its user: the style guide, or the existing translations of the same UI. A form the client must decide is left out and goes in `issues` |
| `style.tone` | per language: text | The full tone-of-voice guide for that language |
| `style.brief` | per language: text | A few lines the translation sends every time: write it from the guide if the client has none, and mark it as yours in `notes` |
| `notes[]` | list of `{kind, text, source?}` | `decision`: settled in History & decisions. `question`: for the client. `note`: anything else worth keeping, including pack fields with no field of their own |
| `issues[]` | list of `{field, lang?, kind, readings[], note?}` | `kind: conflict` when two sources disagree, with every reading and its source. `kind: question` for what only the client can answer |

## String context

One record per string: `get_string_context`, `update_string_contexts`, and each string's `context` in `import_project`.

| Field | Type | Fill it from |
|---|---|---|
| `speaker` | fact: character id, or `null` for narration and UI | A speaker column, a script's character cue, the file's structure |
| `addressee` | fact: character id, `"user"`, or `null` for nobody in particular | An addressee column, the scene. UI text speaking to the user is `"user"` |
| `addresseeNumber` | fact `Sing` / `Plur` | The scene: a line to one person or to a group |
| `register` | per language: fact `Infm` / `Form` | Only where this string differs from its relation or `defaults.userRegister` |
| `referents[]` | `{text, characterId?, gender?, number?}` | A pronoun or noun in the line the target language needs resolved. `text` is the word as written; `gender` and `number` are facts |
| `placeholders[]` | `{name, meaning?, kind?, gender?, number?}` | **Every placeholder in the source.** `name` as written (`{0}`, `%s`, `{player_name}`). `kind`: `count`, `name`, `number`, `date`, `other`. Fill `kind` and `meaning` from a comment column, the key name, or the wording around it |
| `placement.contentType` | text | **Every string.** A type column, the file or sheet name, the key prefix (`menu.`, `dialog.`), or what it evidently is: `Dialogue`, `UI text`, `Item name` |
| `placement.maxLength` | whole number | A max-length column or a spec |
| `placement.screen` | text | The screen or scene from a column, the key prefix, or a screenshot's name |
| `placement.note` | text | Comment columns, and a flow's facts with no field of their own as `<fact>: <value>` |
| `style.tone` | text | Only where a string has its own tone: a shouted line, a legal notice |
| `discourse.section` | text | A chapter, sheet, or section heading in the file |
| `discourse.scene` | text | A scene or quest id, or a context column |
| `discourse.previousKey` | external key | **Every string in a running text**: the string before it in the file, for dialogue, subtitles and lessons |
| `issues[]` | as on the project | Conflicting readings, or a question about this string |
| `evaluation` | written by the platform | Keep it exactly as you read it |

## Prefill checklist

Before importing, each of these is either filled in or knowingly empty because the project has nothing to say about it:

- [ ] `description`, and `style.tone` / `style.brief` for every target language with a guide
- [ ] Every character with `gender`, `description` and `aliases`; `defaults.protagonist` and `defaults.narratorGender` where a story has them
- [ ] `relations` in both directions with `description`, and `register` per language where a matrix or guide says
- [ ] `defaults.uiAddressesUser` and `defaults.userRegister` for products with a UI
- [ ] Every string with `placement.contentType`
- [ ] Every string with placeholders has each of them in `placeholders[]`
- [ ] `speaker` and `addressee` wherever a column or structure says who talks; `null` for UI and narration, stated as a fact
- [ ] `discourse.previousKey` and `section` for running text; `placement.maxLength` and `screen` wherever the file has them
- [ ] Decisions and client questions in `notes`; disagreements in `issues`

Structure in the file itself is a cited source: a value from a column is `confirmed` with source `{"kind": "string", "ref": "<externalKey>:column:<name>"}`. Something you worked out from the wording is a `suggestion`.
