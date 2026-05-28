#!/usr/bin/env node
// One-time setup: authenticates with Algebras and saves ALGEBRAS_API_KEY to .env

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";
import { homedir } from "os";
import { join, dirname } from "path";

// Load .env before reading any env vars
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

const PLATFORM_URL = process.env.ALGEBRAS_PLATFORM_URL ?? "https://platform.algebras.ai";

// --agent <name> override
const agentFlagIdx = process.argv.indexOf("--agent");
const agentFlag = agentFlagIdx !== -1 ? process.argv[agentFlagIdx + 1] ?? null : null;

const AGENTS = {
  cursor:   { configPath: join(process.cwd(), ".cursor", "mcp.json") },
  windsurf: { configPath: join(process.cwd(), ".windsurf", "mcp.json") },
  codex:    { configPath: join(homedir(), ".codex", "config.json") },
};

function detectAgent() {
  if (agentFlag) {
    if (!AGENTS[agentFlag]) {
      console.error(`Unknown agent: "${agentFlag}". Known values: ${Object.keys(AGENTS).join(", ")}`);
      process.exit(1);
    }
    return agentFlag;
  }
  if (existsSync(join(process.cwd(), ".cursor")))   return "cursor";
  if (existsSync(join(process.cwd(), ".windsurf"))) return "windsurf";
  if (existsSync(join(homedir(), ".codex")))        return "codex";
  return null;
}

function mcpBlock(key) {
  return {
    mcpServers: {
      algebras: {
        type: "http",
        url: `${PLATFORM_URL}/api/mcp`,
        headers: { "x-api-key": key },
      },
    },
  };
}

function writeMcpConfig(agent, key) {
  const { configPath } = AGENTS[agent];
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let existing = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      console.error(`Warning: ${configPath} has a JSON syntax error — overwriting.`);
    }
  }

  const merged = {
    ...existing,
    mcpServers: { ...(existing.mcpServers ?? {}), ...mcpBlock(key).mcpServers },
  };

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(`MCP server registered in ${configPath}`);
}

function printMcpConfig(key) {
  console.log(`
No agent config directory detected. Add the following to your agent's MCP config file:

  Cursor    →  .cursor/mcp.json   (project root)
  Windsurf  →  .windsurf/mcp.json (project root)
  Codex     →  ~/.codex/config.json

${JSON.stringify(mcpBlock(key), null, 2)}

Re-run with --agent <cursor|windsurf|codex> to write it automatically.
`);
}

function setEnvVar(content, key, value) {
  const pattern = new RegExp(`^${key}=.*`, "m");
  if (pattern.test(content)) return content.replace(pattern, `${key}=${value}`);
  return content + (content.endsWith("\n") || content === "" ? "" : "\n") + `${key}=${value}\n`;
}

function writeEnv(key) {
  const envPath = ".env";
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  content = setEnvVar(content, "ALGEBRAS_API_KEY", key);
  content = setEnvVar(content, "ALGEBRAS_PLATFORM_URL", PLATFORM_URL);
  writeFileSync(envPath, content, "utf8");
  console.log(`Wrote ALGEBRAS_API_KEY to .env`);
}

function updateProjectJson() {
  const projectPath = "project.json";
  if (!existsSync(projectPath)) return;
  try {
    const config = JSON.parse(readFileSync(projectPath, "utf8"));
    config.mcp_url = `${PLATFORM_URL}/api/mcp`;
    writeFileSync(projectPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    console.log(`Updated mcp_url in project.json`);
  } catch {
    // non-fatal
  }
}

async function askApiKey() {
  const apiKeysUrl = `${PLATFORM_URL}/api-keys`;
  try {
    if (process.platform === "darwin")      execSync(`open "${apiKeysUrl}"`);
    else if (process.platform === "win32")  execSync(`start "" "${apiKeysUrl}"`);
    else                                    execSync(`xdg-open "${apiKeysUrl}"`);
  } catch {
    process.stderr.write(`\nOpen this URL to get your API key:\n  ${apiKeysUrl}\n`);
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`\nPaste your Algebras API key:\n> `);
    rl.once("line", (line) => { rl.close(); resolve(line.trim()); });
  });
}

const key = await askApiKey();
if (!key || key.includes(" ")) {
  console.error("Invalid key. Exiting.");
  process.exit(1);
}

writeEnv(key);
updateProjectJson();

const agent = detectAgent();
if (agent) {
  writeMcpConfig(agent, key);
  console.log(`\nSetup complete. Open your project in ${agent} and say: "Translate this project."`);
} else {
  printMcpConfig(key);
}
