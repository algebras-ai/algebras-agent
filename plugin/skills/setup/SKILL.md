---
name: setup
description: Set up the Algebras translation agent — copies workflow files, registers MCP, and obtains the API key via browser device authorization (or a cached/env-provided key when possible)
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

Also copy the four phase skills (`onboard`, `glossary`, `translate`, `qa`) into the project. These give Claude Code/Codex sessions in this project a real, project-scoped skill to invoke even without the plugin installed, and give tools with no skill mechanism (Cursor, Windsurf) a plain file to read as a fallback, per the router files' "How to run a phase" section:

```bash
mkdir -p "$PROJECT_ROOT/skills"
for phase in onboard glossary translate qa; do
  mkdir -p "$PROJECT_ROOT/skills/$phase"
  cp -n "${PLUGIN_ROOT}/skills/$phase/SKILL.md" "$PROJECT_ROOT/skills/$phase/SKILL.md" 2>/dev/null || true
done
```

Report which files were copied and which were skipped (already existed).

## Step 2 — Resolve the API key

First determine `PLATFORM_URL`: the `ALGEBRAS_PLATFORM_URL` environment variable if set, else an existing `ALGEBRAS_PLATFORM_URL=` line in `PROJECT_ROOT/.env`, else `https://platform.algebras.ai`.

Then look for a usable key, in this order, stopping at the first hit:

1. **Shell environment.** If `ALGEBRAS_API_KEY` is already set in the environment, use it — this covers CI and users who manage secrets themselves.
2. **This project's `.env`.** If `PROJECT_ROOT/.env` already has a non-empty `ALGEBRAS_API_KEY=` line, use it. Don't make someone re-paste a key just because they're re-running setup on a project they've already configured.
3. **Global credential cache** (`<home>/.algebras/credentials.json`, see Step 2.2 for how `<home>` is resolved). If it has an entry for `PLATFORM_URL`, tell the user you're reusing the saved key for that platform URL and let them opt out: "Using your saved Algebras key for `<PLATFORM_URL>` — say 'use a different key' if you want to switch."
4. **Device authorization** (Step 2.1a) — the default interactive path when none of the above produced a key.
5. **Browser + manual paste** (Step 2.1b) — fallback only: device authorization failed or errored, or the user explicitly asks for it.

Whichever key you end up with, always run it through Step 2.3 (validate) before writing anything to disk.

### 2.1a Device authorization (primary)

No manual "create a key" step — the user just approves the CLI in their browser, the same way `gh auth login` or `docker login` work.

1. Request a device code:

   ```bash
   curl -s -X POST "${PLATFORM_URL}/api/auth/device/code" \
     -H "Content-Type: application/json" \
     -d '{"client_id":"algebras-agent-cli"}'
   ```

   Response: `{device_code, user_code, verification_uri_complete, expires_in, interval}`. If this request fails outright (network error, 404 — an older platform without this endpoint, etc.), don't retry it — fall straight through to Step 2.1b.

2. Open the browser to `verification_uri_complete` (same `open` / `xdg-open` / `start` pattern as 2.1b). Tell the user: "Approve access in your browser — waiting..." If the browser can't be opened, print the URL instead.

3. Poll for the result:

   ```bash
   curl -s -X POST "${PLATFORM_URL}/api/device/exchange" \
     -H "Content-Type: application/json" \
     -d "{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"<device_code>\",\"client_id\":\"algebras-agent-cli\"}"
   ```

   Wait `interval` seconds between polls (the response also carries a fresh `error` on `slow_down` — back off if you see it). Handle the response:
   - `{api_key, organization}` → success. Use `api_key` as `KEY` and continue to Step 2.3.
   - `{"error":"authorization_pending", ...}` → keep polling.
   - `{"error":"slow_down", ...}` → increase the interval and keep polling.
   - `{"error":"access_denied", ...}` → the user denied the request, or no longer has admin access to the org they picked. Tell them, and ask if they want to retry (new device code) or fall back to 2.1b.
   - `{"error":"expired_token", ...}` → the user didn't approve in time (default 15m). Ask whether to start over or fall back to 2.1b.
   - Anything else (malformed response, connection errors, repeated unexpected failures) → fall through to Step 2.1b rather than looping forever.

### 2.1b Browser + manual paste (fallback)

Open the Algebras API keys page in the default browser:

```bash
# macOS
open "${PLATFORM_URL}/api-keys"
# Linux
xdg-open "${PLATFORM_URL}/api-keys"
# Windows
start "" "${PLATFORM_URL}/api-keys"
```

If the browser can't be opened, print: "Open this URL to get your API key: `<PLATFORM_URL>/api-keys`"

Then tell the user: "Your browser should now be open at `<PLATFORM_URL>/api-keys` — paste your API key here."

Wait for the user to paste the key. Check: the value must be non-empty and must not contain spaces. If invalid, ask again. Never print the full key back into the conversation.

### 2.2 Global credential cache

Resolve the cache path portably — don't hardcode `~`, it doesn't expand on native Windows shells:

```bash
CRED_HOME="${HOME:-$USERPROFILE}"
CRED_FILE="${CRED_HOME}/.algebras/credentials.json"
```

