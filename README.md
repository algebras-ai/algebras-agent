# Algebras Translation Agent

AI-powered translation workflow with automated QA and real-time fluency scoring via [Algebras](https://platform.algebras.ai).

Works with Claude Code, Cursor, Codex, Windsurf, GitHub Copilot, or any agent that supports MCP tools.

---

## Quickstart (3 steps)

### Step 1 — Install

Paste this into your AI agent and send:

```
Clone https://github.com/algebras-ai/algebras-agent into a folder called .algebras in my project root,
then copy CLAUDE.md, AGENTS.md, .cursorrules, .windsurfrules, and COMMON_MISTAKES.md into my project root.
```

The agent will clone the repo and drop the workflow files into your project.

### Step 2 — Connect to Algebras

> **Requires Node.js 18+** — install from [nodejs.org](https://nodejs.org) if you don't have it.

Run from inside the cloned `.algebras` folder:

```bash
node .algebras/setup.js
```

This opens a browser, logs you in, and prints an MCP config snippet. Add that snippet to your agent's MCP config file:

| Agent | Config file |
|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` (or project `.claude/settings.json`) |
| Cursor | `.cursor/mcp.json` in your project root |
| Windsurf | `.windsurf/mcp.json` in your project root |
| Codex | `~/.codex/config.json` |
| Other | Check your agent's MCP documentation |

### Step 3 — Translate

Open your project in your agent and send:

```
Translate this project.
```

The agent will onboard your project, build a glossary, translate, and run QA automatically.

---

## What's included

| File | Purpose |
|---|---|
| `CLAUDE.md` | Workflow for Claude Code and Claude Desktop |
| `AGENTS.md` | Workflow for OpenAI Codex / Agents |
| `.cursorrules` | Workflow for Cursor |
| `.windsurfrules` | Workflow for Windsurf |
| `.github/copilot-instructions.md` | Workflow for GitHub Copilot |
| `COMMON_MISTAKES.md` | Error taxonomy from real-world LQA |

## Requirements

- Node.js 18+ (for `setup.js`)
- Python 3.10+ (for QA tools)
- An [Algebras](https://platform.algebras.ai) account
