#!/usr/bin/env node

import { createAgentClient } from "./agent-client.js";
import { SessionManager } from "./session-manager.js";
import { generateShortId } from "./utils.js";
import { hostname } from "node:os";

const serverUrl = process.env.CC_HUB_SERVER_URL || "ws://localhost:3000";
const token = process.env.CC_HUB_TOKEN || "";
const shortId = generateShortId();

async function main() {
  const sessionManager = new SessionManager();

  const client = createAgentClient({
    serverUrl,
    token,
    shortId,
    hostname: hostname(),
    onStartSession: async (projectPath, prompt) => {
      return sessionManager.startSession(projectPath, prompt);
    },
    onStopSession: async (sessionShortId) => {
      return sessionManager.stopSession(sessionShortId);
    },
  });

  await client.connect();
  console.log(`Node agent [${shortId}] connected to ${serverUrl}`);

  // Periodic heartbeat
  setInterval(() => {
    client.sendHeartbeat(sessionManager.getActiveSessions());
  }, 30000);

  process.on("SIGINT", () => {
    console.log("Shutting down node agent...");
    sessionManager.stopAll();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Node agent failed to start:", err);
  process.exit(1);
});
