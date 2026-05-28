---
description: Set up the Algebras translation agent — copies workflow files, registers MCP, saves API key
allowed-tools: [Bash, Read, Write, Edit]
---

You are setting up the Algebras translation agent for the user's project. Follow these steps exactly.

## Step 0 — Identify the project root

The user invoked this skill from inside their translation project. Use the current working directory as `PROJECT_ROOT`. If the directory looks like an Algebras plugin cache or a `.algebras` clone rather than an actual project, ask the user to confirm the correct project root before proceeding.

## Step 1 — Copy workflow files (no-clobber)

Copy the workflow instruction files from the plugin cache into the project root. Use `${CLAUDE_PLUGIN_ROOT}` to reference the plugin directory:

```bash
for f in CLAUDE.md AGENTS.md .cursorrules .windsurfrules COMMON_MISTAKES.md; do
  cp -n "${CLAUDE_PLUGIN_ROOT}/$f" "$PROJECT_ROOT/$f" 2>/dev/null || true
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

## Step 4 — Register MCP server in ~/.claude/settings.json

Read `~/.claude/settings.json`. If the file doesn't exist, start with `{}`. If the file exists but is malformed JSON, stop and tell the user: "Your ~/.claude/settings.json has a JSON syntax error. Please fix it and run /algebras-agent:setup again."

If `mcpServers.algebras` already exists in the file, ask: "The algebras MCP server is already registered. Update the API key?" Proceed only if the user confirms.

Merge the following into the parsed JSON, preserving all other keys:

```json
{
  "mcpServers": {
    "algebras": {
      "type": "http",
      "url": "https://platform.algebras.ai/api/mcp",
      "headers": {
        "x-api-key": "<KEY>"
      }
    }
  }
}
```

Write the updated file with 2-space indentation using the Write tool.

## Step 5 — Update project.json (non-fatal)

If `PROJECT_ROOT/project.json` exists, read it, set `"mcp_url": "https://platform.algebras.ai/api/mcp"`, and write it back. Skip silently if the file doesn't exist.

## Step 6 — Final confirmation

Print:

```
Setup complete.

  Workflow files  →  copied to <PROJECT_ROOT>
  API key         →  saved to <PROJECT_ROOT>/.env
  MCP server      →  registered in ~/.claude/settings.json

Run /reload-plugins to activate the algebras MCP tools (check_fluency, check_fluency_batch).
Then say: "Translate this project."
```
