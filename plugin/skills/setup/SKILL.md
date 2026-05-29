---
name: setup
description: Set up the Algebras translation agent — copies workflow files, registers MCP, saves API key
allowed-tools: [Bash, Read, Write, Edit]
---

You are setting up the Algebras translation agent for the user's project. Follow these steps exactly.

## Step 0 — Identify the project root

The user invoked this skill from inside their translation project. Use the current working directory as `PROJECT_ROOT`. If the directory looks like an Algebras plugin cache or a `.algebras` clone rather than an actual project, ask the user to confirm the correct project root before proceeding.

## Step 1 — Copy workflow files (no-clobber)

Copy the workflow instruction files from the plugin cache into the project root.

Resolve `PLUGIN_ROOT` this way:
- In Claude Code, use `${CLAUDE_PLUGIN_ROOT}` when it is set.
- In Codex, use the installed plugin root that contains this `skills/setup/SKILL.md` file.
- If neither can be resolved, search upward from this skill file until you find `CLAUDE.md`, `AGENTS.md`, and `COMMON_MISTAKES.md` together.

Then copy from `PLUGIN_ROOT`:

```bash
for f in CLAUDE.md AGENTS.md .cursorrules .windsurfrules COMMON_MISTAKES.md; do
  cp -n "${PLUGIN_ROOT}/$f" "$PROJECT_ROOT/$f" 2>/dev/null || true
done
```

Report which files were copied and which were skipped (already existed).

## Step 2 — Open browser and collect API key

Open the Algebras API keys page in the default browser:

```bash
# macOS
open "https://platform.algebras.ai/api-keys"
# Linux
xdg-open "https://platform.algebras.ai/api-keys"
# Windows
start "" "https://platform.algebras.ai/api-keys"
```

If the browser can't be opened, print: "Open this URL to get your API key: https://platform.algebras.ai/api-keys"

Then tell the user: "Your browser should now be open at platform.algebras.ai/api-keys — paste your API key here."

Wait for the user to paste the key. Validate: the value must be non-empty and must not contain spaces. If invalid, ask again. Never print the full key back into the conversation.

## Step 3 — Save API key to .env

Read `PROJECT_ROOT/.env` if it exists. Apply upsert logic:
- If a line starting with `ALGEBRAS_API_KEY=` exists, replace it
- Otherwise append `ALGEBRAS_API_KEY=<key>` on a new line
- Preserve any existing `ALGEBRAS_PLATFORM_URL=` line unchanged

Write the result using the Write tool (not shell echo) so the key value doesn't appear in Bash output.

## Step 4 — Register MCP server

If running in Claude Code, run the following command to register the algebras MCP server for this project:

```bash
claude mcp add --transport http algebras https://platform.algebras.ai/api/mcp --header "x-api-key: <KEY>"
```

If the command output says the server already exists, run it with `--force` to overwrite:

```bash
claude mcp add --transport http --force algebras https://platform.algebras.ai/api/mcp --header "x-api-key: <KEY>"
```

This writes to `~/.claude.json` scoped to the current project — the correct location Claude Code reads MCP servers from.

If running in Codex, update `~/.codex/config.toml` instead. Add or replace only this block, preserving all other Codex config:

```toml
[mcp_servers.algebras]
url = "https://platform.algebras.ai/api/mcp"
enabled = true
http_headers = { "x-api-key" = "<KEY>" }
```

Use the Write or Edit tool so the key does not appear in shell output. This is the correct location Codex CLI and the Codex IDE extension read MCP servers from.

## Step 5 — Update project.json (non-fatal)

If `PROJECT_ROOT/project.json` exists, read it, set `"mcp_url": "https://platform.algebras.ai/api/mcp"`, and write it back. Skip silently if the file doesn't exist.

## Step 6 — Final confirmation

Print:

```
Setup complete.

  Workflow files  →  copied to <PROJECT_ROOT>
  API key         →  saved to <PROJECT_ROOT>/.env
  MCP server      →  registered in <Claude or Codex MCP config>

Restart your agent to connect the algebras MCP tools (check_fluency, check_fluency_batch).
In Codex, use /mcp after restart to confirm the algebras server is active.
Then say: "Translate this project."
```
