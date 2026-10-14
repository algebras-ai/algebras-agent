# Algebras Translation Agent

AI-powered translation workflow with automated QA and real-time fluency scoring via [Algebras](https://platform.algebras.ai).

Works with Claude Code, Cursor, Codex, Windsurf, GitHub Copilot, or any agent that supports MCP tools.

> **AI agents:** asked to localize a project with Algebras? Read **[AGENTS.md](AGENTS.md)** and follow it step by step. In short:
> 1. Read the API key from `ALGEBRAS_API_KEY` (environment or `.env`).
> 2. Connect the MCP server `https://platform.algebras.ai/api/mcp` with header `x-api-key: <key>`.
> 3. Use the `Project type:` flow from [`plugin/PROJECT_TYPES.md`](plugin/PROJECT_TYPES.md) (`games`, `edtech`, `saas`, or `general`).
> 4. Run the workflow in [`plugin/CLAUDE.md`](plugin/CLAUDE.md): onboard → glossary → translate → qa.

---

## Quick start

1. Open **[platform.algebras.ai/translation/agent](https://platform.algebras.ai/translation/agent)**, create an API key, and save it as `ALGEBRAS_API_KEY` in your project's environment or `.env`.
2. Open your repo in Claude Code, Codex, Cursor, Windsurf, Copilot, or any coding agent, and paste the prompt from that page:

   ```
   Localize this project with Algebras.
   Follow the instructions in https://github.com/algebras-ai/algebras-agent
   Use the API key from ALGEBRAS_API_KEY.
   Project type: <games|edtech|saas|general>
   Use the <type> flow from the agent instructions.
   ```

3. The agent connects to Algebras, builds your localization context, translates, runs QA, and leaves the result on a new git branch (`algebras/localize-<date>`) for you to review like any other change.

To install the agent permanently in your tool instead (plugin or MCP config), see [Install](#install).

### Project types

| Type | Use it for | The flow emphasizes |
|---|---|---|
| `games` | Games | UI, quests, item names, lore |
| `edtech` | Education products | Lessons, quizzes, course pages |
| `saas` | Software products | App UI, emails, help center |
| `general` | Any other project | Detected from your files |

Each flow is defined in [`plugin/PROJECT_TYPES.md`](plugin/PROJECT_TYPES.md).

### What the agent builds from your repo

| | |
|---|---|
| **Glossary** | Extracted from your code and UI strings, checked against established translations, and confirmed by you. Stored on the Algebras platform. |
| **Translation memory** | Translations already in your repo are kept and reused as the reference for terminology and style. They aren't translated again. |
| **Context files** | Specs, docs, lore and style guides found in your repo are read before glossary extraction and each translation batch. |
| **Screenshots** | Screenshots already in your repo are used as context. Automatic capture is coming soon. |

---

## Install

### Claude Code

> **Note:** Plugin commands require the Claude Code CLI (`claude` in your terminal). They are not available in the Claude Code web app or desktop app.

Run these commands in the Claude Code CLI from your project directory:

```bash
claude plugin marketplace add algebras-ai/algebras-agent
claude plugin install algebras-agent@algebras-agent
```

Then start an interactive session and run the setup skill — it opens your browser for the API key, copies workflow files into your project, and saves the key to `.env`:

```
claude
```

```
/algebras-agent:setup
```

The MCP server connects automatically once the plugin has your API key (declared in `plugin.json`). If you need to reconfigure the key later:

```
/plugin configure algebras-agent
/reload-plugins
```

### Codex

Add the Algebras plugin marketplace, then install the plugin from Codex:

```bash
codex plugin marketplace add algebras-ai/algebras-agent
codex
```

Inside Codex, open the plugin browser:

```
/plugins
```

Install `algebras-agent`, then run the setup skill:

```
$setup
```

Restart Codex when prompted. You can verify the Algebras MCP server from:

```
/mcp
```

The plugin does not start the MCP server until setup saves your Algebras API key. If `/mcp` shows an unauthenticated `algebras` startup error from an earlier install, remove the old plugin install or delete the stale `algebras` MCP entry, run `$setup`, and restart Codex.

### Cursor / Windsurf / Codex fallback

Run from your project root:

```bash
curl -fsSL https://platform.algebras.ai/install | bash
```

The script opens your browser for the API key, downloads the workflow files, and writes the MCP config automatically (`.cursor/mcp.json`, `.windsurf/mcp.json`, or `~/.codex/config.toml`).

If your agent isn't auto-detected, pass `--agent` explicitly:

```bash
curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent cursor
curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent windsurf
curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent codex
```

---

## Translate

Once installed, open your project in your agent and send:

```
Translate this project.
```

Add a project type to pick a flow, e.g. `Translate this project. Project type: saas`. Or paste the full prompt from the [Quick start](#quick-start) — it works with or without the install step.

The agent onboards your project, builds a glossary, translates, and runs QA, asking you to confirm at each step. In a git repository it works on its own branch and commits the result at the end.

---

## What's included

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Workflow for Claude Code and Claude Desktop |
| `AGENTS.md` | Workflow for OpenAI Codex / Agents |
| `.cursorrules` | Workflow for Cursor |
| `.windsurfrules` | Workflow for Windsurf |
| `.github/copilot-instructions.md` | Workflow for GitHub Copilot |
| `PROJECT_TYPES.md` | The `games`, `edtech`, `saas` and `general` flows |
| `COMMON_MISTAKES.md` | Error taxonomy from real-world LQA |
| `skills/<phase>/SKILL.md` | The phases: `onboard`, `glossary`, `translate`, `qa`, plus optional `glossary-dedupe` |

[`AGENTS.md`](AGENTS.md) at the repository root is the entry point for agents that follow this repo's URL without installing anything.

## GitHub Actions (CI/CD)

Automate translation in any repo's CI pipeline — no manual setup required.

### Quick start

1. Add these secrets in your repo: **Settings → Secrets and variables → Actions**

   | Secret | Value |
   |--------|-------|
   | `ALGEBRAS_API_KEY` | From [platform.algebras.ai/api-keys](https://platform.algebras.ai/api-keys) |
   | `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) |

2. Copy `.github/workflows/translate.example.yml` from this repo into your project's `.github/workflows/` and adjust the `paths` trigger to match your locale files.

3. Push to `main` (or trigger via **Actions → Translate → Run workflow**).

### What the action does

On each run the action:
1. Downloads the latest workflow prompt files from this repo
2. Checks `project.json` — exits early if all strings are already translated (`skip-if-complete: true`)
3. Writes a temporary MCP config pointing to the Algebras platform
4. Installs the Claude CLI and runs it non-interactively against your project
5. The agent runs the full workflow: **Onboard → Glossary → Translate → QA** (skips phases that are already done)
6. Detects changed files via `git diff`; commits and pushes (or opens a PR)

### Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `algebras-api-key` | — | **Required.** Algebras API key |
| `llm-provider` | `anthropic` | `anthropic` or `gemini` |
| `anthropic-api-key` | — | Required if provider is `anthropic` |
| `gemini-api-key` | — | Required if provider is `gemini` |
| `algebras-platform-url` | `https://platform.algebras.ai` | Override for self-hosted |
| `commit-changes` | `true` | Commit translated files |
| `create-pr` | `false` | Open a PR instead of pushing directly |
| `skip-if-complete` | `true` | Exit early if nothing needs translating |
| `project-type` | `general` | Flow from `PROJECT_TYPES.md`: `games`, `edtech`, `saas`, or `general` |
| `min-fluency-score` | _(empty)_ | Fail if any string scores below this (1–10) |

### Example

```yaml
- uses: algebras-ai/algebras-agent/.github/actions/algebras-translate@main
  with:
    algebras-api-key: ${{ secrets.ALGEBRAS_API_KEY }}
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    commit-changes: "true"
    create-pr: "false"
```

---

## Requirements

- Python 3.10+ (for QA tools)
- An [Algebras](https://platform.algebras.ai) account