- Linux / macOS / Git Bash / WSL: `$HOME` is set — use it.
- Native Windows (PowerShell / cmd, no bash involved): `$HOME` is unset, so this falls back to `$USERPROFILE` (`%USERPROFILE%` / `$env:USERPROFILE`).

`CRED_FILE` maps platform URL → API key, so a key only has to be created once per machine, not once per project:

```json
{
  "https://platform.algebras.ai": "<key>",
  "http://localhost:3000": "<key>"
}
```

- **Reading**: if `CRED_FILE` exists, parse it and look up `PLATFORM_URL` as a key.
- **Writing**: after Step 2.3 successfully validates a key that came from Step 2.1a or 2.1b (device auth or a fresh browser+paste), save it to `CRED_FILE` so future `setup` runs on any project skip straight past both. Read the existing file first (if any) so you only add/update the one entry for `PLATFORM_URL` instead of clobbering entries for other platform URLs. Create the parent directory (`mkdir -p`) if it doesn't exist. Use the Write tool, not shell echo, so the key doesn't appear in Bash output.
- **Permissions**: restrict `CRED_FILE` to the current user where the platform supports it — `chmod 600 "$CRED_FILE"` on Linux/macOS/Git Bash/WSL. This is a POSIX permission bit with no real equivalent on native Windows (NTFS uses ACLs, not mode bits): if `chmod` isn't available or errors, skip it rather than fail the step — a normal per-user Windows profile directory is already private by default. Never fail the whole setup over this.
- Don't write to the cache when the key came from the shell environment (1) or the project's own `.env` (2) — only a freshly obtained key (2.1a or 2.1b) needs to be persisted.

### 2.3 Validate the key

Before writing the key anywhere, confirm it actually works:

```bash
curl -s -H "x-api-key: ${KEY}" "${PLATFORM_URL}/api/v1/me"
```

This is a real validation endpoint (returns the key's name/owner and org info), not just a reachability probe — use it rather than guessing from a status code on an unrelated endpoint.

- `200` with a JSON body containing `data.apiKey`/`data.organization` → valid, proceed.
- `401` → the key is invalid or revoked. Tell the user which source it came from (env / project `.env` / global cache / device auth / fresh paste), discard it, and fall back to Step 2.1a (or 2.1b if 2.1a already failed) to get a fresh one — never silently proceed with a key you know was rejected. If the rejected key came from the global cache, remove that entry once you have a working replacement.
- If `curl` itself fails (no network, DNS error, etc.), don't block setup on it — warn once and proceed; the real check happens when the MCP connection is used after restart.

Skip this step for a key that just came out of Step 2.1a's exchange — the exchange endpoint only ever returns a key it just minted, so it's valid by construction.

## Step 3 — Save API key to .env

Read `PROJECT_ROOT/.env` if it exists. Apply upsert logic:
- If a line starting with `ALGEBRAS_API_KEY=` exists, replace it
- Otherwise append `ALGEBRAS_API_KEY=<key>` on a new line
- Preserve any existing `ALGEBRAS_PLATFORM_URL=` line unchanged

Write the result using the Write tool (not shell echo) so the key value doesn't appear in Bash output.

## Step 4 — Register MCP server

If running in Claude Code, run the following command to register the algebras MCP server for this project:

```bash
claude mcp add --transport http algebras "${PLATFORM_URL}/api/mcp" --header "x-api-key: <KEY>"
```

If the command output says the server already exists, run it with `--force` to overwrite:

```bash
claude mcp add --transport http --force algebras "${PLATFORM_URL}/api/mcp" --header "x-api-key: <KEY>"
```

This writes to `~/.claude.json` scoped to the current project — the correct location Claude Code reads MCP servers from.

If running in Codex, update `~/.codex/config.toml` instead. Add or replace only this block, preserving all other Codex config:

```toml
[mcp_servers.algebras]
url = "<PLATFORM_URL>/api/mcp"
enabled = true
http_headers = { "x-api-key" = "<KEY>" }
```

Use the Write or Edit tool so the key does not appear in shell output. This is the correct location Codex CLI and the Codex IDE extension read MCP servers from.

## Step 5 — Update project.json (non-fatal)

If `PROJECT_ROOT/project.json` exists, read it, set `"mcp_url": "${PLATFORM_URL}/api/mcp"`, and write it back. Skip silently if the file doesn't exist.

## Step 6 — Final confirmation

Print:

```
Setup complete.

  Workflow files  →  copied to <PROJECT_ROOT>
  Phase skills    →  copied to <PROJECT_ROOT>/skills/{onboard,glossary,translate,qa}
  API key         →  validated and saved to <PROJECT_ROOT>/.env (source: <env / project .env / global cache / device auth / fresh paste>)
  MCP server      →  registered in <Claude or Codex MCP config>

Restart your agent to connect the algebras MCP tools (check_fluency, check_fluency_batch).
In Codex, use /mcp after restart to confirm the algebras server is active.

This agent runs a four-phase pipeline: onboard → glossary → translate → qa. Invoke each
phase's skill by name (e.g. `algebras-agent:onboard`) if your session supports skills,
otherwise follow skills/<phase>/SKILL.md directly — see CLAUDE.md/AGENTS.md for details.

Then say: "Translate this project."
```
