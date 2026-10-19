# Project Types — Flows

The user can declare a project type in their prompt (`Project type: games|edtech|fintech|saas|general`, "Use the `<type>` flow"). The type does not change the four-phase pipeline (**Onboard → Glossary → Translate → QA**) — it tells each phase what to look for first, which context facts to collect, and what to protect. If no type is declared, onboard infers it from the strings, and uses `general` when the sample does not fit one flow.

Onboard (1.0 and 1.2a) records the flow as `project.json`'s `project_type` and seeds `domain` from it (table below). Later phases (and later sessions) read the flow from `project_type`; for a `general` project, a file listed in `file_flows` uses that file's flow. The declared type wins for priorities; if what you find in the files contradicts it (e.g. `saas` declared but the repo is a Unity game), say so in the onboard 1.5 summary and let the user decide.

What each context section holds, the column hints, screenshot linking, the language-forced facts and the fact model (`resolved` / `candidate` / `conflict` / `open`) are in `CONTEXT_REQUIREMENTS.md`. This file says which of that each flow needs.

## Flows at a glance

| Type | Typical content | `domain` |
|---|---|---|
| `games` | UI, quests, dialogue, item names, lore | `game` |
| `edtech` | Lessons, quizzes, course pages | `edtech` |
| `fintech` | Payments, banking, wallets, KYC, statements, fees, insurance | `fintech` |
| `saas` | App UI, emails, help center | `software` |
| `general` | Any other project, or a repo that mixes several | detected in onboard 1.2 |

## Shared rules

These apply to every flow.

- **Never guess a fact.** A fact is `resolved` only from a cited source. A line in parentheses that looks like a thought is a `candidate` speaker, not a resolved one. A formality cell a source leaves empty on purpose is a `conflict`, not a default.
- **Write two files in onboard.** `context_pack.json` holds the project-level objects the flow lists under "Context pack". `context_facts.jsonl` holds one line per string per target language, with only the facts that string needs. The per-batch ambiguity check in translate adds to the same file.
- **Missing context never blocks translation.** Unresolved facts stay `open` and go to `client_questions.md`.
- **Questions are about facts, not documents.** "Who speaks rows 120 to 340, and to whom?" is the right shape; "Please provide a social graph" is not. Rank them by how many strings an answer unblocks, show at most five, and write all of them to `client_questions.md`. Skip a question whose string count is 0.
- **Translation receives only `resolved` facts.** `candidate`, `conflict` and `open` values are never sent as facts. For those strings the prompt asks for wording that does not commit to the unknown fact. Never invent a speaker, a learner's gender, or a customer's gender.
- **Neighbors.** When the flow says neighbors matter, translation gets up to three source lines before the string and three after.
- **Screenshots** are linked in the order in `CONTEXT_REQUIREMENTS.md`: a table column, then a file named by key or row, then a capture spec that is never run unless the user allows it.

## `games`

