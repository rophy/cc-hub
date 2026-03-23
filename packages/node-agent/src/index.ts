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
    onStartSession: async (projectPath, prompt, channelName) => {
      return sessionManager.startSession(projectPath, prompt, channelName);
    },
    onStopSession: async (sessionShortId) => {
      return sessionManager.stopSession(sessionShortId);
    },
    onSendMessage: async (sessionShortId, text, from) => {
      return sessionManager.sendMessage(sessionShortId, text);
    },
  });

  const sessionManager = new SessionManager({
    onStreamEvent(event) {
      client.sendStreamEvent(event);
    },
    onSessionEnd(sessionShortId, channelName) {
      client.sendStreamEvent({
        shortId: sessionShortId,
        channelName,
        eventType: "session_end",
        text: "Session ended",
      });
    },
  });

  await client.connect();
  console.log(`Node agent [${shortId}] connected to ${config.serverUrl}`);

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
