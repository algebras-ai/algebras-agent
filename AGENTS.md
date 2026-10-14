# Algebras Agent — Instructions for AI coding agents

> This file is for an AI agent that has been asked to **localize another project** with Algebras, e.g. with a prompt like the one below. If you are working on *this* repository's own code, see [README.md](README.md) instead.

```
Localize this project with Algebras.
Follow the instructions in https://github.com/algebras-ai/algebras-agent
Use the API key from ALGEBRAS_API_KEY.
Project type: <games|edtech|saas|general>
Use the <type> flow from the agent instructions.
```

You are working in the **user's project** (the current working directory), not in this repository. Follow the steps below in order.

Raw files from this repository are served from:

```
https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/
```

Workflow files are under `plugin/` at that address. `<RAW>` in this file stands for `https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin`.

---

## Step 1 — Get the API key

Look for `ALGEBRAS_API_KEY`, in this order:

1. The shell environment (`ALGEBRAS_API_KEY`).
2. A `ALGEBRAS_API_KEY=` line in the project's `.env`.

**Never print the key** — not in chat, not in shell output. Check that it exists without echoing it (e.g. `[ -n "$ALGEBRAS_API_KEY" ]`, or `grep -q '^ALGEBRAS_API_KEY=.' .env`), and write it into config files with your file-editing tool rather than `echo`.

If there is no key, stop and tell the user:

> Create an API key at https://platform.algebras.ai/translation/agent, then add it to this project's `.env` as `ALGEBRAS_API_KEY=<your key>` (and make sure `.env` is in `.gitignore`), or `export ALGEBRAS_API_KEY=<your key>` in your shell. Then paste the prompt again.

Optional check that the key works: `GET https://platform.algebras.ai/api/v1/me` with header `x-api-key: <key>` should return `200`.

## Step 2 — Connect the Algebras MCP server

The whole workflow runs through the `algebras` MCP server's tools (`translate_batch`, `check_fluency_batch`, `create_glossary`, `list_glossary_terms`, `count_glossary_terms`, ...). **Never generate translations yourself instead of calling them.**

If the `algebras` tools are already available in this session (e.g. you can call `list_glossaries`), skip to Step 3.

Otherwise, register the server:

- **URL:** `https://platform.algebras.ai/api/mcp` (HTTP transport)
- **Header:** `x-api-key: <ALGEBRAS_API_KEY>`

Pick what matches the agent you're running in:

| Agent | How |
|---|---|
| **Claude Code** | Plugin: `claude plugin marketplace add algebras-ai/algebras-agent`, `claude plugin install algebras-agent@algebras-agent`, then `/algebras-agent:setup`. Or without the plugin: `claude mcp add --transport http algebras https://platform.algebras.ai/api/mcp --header "x-api-key: <KEY>"` |
| **Codex** | Plugin: `codex plugin marketplace add algebras-ai/algebras-agent`, install from `/plugins`, run `$setup`. Or add the TOML block below to `~/.codex/config.toml`. |
| **Cursor / Windsurf / Codex** | Run the installer below from the project root. |
| **VS Code / GitHub Copilot** | Add the `.vscode/mcp.json` block below. |
| **Any other MCP client** | Use the JSON block below (same shape as [`mcp-config.example.json`](mcp-config.example.json)). |

Installer (Cursor / Windsurf / Codex), run from the project root. It reuses `ALGEBRAS_API_KEY` from the environment or `.env`, writes the MCP config, and downloads the workflow files (without overwriting existing ones):

```bash
curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent cursor   # or: windsurf, codex
```

Generic MCP JSON (Cursor `.cursor/mcp.json`, Windsurf, most clients):

```json
{
  "mcpServers": {
    "algebras": {
      "type": "http",
      "url": "https://platform.algebras.ai/api/mcp",
      "headers": { "x-api-key": "<KEY>" }
    }
  }
}
```

Codex `~/.codex/config.toml`:

