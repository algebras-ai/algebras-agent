# Algebras Localization Agent

AI-powered localization workflow with automated QA and real-time fluency scoring via [Algebras](https://platform.algebras.ai).

Works with Claude Code, Cursor, Codex, Windsurf, GitHub Copilot, or any agent that supports MCP tools.

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

Open your project in your agent and send:

```
Translate this project.
```

The agent onboards your project, builds a glossary, translates, and runs QA automatically.

---

## What's included

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Workflow for Claude Code and Claude Desktop |
| `AGENTS.md` | Workflow for OpenAI Codex / Agents |
| `.cursorrules` | Workflow for Cursor |
| `.windsurfrules` | Workflow for Windsurf |
| `.github/copilot-instructions.md` | Workflow for GitHub Copilot |
| `COMMON_MISTAKES.md` | Error taxonomy from real-world LQA |
| `CONTEXT_REQUIREMENTS.md` | Client context the agent expects, and which facts each target language forces |

## Prepare your project folder

Put any brief, style guide, character list, glossary, or screenshots in the project folder next to the translation files. Any file name is fine — the agent classifies files by their contents. What to include, and which facts each target language forces, is specified in [CONTEXT_REQUIREMENTS.md](plugin/CONTEXT_REQUIREMENTS.md). Missing context does not block translation. The agent asks a few questions and records the rest for the client.

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