- **Scan first (onboard 1.1):** UI string tables, quest/dialogue data, item and ability databases, achievements, credits, engine localization files (Unity `.asset`/CSV string tables, Unreal `.po`/`.archive`, Godot `.csv`/`.po`, Ren'Py, Ink/Yarn scripts).
- **Context sections (onboard 1.2b):** glossary, tone of voice, social graph, universe and screenshots are needed; history and other files are used when present. Typical files: game design document, lore bible, character sheets, world/faction notes, style guide, screenshots of menus and HUD.
- **Context pack:**

  | Field | What it holds |
  |---|---|
  | `protagonist` | Name, if a file names one |
  | `characters` | `name`, `g` (`f`, `m`, or null), `desc`, `ev` (file citation) |
  | `formality` | Map of `speaker>addressee` to `T` (informal), `V` (formal), or `null` when the source says the client must decide |
  | `keep` | Names and words that stay as in the source |
  | `universe` | Short setting note |

- **Facts:** dialogue and description lines need the language-forced person facts (speaker gender, addressee gender, addressee number, formality, pronoun referent, placeholder meaning) for the actual target languages. UI, objectives, menu labels, locations and item names need a length limit and a screenshot, and person facts only when the string itself has a speaker, an addressee or a gendered pronoun. Neighbors matter for dialogue.
- **Questions, in the order that usually unblocks the most rows:** (1) a dialogue export with speaker and addressee columns; (2) whether lines in parentheses are always the protagonist's inner thoughts; (3) informal or formal for each pair whose matrix cell is empty; (4) who resolves pronoun referents — the writers, or this team from the screenshots; (5) what each placeholder stands for; (6) if screenshot coverage is 0, whether screenshots or a playable build exist.
- **Glossary emphasis (glossary 2.2):** character, place, faction and item names; abilities and mechanics; quest titles; recurring lore terms. These must render identically across UI, quests and dialogue. A UI term matches the whole string, not a word inside a sentence; a single-word term matches its capitalized or all-caps form, so the verb "thought" is not the mechanic "Thought". Words in `keep` are not translated. Search for the publisher's official localization before coining a rendering.
- **Translation rules (translate 3.1):** preserve speaker voice and lore register; match intensity and address to the resolved formality matrix; if formality or gender is not resolved, avoid a wording that chooses it; keep rich-text and input tags (`<color>`, `{button:A}`, `[img]`) intact; keep short UI close to the source length and respect character limits; VO lines keep timing-compatible length.
- **QA emphasis (qa 4.1):** short UI expanded by more than 30% (or past a stated limit) is a finding; tag and placeholder integrity; numeric preservation in stats and item descriptions; the target equals the source only for `keep` names; name consistency between item lists and dialogue; a resolved formality marker (tu/vous, du/Sie, ты/вы, plain/polite) the target does not use is a finding to review, not an automatic rewrite.
- **Default register:** informal unless the lore says otherwise.

## `edtech`

- **Scan first:** lesson content (Markdown, HTML, JSON/YAML course data), quiz questions with answer options and feedback text, course and catalog pages, then app UI strings.
- **Context sections:** glossary, tone of voice, and screenshots of lesson and quiz screens are needed; curriculum, syllabus, level and pedagogy notes go under files. The social graph is needed only when a lesson is a story with speakers — those lines use the `games` speaker rules, the rest of the file stays on this flow.
- **Context pack:**

  | Field | What it holds |
  |---|---|
  | `audience` | Age, grade, or proficiency level, with a citation |
  | `formality` | One address form for the product speaking to the learner: `T`, `V`, or `null` |
  | `items` | For a quiz, which column is the stem, the options, the correct option, and the feedback |

- **Facts:** `learner_gender` stays `open` unless a file names a specific learner. `formality` is the one product value. `item_role` is stem, option, key, distractor or feedback. `assessment_lock` records the marked correct option, the option count and the option order. `reading_level` is a `candidate` taken from the curriculum file until the user confirms it.
- **Questions:** (1) who the learner is (age, grade or level) and whether the product's address is formal or informal; (2) which column marks the correct option; (3) which strings are formulas, code or units that must stay as in the source; (4) whether buttons and chips have a length limit or a screenshot.
- **Glossary emphasis:** subject terminology (one rendering across every lesson), course and module names, assessment vocabulary (e.g. "quiz", "assignment", "score"). Mark code, formulas, units, option letters and proper names as do-not-translate.
- **Translation rules:** keep the meaning, the reading level and the difficulty; keep instructions unambiguous; do not add a hint the source does not have; never make a distractor obviously wrong or a wrong option newly defensible; feedback must still agree with the marked correct option — re-read each quiz item after writing it; preserve math/LaTeX, code blocks and media references.
- **QA emphasis:** option count and order unchanged, correct-option marker unchanged, feedback names that same option; formulas and code identical to the source; reading level; subject terms match across lessons; UI length holds.
- **Default register:** friendly and clear; formal second person where the target language expects it for learners.

## `fintech`

- **Scan first:** app and web i18n resource files, transactional and statement email templates, fee and pricing tables, KYC and onboarding flows, help-center articles, legal and disclaimer text.
- **Context sections:** glossary, tone of voice and screenshots are needed; compliance notes and approved legal translations go under files. The social graph is not needed — the product speaks to the customer.
- **Context pack:**

  | Field | What it holds |
  |---|---|
  | `audience` | `consumer` or `business`, with a citation |
  | `formality` | One address form for the whole product: `T`, `V`, or `null` |
  | `locked_statuses` | Money-state words the client has fixed, such as pending, cleared, available, held |
  | `legally_locked` | String ids for disclaimers, consent lines and risk warnings |

  A business audience takes formal address unless a file says otherwise. That one value applies to every screen — it is not a matrix.
- **Facts:** `user_gender` stays `open`. `money_state` must use the locked term. A disclaimer, consent line or risk warning is `legally_locked`: `resolved` when a file or column says so, otherwise `candidate` until the user confirms. An ambiguous label ("Free", "Transfer", "Available") is resolved from a screenshot or the neighbor controls, or it stays `open`. Neighbors matter for short labels.
- **Questions:** (1) consumers or businesses, and formal or informal address on every screen; (2) which status words are locked; (3) which strings legal has already approved and must not be softened; (4) what an ambiguous label means, given the controls next to it.
- **Glossary emphasis:** one term per money state, fee and account type, used the same way in the app, emails, statements and help text. Search the client's existing legal translations, then the regulator's published glossary, before coining a word. "Pending" and "cleared" are different states; a smoother near-synonym of a locked status is the wrong translation.
- **Translation rules:** amounts keep their digits — do not reformat a number that is already formatted unless a column says the string is display copy; leave IBANs, masked card numbers, currency codes, legal-entity names and license numbers unchanged; use the locked status term; do not soften a legally locked string — if the target language cannot carry its force, add it to the question list instead of stretching the sentence; use the one resolved address form, and if it is open, avoid a wording that chooses it.
- **QA emphasis:** digits and currency codes match the source; each locked status uses the glossary term; a disclaimer that reads weaker than the source is a finding for the user, not an automatic rewrite; the same term appears in the app and the help text; placeholders match; no gender is invented.
- **Default register:** formal for business audiences; otherwise neutral-professional, following the brand voice guide when found.

The agent never certifies that a translation meets a regulation, and never marks a string legally approved.

## `saas`

- **Scan first:** i18n resource files (JSON, YAML, `.po`, `.strings`, `.xliff`, `.arb`, ICU message files), transactional email templates, help-center / docs Markdown, marketing pages if they live in the repo.
- **Context sections:** glossary, tone of voice and screenshots are needed; brand voice guide, product docs, help-center articles, changelog and design specs go under files. The social graph is not needed.
- **Context pack:**

  | Field | What it holds |
  |---|---|
  | `formality` | One address form for the product: `T`, `V`, or `null` |
  | `feature_names` | Names that stay in the source language, or their locked translation |
  | `limits` | Character limits from a spec, keyed by component |

- **Facts:** `user_gender` stays `open`. `max_length` comes from the spec or from a screenshot of the component. An ambiguous label is resolved from neighbor strings on the same screen: "Free" next to "Full" and "3 spots left" means open places, not zero price. Neighbors matter for short labels.
- **Questions:** (1) formal or informal address for the whole product; (2) which feature and plan names stay in the source language; (3) the length limits, or where the screenshots of tight components are; (4) what an ambiguous label means, given its neighbor controls.
- **Glossary emphasis:** feature and plan names, UI actions ("Save", "Publish", "Workspace"), domain objects, brand names and do-not-translate terms. UI actions referenced in help articles must match the UI strings exactly.
- **Translation rules:** keep ICU plurals/selects, `{placeholders}`, `%s`/`%d`, HTML and Markdown links intact; buttons stay short; email subject lines stay under typical inbox length; use the one resolved address form consistently across UI and emails.
- **QA emphasis:** placeholder and ICU syntax validity, button/label length, link and markup integrity, help-center references to UI labels match the translated UI, a label whose meaning was resolved from its neighbors uses that meaning.
- **Default register:** neutral-professional; follow the brand voice guide when found.

## `general`

Discover everything in onboard 1.1 and derive `domain` from the content in 1.2. Then classify each translation file as `games`, `edtech`, `fintech`, `saas` or `plain`, and record the map in `project.json`'s `file_flows`. Each file follows its flow from that point on: its facts, glossary emphasis, translation rules and QA checks. A `plain` file needs only placeholder meaning, an address form when the string speaks to the reader, and a screenshot when the string is UI; it never gets a character matrix. Ask the single question that unblocks the most strings across files first. Apply the content-type priorities in the workflow file.

## What the agent builds from the repo

These are the localization context sources the agent assembles during onboard, glossary and translate. Be accurate with the user about what each one is:

| Source | What it is today |
|---|---|
| **Glossary** | Imported from the client's glossary files (with the user's confirmation) and extracted from code and UI strings (glossary 2.2), researched, confirmed by the user, and stored on the Algebras platform. |
| **Translation memory** | Translations that already exist in the repo. Onboard 1.2c counts them; translate keeps them as-is (never re-sent for translation) and uses them as the reference for terminology and style. There is no separate platform translation-memory store yet. |
| **Context files** | Specs, docs, lore, style guides and other client material found in the repo, classified into the sections of `CONTEXT_REQUIREMENTS.md`, listed in `project.json`'s `context_files`, and read before glossary extraction and each translation batch. |
| **Context facts** | `context_pack.json` (project-level objects) and `context_facts.jsonl` (per-string facts with their status and source), plus `client_questions.md` for whatever is still open. |
| **Screenshots** | Screenshots already in the repo are linked to strings by column or file name and used as context. The agent can write a capture runner spec when the client has a playable build, but it never runs one without explicit permission — don't promise automatic capture. |

## Delivery

When the project is a git repository, the agent works on its own branch (`algebras/localize-<YYYYMMDD>`, created in translate 3.0) and commits the result at the end of QA (qa 4.6) so the user can review it like any other change. It never pushes or opens a pull request unless the user asks.
