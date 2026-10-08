# Context requirements

What the translation agent expects from the client, and how that material is used. The eight sections below are the Context entity of the Algebras Agentic Workspace. A client folder laid out this way can be imported there later without conversion.

A fact is resolved only from a cited source: one of these files, a column in the source table, or an explicit answer from the user. The agent does not guess. If a file is missing, translation still runs; the unknown fact stays open and is written into `client_questions.md` for the project manager to forward.

## The eight sections

| Section | What it holds | How the agent uses it | Needed for |
|---|---|---|---|
| Glossary | Terms with type, definition, translation, and grammatical gender per language | Imported into the platform glossary in the glossary phase; enforced in QA | All projects |
| History & decisions | Past decisions, notes, open questions | Prevents re-asking settled questions; open questions feed the client list | Optional |
| Universe | Setting, era, lore, product description | Sent as context with translation requests | Games, marketing |
| Tone of voice | Style guide per language, short brief, formality matrix by speaker and listener | Steers register; the matrix resolves tu/vous and speech levels | Games, marketing, UI |
| Social graph | Characters with gender and description; relationships with type and tone | Resolves speaker gender and formality per line | Games, dialogue, subtitles |
| UX screenshots | Images linked to string keys or row numbers | Resolves UI meaning, length limits, and ambiguous labels | UI, games |
| Integrations | memoQ, Gridly, Google Sheets, GitHub settings | Recorded only; no live connection from the agent | Optional |
| Files | Any other reference documents | Read as reference when relevant | Optional |

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
