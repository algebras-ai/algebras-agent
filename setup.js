#!/usr/bin/env node
// One-time setup: authenticates with Algebras and saves ALGEBRAS_API_KEY to .env

import { createServer } from "http";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { URL } from "url";

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
const CALLBACK_PORT = 3456;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}`;

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "darwin") execSync(`open "${url}"`);
    else if (platform === "win32") execSync(`start "" "${url}"`);
    else execSync(`xdg-open "${url}"`);
  } catch {
    console.log(`\nCould not open browser automatically. Open this URL manually:\n\n  ${url}\n`);
  }
}

function setEnvVar(content, key, value) {
  const pattern = new RegExp(`^${key}=.*`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${value}`);
  }
  return content + (content.endsWith("\n") || content === "" ? "" : "\n") + `${key}=${value}\n`;
}

function writeEnv(key) {
  const envPath = ".env";
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  content = setEnvVar(content, "ALGEBRAS_API_KEY", key);
  content = setEnvVar(content, "ALGEBRAS_PLATFORM_URL", PLATFORM_URL);
  writeFileSync(envPath, content, "utf8");
  console.log(`Wrote ALGEBRAS_API_KEY and ALGEBRAS_PLATFORM_URL to .env`);
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

function printNextSteps(key) {
  console.log(`
Setup complete.

Add the following to your MCP client config:

  Claude Desktop  →  ~/Library/Application Support/Claude/claude_desktop_config.json
  Cursor          →  .cursor/mcp.json (in your project root)

{
  "mcpServers": {
    "algebras": {
      "url": "${PLATFORM_URL}/api/mcp",
      "headers": {
        "x-api-key": "${key}"
      }
    }
  }
}

Then copy CLAUDE.md, tools/, and glossary/ into your translation project:

  cp -r tools/ glossary/ CLAUDE.md COMMON_MISTAKES.md project.json .env your-project/
`);
}

async function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, CALLBACK_URL);
      const key = url.searchParams.get("key");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (key) {
        res.end("<html><body><h2>Algebras MCP connected.</h2><p>You can close this tab.</p></body></html>");
        server.close();
        resolve(key);
      } else {
        res.end("<html><body><h2>Missing key parameter.</h2></body></html>");
        server.close();
        reject(new Error("No key in callback"));
      }
    });

    server.listen(CALLBACK_PORT, "localhost", () => {
      const authUrl = `${PLATFORM_URL}/api/auth/mcp-connect?callback=${encodeURIComponent(CALLBACK_URL)}`;
      console.log("Opening browser to authenticate with Algebras...");
      openBrowser(authUrl);
    });

    server.on("error", reject);

    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authentication (120s)"));
    }, 120_000);
  });
}

try {
  const key = await waitForCallback();
  writeEnv(key);
  updateProjectJson();
  printNextSteps(key);
} catch (err) {
  console.error("Setup failed:", err.message);
  process.exit(1);
}
