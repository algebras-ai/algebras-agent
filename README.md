# Algebras Translation Agent

AI-powered translation workflow with automated QA and real-time fluency scoring via [Algebras](https://platform.algebras.ai).

Works with Claude Code, Cursor, Codex, Windsurf, GitHub Copilot, or any agent that supports MCP tools.

---

## Install

### Claude Code

Run these two commands inside Claude Code (no cloning required):

```
/plugin marketplace add algebras-ai/algebras-agent
/plugin install algebras-agent@algebras-agent
```

Then run the setup skill. It opens your browser for the API key, copies the workflow files into your project, and registers the MCP server automatically:

```
/algebras-agent:setup
```

Reload plugins when prompted:

```
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

## Requirements

- Python 3.10+ (for QA tools)
- An [Algebras](https://platform.algebras.ai) account
