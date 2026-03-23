#!/usr/bin/env node

import { loadClientConfig, createLogger } from "@cc-hub/shared";
import { createAgentClient } from "./agent-client.js";
import { SessionManager, getBusyChannels } from "./session-manager.js";
import { generateShortId } from "./utils.js";
import { hostname } from "node:os";

const config = loadClientConfig();
const shortId = generateShortId();
const log = createLogger({ name: "node-agent", transport: "stdout" });

async function main() {
  const client = createAgentClient({
    serverUrl: config.serverUrl,
    token: config.token,
    shortId,
    hostname: hostname(),
    getBusyChannels,
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
  log.info({ shortId, serverUrl: config.serverUrl }, "connected");

  process.on("SIGINT", () => {
    log.info("shutting down");
    process.exit(0);
  });
}

main().catch((err) => {
  log.fatal({ err }, "failed to start");
  process.exit(1);
});