```toml
[mcp_servers.algebras]
url = "https://platform.algebras.ai/api/mcp"
enabled = true
http_headers = { "x-api-key" = "<KEY>" }
```

VS Code `.vscode/mcp.json` (prompts for the key, so it never lands in the file):

```json
{
  "inputs": [
    { "type": "promptString", "id": "algebras-api-key", "description": "Algebras API key", "password": true }
  ],
  "servers": {
    "algebras": {
      "type": "http",
      "url": "https://platform.algebras.ai/api/mcp",
      "headers": { "x-api-key": "${input:algebras-api-key}" }
    }
  }
}
```

If a config file inside the project now contains the key, make sure it's listed in `.gitignore` (ask the user before editing `.gitignore`).

Most agents only load MCP servers at startup. If the `algebras` tools still aren't available after registering, tell the user exactly what to do — e.g. "Restart Cursor (or reload MCP servers), then paste the same prompt again" — and stop. Don't continue the workflow without the MCP tools.

## Step 3 — Load the workflow

The workflow is the file `<RAW>/CLAUDE.md` plus the files it points to. Read them directly from the raw URLs — you don't need to copy them into the user's project. If the project already has them (e.g. after the installer or the plugin's setup ran), use the local copies.

| File | What it is |
|---|---|
| `<RAW>/CLAUDE.md` | The workflow overview and standing rules. Follow it for the whole run. |
| `<RAW>/PROJECT_TYPES.md` | The `games`, `edtech`, `saas` and `general` flows. |
| `<RAW>/skills/onboard/SKILL.md` | Phase 1: discover files, context and existing translations, write `project.json`. |
| `<RAW>/skills/glossary/SKILL.md` | Phase 2: build the glossary on the Algebras platform. |
| `<RAW>/skills/translate/SKILL.md` | Phase 3: translate in batches through the MCP tools. |
| `<RAW>/skills/qa/SKILL.md` | Phase 4: QA, fluency report, deliver on the branch. |
| `<RAW>/skills/glossary-dedupe/SKILL.md` | Optional glossary cleanup. |
| `<RAW>/COMMON_MISTAKES.md` | Error taxonomy from real-world LQA. |

When a workflow file mentions a local path like `skills/glossary/SKILL.md` or `PROJECT_TYPES.md` that doesn't exist in the project, read `<RAW>/<that path>` instead.

If you're running with the `algebras-agent` plugin installed (Claude Code, Codex), invoke the skills instead (`algebras-agent:onboard`, ...).

## Step 4 — Pick the flow

Read the `Project type:` line from the prompt and use that flow from `PROJECT_TYPES.md`:

| Type | Use it for | Emphasis |
|---|---|---|
| `games` | Games | UI, quests, item names, lore |
| `edtech` | Education products | Lessons, quizzes, course pages |
| `saas` | Software products | App UI, emails, help center |
| `general` | Anything else | Detected from the project |

If no type is given, use `general`. The type is recorded in `project.json` during onboarding — don't ask the user to choose it again.

## Step 5 — Run the workflow

Run the four phases in order, each in full: **Onboard → Glossary → Translate → QA**. Each phase has user-confirmation gates (project summary, glossary approval, branch and commit) — stop and wait for the user at each one; don't skip them to finish faster.

## Step 6 — Deliver

In a git repository, the translated files land on their own branch — `algebras/localize-<YYYYMMDD>`, created at the start of the Translate phase — and are committed at the end of QA, so the user can review them like any other change. Don't push or open a pull request unless the user asks. End by telling the user the branch name and how to review it.

---

## What the agent builds from the repo

Describe these to the user accurately:

- **Glossary** — extracted from code and UI strings, checked against established translations, confirmed by the user, and stored on the Algebras platform.
- **Translation memory** — translations already in the repo are kept and reused as the reference for terminology and style. They're never sent for translation again.
- **Context files** — specs, docs, lore and style guides found in the repo, read before glossary extraction and each translation batch.
- **Screenshots** — screenshots already in the repo are used as context. Automatic screenshot capture isn't available yet.
