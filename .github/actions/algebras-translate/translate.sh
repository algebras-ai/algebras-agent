#!/usr/bin/env bash
set -euo pipefail

GITHUB_RAW="https://raw.githubusercontent.com/algebras-ai/algebras-agent/main/plugin"

# ── A. Validate inputs ────────────────────────────────────────────────────────

: "${INPUT_ALGEBRAS_API_KEY:?algebras-api-key is required}"
: "${INPUT_LLM_PROVIDER:=anthropic}"
: "${INPUT_ALGEBRAS_PLATFORM_URL:=https://platform.algebras.ai}"
: "${INPUT_COMMIT_CHANGES:=true}"
: "${INPUT_CREATE_PR:=false}"
: "${INPUT_SKIP_IF_COMPLETE:=true}"
: "${INPUT_MIN_FLUENCY_SCORE:=}"

if [[ "$INPUT_LLM_PROVIDER" == "anthropic" ]]; then
  if [[ -z "${INPUT_ANTHROPIC_API_KEY:-}" ]]; then
    echo "::error::anthropic-api-key is required when llm-provider is 'anthropic'"
    exit 1
  fi
elif [[ "$INPUT_LLM_PROVIDER" == "openai" ]]; then
  if [[ -z "${INPUT_OPENAI_API_KEY:-}" ]]; then
    echo "::error::openai-api-key is required when llm-provider is 'openai'"
    exit 1
  fi
elif [[ "$INPUT_LLM_PROVIDER" == "gemini" ]]; then
  if [[ -z "${INPUT_GEMINI_API_KEY:-}" ]]; then
    echo "::error::gemini-api-key is required when llm-provider is 'gemini'"
    exit 1
  fi
else
  echo "::error::llm-provider must be 'anthropic', 'openai', or 'gemini', got: $INPUT_LLM_PROVIDER"
  exit 1
fi

# ── B. Download workflow files ────────────────────────────────────────────────

echo "::group::Downloading workflow files"
for f in CLAUDE.md AGENTS.md COMMON_MISTAKES.md; do
  curl -fsSL "$GITHUB_RAW/$f" -o "$f"
  echo "  Downloaded $f"
done
echo "::endgroup::"

# ── C. Check translation status ───────────────────────────────────────────────

if [[ "$INPUT_SKIP_IF_COMPLETE" == "true" ]] && [[ -f "project.json" ]]; then
  COMPLETE=$(python3 - <<'PYEOF'
import json, sys

with open("project.json") as f:
    p = json.load(f)

languages = p.get("target_languages", [])
if not languages:
    print("false")
    sys.exit(0)

# Look for a completion_status or similar summary field.
# The agent writes completion info into project.json under "status".
status = p.get("status", {})
if not status:
    print("false")
    sys.exit(0)

all_done = all(
    lang_info.get("percent_complete", 0) >= 100
    for lang_info in status.values()
    if isinstance(lang_info, dict)
)
print("true" if all_done else "false")
PYEOF
)
  if [[ "$COMPLETE" == "true" ]]; then
    echo "::notice::All translations are complete. Skipping agent run."
    exit 0
  fi
fi

# ── D. Write MCP config ───────────────────────────────────────────────────────

MCP_CONFIG=$(mktemp /tmp/mcp-config-XXXXXX.json)
# shellcheck disable=SC2064
trap "rm -f '$MCP_CONFIG'" EXIT

ALGEBRAS_API_KEY="$INPUT_ALGEBRAS_API_KEY" \
PLATFORM_URL="$INPUT_ALGEBRAS_PLATFORM_URL" \
python3 - <<'PYEOF' > "$MCP_CONFIG"
import json, os
cfg = {
    "mcpServers": {
        "algebras": {
            "type": "http",
            "url": os.environ["PLATFORM_URL"] + "/api/mcp",
            "headers": {"x-api-key": os.environ["ALGEBRAS_API_KEY"]},
        }
    }
}
print(json.dumps(cfg, indent=2))
PYEOF

echo "MCP config written to $MCP_CONFIG"

# ── E. Install CLI and run agent ──────────────────────────────────────────────

if [[ "$INPUT_LLM_PROVIDER" == "anthropic" ]]; then
  echo "::group::Installing Claude CLI"
  npm install -g @anthropic-ai/claude-code --quiet
  echo "::endgroup::"

  echo "::group::Running Claude translation agent"
  ANTHROPIC_API_KEY="$INPUT_ANTHROPIC_API_KEY" \
  claude \
    --print \
    --bare \
    --dangerously-skip-permissions \
    --mcp-config "$MCP_CONFIG" \
    --system-prompt-file CLAUDE.md \
    "Translate this project."
  echo "::endgroup::"

elif [[ "$INPUT_LLM_PROVIDER" == "openai" ]]; then
  echo "::group::Installing OpenAI SDK"
  pip install openai --quiet
  echo "::endgroup::"

  echo "::group::Running OpenAI translation agent"
  OPENAI_API_KEY="$INPUT_OPENAI_API_KEY" \
  ALGEBRAS_MCP_CONFIG="$MCP_CONFIG" \
  python3 "$ACTION_PATH/openai_translate.py" AGENTS.md
  echo "::endgroup::"

elif [[ "$INPUT_LLM_PROVIDER" == "gemini" ]]; then
  echo "::group::Installing Gemini CLI"
  npm install -g @google/gemini-cli --quiet
  echo "::endgroup::"

  echo "::group::Running Gemini translation agent"
  # Gemini CLI reads GEMINI.md as its system prompt — reuse CLAUDE.md content.
  cp CLAUDE.md GEMINI.md
  GEMINI_API_KEY="$INPUT_GEMINI_API_KEY" \
  gemini \
    --yolo \
    --mcp-config "$MCP_CONFIG" \
    "Translate this project."
  echo "::endgroup::"
fi

# ── F. Detect changes ─────────────────────────────────────────────────────────

CHANGED=$(git diff --name-only)
CHANGED_STAGED=$(git diff --cached --name-only)
ALL_CHANGED=$(printf '%s\n%s' "$CHANGED" "$CHANGED_STAGED" | sort -u | grep -v '^$' || true)

if [[ -z "$ALL_CHANGED" ]]; then
  echo "::notice::No translation changes were produced."
  exit 0
fi

echo "Files changed:"
echo "$ALL_CHANGED"

# ── G. Commit or create PR ────────────────────────────────────────────────────

if [[ "$INPUT_COMMIT_CHANGES" != "true" ]]; then
  echo "::notice::commit-changes is false — skipping commit."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A

COMMIT_MSG="chore: automated translation update [skip ci]"

if [[ "$INPUT_CREATE_PR" == "true" ]]; then
  BRANCH="algebras/translate-$(date +%Y%m%d%H%M%S)"
  git checkout -b "$BRANCH"
  git commit -m "$COMMIT_MSG"
  git push origin "$BRANCH"

  PR_BODY=$(printf 'Automated translation run via the [Algebras agent](https://platform.algebras.ai).\n\n**Files changed:**\n```\n%s\n```' "$ALL_CHANGED")
  gh pr create \
    --title "chore: automated translation update" \
    --body "$PR_BODY" || true
  echo "::notice::Pull request created from branch $BRANCH"
else
  git commit -m "$COMMIT_MSG"
  git push
  echo "::notice::Translated files committed and pushed."
fi
