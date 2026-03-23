#!/usr/bin/env node

import { loadClientConfig } from "@cc-hub/shared";
import { createAgentClient } from "./agent-client.js";
import { SessionManager } from "./session-manager.js";
import { generateShortId } from "./utils.js";
import { hostname } from "node:os";

const config = loadClientConfig();
const shortId = generateShortId();

async function main() {
  const client = createAgentClient({
    serverUrl: config.serverUrl,
    token: config.token,
    shortId,
    hostname: hostname(),
    onRunPrompt: async (projectPath, prompt) => {
      const { basename } = await import("node:path");
      const channelName = basename(projectPath);
      return sessionManager.runPrompt(projectPath, prompt, channelName);
    },
  });

  const sessionManager = new SessionManager({
    onStreamEvent(event) {
      client.sendStreamEvent(event);
    },
  });

  await client.connect();
  console.log(`Node agent [${shortId}] connected to ${config.serverUrl}`);

  process.on("SIGINT", () => {
    console.log("Shutting down node agent...");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Node agent failed to start:", err);
  process.exit(1);
});
