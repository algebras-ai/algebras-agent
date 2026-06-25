"""
OpenAI translation agent — headless fallback for the Algebras GitHub Action.

Drives the OpenAI Responses API in a tool-call loop with file-operation tools,
using AGENTS.md as the system prompt. Terminates when the model stops calling
tools or after MAX_ITERATIONS iterations.
"""

import json
import os
import subprocess
import sys

from openai import OpenAI

MAX_ITERATIONS = 50

# ── Tools ─────────────────────────────────────────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "name": "list_directory",
        "description": "List files and directories at the given path (recursive).",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path (default: '.')"},
                "recursive": {"type": "boolean", "description": "List recursively (default: false)"},
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "read_file",
        "description": "Read the contents of a file.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to read"},
            },
            "required": ["path"],
        },
    },
    {
        "type": "function",
        "name": "write_file",
        "description": "Write content to a file, creating it if it doesn't exist.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to write"},
                "content": {"type": "string", "description": "Content to write"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "type": "function",
        "name": "run_shell",
        "description": "Run a shell command and return stdout + stderr.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to run"},
            },
            "required": ["command"],
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────

def execute_tool(name: str, args: dict) -> str:
    try:
        if name == "list_directory":
            path = args.get("path", ".")
            recursive = args.get("recursive", False)
            if recursive:
                result = subprocess.run(
                    ["find", path, "-not", "-path", "*/.git/*"],
                    capture_output=True, text=True, check=True,
                )
            else:
                result = subprocess.run(
                    ["ls", "-la", path],
                    capture_output=True, text=True, check=True,
                )
            return result.stdout

        elif name == "read_file":
            with open(args["path"]) as f:
                return f.read()

        elif name == "write_file":
            path = args["path"]
            os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
            with open(path, "w", encoding="utf-8") as f:
                f.write(args["content"])
            return f"Written: {path}"

        elif name == "run_shell":
            result = subprocess.run(
                args["command"],
                shell=True,
                capture_output=True,
                text=True,
            )
            output = result.stdout
            if result.stderr:
                output += "\n[stderr]\n" + result.stderr
            return output or "(no output)"

        else:
            return f"Unknown tool: {name}"

    except Exception as exc:
        return f"Error: {exc}"


# ── Main agent loop ───────────────────────────────────────────────────────────

def main():
    system_prompt_file = sys.argv[1] if len(sys.argv) > 1 else "AGENTS.md"
    with open(system_prompt_file) as f:
        system_prompt = f.read()

    client = OpenAI()
    messages = [{"role": "user", "content": "Translate this project."}]

    for iteration in range(MAX_ITERATIONS):
        response = client.responses.create(
            model="gpt-4o",
            instructions=system_prompt,
            input=messages,
            tools=TOOLS,
        )

        # Collect assistant message content and tool calls
        assistant_text = ""
        tool_calls = []

        for item in response.output:
            if item.type == "message":
                for block in item.content:
                    if hasattr(block, "text"):
                        assistant_text += block.text
            elif item.type == "function_call":
                tool_calls.append(item)

        if assistant_text:
            print(f"[agent] {assistant_text[:300]}{'...' if len(assistant_text) > 300 else ''}")

        # If no tool calls, the agent is done
        if not tool_calls:
            print(f"Agent completed after {iteration + 1} iteration(s).")
            break

        # Execute tool calls and build next-turn messages
        messages.append({"role": "assistant", "content": response.output})

        tool_results = []
        for call in tool_calls:
            args = json.loads(call.arguments) if isinstance(call.arguments, str) else call.arguments
            print(f"[tool] {call.name}({json.dumps(args)[:120]})")
            result = execute_tool(call.name, args)
            tool_results.append({
                "type": "function_call_output",
                "call_id": call.call_id,
                "output": result,
            })

        messages.append({"role": "user", "content": tool_results})

    else:
        print(f"::warning::Agent reached MAX_ITERATIONS ({MAX_ITERATIONS}) without finishing.")


if __name__ == "__main__":
    main()
