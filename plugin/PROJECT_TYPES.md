# Project Types — Flows

The user can declare a project type in their prompt (`Project type: games|edtech|saas|general`, "Use the `<type>` flow"). The type does not change the four-phase pipeline (**Onboard → Glossary → Translate → QA**) — it tells each phase what to look for first and what to protect. If no type is declared, use `general`.

The declared type seeds `project.json`'s `domain` in onboard (1.0), and later phases (and later sessions) read the flow back from `domain` using the table below — `domain` values without a dedicated flow (`legal`, `marketing`, `subtitles`, `document`, `other`) use `general`. The declared type wins for priorities; if what you find in the files contradicts it (e.g. `saas` declared but the repo is a Unity game), say so in the onboard 1.5 summary and let the user decide.

## Flows at a glance

| Type | Typical content | `domain` |
|---|---|---|
| `games` | UI, quests, item names, lore | `game` |
| `edtech` | Lessons, quizzes, course pages | `edtech` |
| `saas` | App UI, emails, help center | `software` |
| `general` | Any other project | detected in onboard 1.2 |

## `games`

- **Scan first (onboard 1.1):** UI string tables, quest/dialogue data, item and ability databases, achievements, credits, engine localization files (Unity `.asset`/CSV string tables, Unreal `.po`/`.archive`, Godot `.csv`/`.po`, Ren'Py, Ink/Yarn scripts).
- **Context files (onboard 1.2b):** game design document, lore bible, character sheets, world/faction notes, style guide, existing screenshots of menus and HUD.
- **Glossary emphasis (glossary 2.2):** character, place, faction and item names; abilities and mechanics; quest titles; recurring lore terms. These must render identically across UI, quests and dialogue.
- **Translation rules (translate 3.1):** preserve speaker voice and lore register; keep rich-text and input tags (`<color>`, `{button:A}`, `[img]`) intact; respect character limits on UI labels; VO lines keep timing-compatible length.
- **QA emphasis (qa 4.1):** length expansion on UI labels, tag and placeholder integrity, numeric preservation in stats and item descriptions, name consistency between item lists and dialogue.
- **Default register:** informal unless the lore says otherwise.

## `edtech`

- **Scan first:** lesson content (Markdown, HTML, JSON/YAML course data), quiz questions with answer options and feedback text, course and catalog pages, then app UI strings.
- **Context files:** curriculum or syllabus, target age / grade / proficiency level, pedagogy or tone guide, existing screenshots of lesson and quiz screens.
- **Glossary emphasis:** subject terminology (keep one rendering across every lesson), course and module names, assessment vocabulary (e.g. "quiz", "assignment", "score"). Mark code, formulas, units and proper names as do-not-translate.
- **Translation rules:** keep instructions unambiguous and at the stated reading level; never change the meaning of a question or make a distractor more or less obviously wrong; preserve math/LaTeX, code blocks and media references.
- **QA emphasis:** answer keys stay aligned with their options (same count, same order, correct option still correct), question and feedback text agree, reading level, consistent terminology across lessons.
- **Default register:** friendly and clear; formal second person where the target language expects it for learners.

## `saas`

- **Scan first:** i18n resource files (JSON, YAML, `.po`, `.strings`, `.xliff`, `.arb`, ICU message files), transactional email templates, help-center / docs Markdown, marketing pages if they live in the repo.
- **Context files:** brand voice or style guide, product docs, existing help-center articles, changelog/release notes, design specs, existing screenshots of app screens.
- **Glossary emphasis:** feature and plan names, UI actions ("Save", "Publish", "Workspace"), domain objects, brand names and do-not-translate terms. UI actions referenced in help articles must match the UI strings exactly.
- **Translation rules:** keep ICU plurals/selects, `{placeholders}`, `%s`/`%d`, HTML and Markdown links intact; buttons stay short; email subject lines stay under typical inbox length; keep the product's address form (formal/informal) consistent across UI and emails.
- **QA emphasis:** placeholder and ICU syntax validity, button/label length, link and markup integrity, help-center references to UI labels match the translated UI.
- **Default register:** neutral-professional; follow the brand voice guide when found.

## `general`

Current behavior: discover everything in onboard 1.1, derive `domain` from the content in 1.2, and use the README, docs and specs you find as context files. Apply the content-type priorities in the workflow file.

## What the agent builds from the repo

These are the localization context sources the agent assembles during onboard and glossary. Be accurate with the user about what each one is:

| Source | What it is today |
|---|---|
| **Glossary** | Extracted from code and UI strings (glossary 2.2), researched, confirmed by the user, and stored on the Algebras platform. |
| **Translation memory** | Translations that already exist in the repo. Onboard 1.2c counts them; translate keeps them as-is (never re-sent for translation) and uses them as the reference for terminology and style. There is no separate platform translation-memory store yet. |
| **Context files** | Specs, docs, lore and style guides found in the repo, listed in `project.json`'s `context_files` and read before glossary extraction and each translation batch. |
| **Screenshots** | Screenshots already in the repo are used as context files. Automatic screenshot capture is not available yet — don't promise it. |

## Delivery

When the project is a git repository, the agent works on its own branch (`algebras/localize-<YYYYMMDD>`, created in translate 3.0) and commits the result at the end of QA (qa 4.6) so the user can review it like any other change. It never pushes or opens a pull request unless the user asks.
