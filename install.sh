#!/usr/bin/env bash
set -euo pipefail

PLATFORM_URL="https://platform.algebras.ai"
GITHUB_RAW="https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin"
WORKFLOW_FILES=(CLAUDE.md AGENTS.md .cursorrules .windsurfrules COMMON_MISTAKES.md)

# ── Argument parsing ──────────────────────────────────────────────────────────

AGENT_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT_FLAG="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -n "$AGENT_FLAG" && ! "$AGENT_FLAG" =~ ^(cursor|windsurf|codex)$ ]]; then
  echo "Unknown agent: \"$AGENT_FLAG\". Known values: cursor, windsurf, codex" >&2
  exit 1
fi

# ── Agent detection ───────────────────────────────────────────────────────────

detect_agent() {
  [[ -n "$AGENT_FLAG" ]]    && { echo "$AGENT_FLAG"; return; }
  [[ -d ".cursor" ]]        && { echo "cursor";      return; }
  [[ -d ".windsurf" ]]      && { echo "windsurf";    return; }
  [[ -d "$HOME/.codex" ]]   && { echo "codex";       return; }
  echo ""
}

mcp_config_path() {
  case "$1" in
    cursor)   echo "$PWD/.cursor/mcp.json" ;;
    windsurf) echo "$PWD/.windsurf/mcp.json" ;;
    codex)    echo "$HOME/.codex/config.json" ;;
  esac
}

agent=$(detect_agent)
if [[ -z "$agent" ]]; then
  cat >&2 <<'EOF'
No agent detected. Re-run with --agent to specify one:

  curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent cursor
  curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent windsurf
  curl -fsSL https://platform.algebras.ai/install | bash -s -- --agent codex
EOF
  exit 1
fi

echo "Detected agent: $agent"

# ── Workflow files ────────────────────────────────────────────────────────────

echo ""
echo "Downloading workflow files..."
for file in "${WORKFLOW_FILES[@]}"; do
  if [[ -f "$file" ]]; then
    echo "  Skipped: $file (already exists)"
  else
    curl -fsSL "$GITHUB_RAW/$file" -o "$file"
    echo "  Copied:  $file"
  fi
done

# ── API key ───────────────────────────────────────────────────────────────────

api_keys_url="$PLATFORM_URL/api-keys"
if command -v open >/dev/null 2>&1; then
  open "$api_keys_url"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$api_keys_url" 2>/dev/null || true
else
  printf '\nOpen this URL to get your API key:\n  %s\n' "$api_keys_url" >&2
fi

printf '\nPaste your Algebras API key:\n> ' >&2
IFS= read -r api_key </dev/tty
if [[ -z "$api_key" || "$api_key" == *" "* ]]; then
  echo "Invalid key. Exiting." >&2
  exit 1
fi

# ── .env ─────────────────────────────────────────────────────────────────────

ALGEBRAS_API_KEY="$api_key" ALGEBRAS_PLATFORM_URL="$PLATFORM_URL" python3 - <<'PYEOF'
import os, re

path = ".env"
content = open(path).read() if os.path.exists(path) else ""

def upsert(content, key, value):
    pattern = re.compile(f"^{re.escape(key)}=.*", re.MULTILINE)
    line = f"{key}={value}"
    if pattern.search(content):
        return pattern.sub(line, content)
    sep = "" if (not content or content.endswith("\n")) else "\n"
    return content + sep + line + "\n"

content = upsert(content, "ALGEBRAS_API_KEY",     os.environ["ALGEBRAS_API_KEY"])
content = upsert(content, "ALGEBRAS_PLATFORM_URL", os.environ["ALGEBRAS_PLATFORM_URL"])

with open(path, "w") as f:
    f.write(content)
PYEOF

# ── project.json (non-fatal) ──────────────────────────────────────────────────

if [[ -f "project.json" ]]; then
  ALGEBRAS_PLATFORM_URL="$PLATFORM_URL" python3 - <<'PYEOF' 2>/dev/null || true
import json, os

with open("project.json") as f:
    config = json.load(f)
config["mcp_url"] = f"{os.environ['ALGEBRAS_PLATFORM_URL']}/api/mcp"
with open("project.json", "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PYEOF
fi

# ── MCP config ────────────────────────────────────────────────────────────────

config_path=$(mcp_config_path "$agent")
mkdir -p "$(dirname "$config_path")"

ALGEBRAS_CONFIG_PATH="$config_path" \
ALGEBRAS_API_KEY="$api_key" \
ALGEBRAS_PLATFORM_URL="$PLATFORM_URL" \
python3 - <<'PYEOF'
import json, os, sys

path    = os.environ["ALGEBRAS_CONFIG_PATH"]
api_key = os.environ["ALGEBRAS_API_KEY"]
url     = os.environ["ALGEBRAS_PLATFORM_URL"]

existing = {}
if os.path.exists(path):
    try:
        with open(path) as f:
            existing = json.load(f)
    except json.JSONDecodeError:
        print(f"Warning: {path} has a JSON syntax error — overwriting.", file=sys.stderr)

existing.setdefault("mcpServers", {})["algebras"] = {
    "type": "http",
    "url": f"{url}/api/mcp",
    "headers": {"x-api-key": api_key},
}

with open(path, "w") as f:
    json.dump(existing, f, indent=2)
    f.write("\n")
PYEOF

# ── Done ──────────────────────────────────────────────────────────────────────

printf '\nSetup complete.\n\n'
printf '  Workflow files  →  project root\n'
printf '  API key         →  .env\n'
printf '  MCP server      →  %s\n' "$config_path"
printf '\nOpen your project in %s and say: "Translate this project."\n' "$agent"
