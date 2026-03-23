#!/usr/bin/env node

import { createWebSocketServer } from "./ws-server.js";
import { createDiscordBot } from "./discord-bot.js";
import { createRouter } from "./router.js";
import { createAuthManager } from "./auth.js";
import { formatStreamEvent } from "./stream-formatter.js";
import { loadState, saveState } from "./state.js";
import { parseTargetPrefix } from "./message-utils.js";
import { createRequest } from "@cc-hub/shared";

const WS_PORT = parseInt(process.env.CC_HUB_WS_PORT || "3000", 10);
let requestIdCounter = 0;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN environment variable is required");
  process.exit(1);
}

async function main() {
  const state = loadState();
  const router = createRouter(state, saveState);
  const auth = createAuthManager(state, saveState);

  // Track active Mode B sessions: shortId → channelName
  const modeBSessions = new Map<string, string>();

  // Discord bot
  const discord = await createDiscordBot(DISCORD_TOKEN!, router, auth, {
    onUserMessage(channelName, from, text, messageId) {
      const [targetShortId, message] = parseTargetPrefix(text);

      // Try Mode A first (cc-plugin connections)
      const plugins = router.getPluginsForChannel(channelName);
      if (plugins.length > 0) {
        wsServer.sendToChannel(channelName, from, message, messageId, targetShortId);
        return;
      }

      // Try Mode B (node-agent sessions)
      if (targetShortId) {
        wsServer.sendToNodeSession(targetShortId, from, message);
      } else {
        // Find first Mode B session for this channel
        for (const [shortId, ch] of modeBSessions) {
          if (ch === channelName) {
            wsServer.sendToNodeSession(shortId, from, message);
            break;
          }
        }
      }
    },
    async onStartSession(channelName, projectPath, prompt) {
      // Find a node-agent to handle this
      const agents = router.getNodeAgents();
      if (agents.length === 0) {
        return { ok: false, error: "No node-agents connected" };
      }

      // Send start_session to first available agent
      return new Promise((resolve) => {
        const agent = agents[0];
        const id = ++requestIdCounter;

        const msg = createRequest("node.start_session", {
          projectPath,
          prompt,
          channelName,
        }, id);

        // Listen for response
        const onMessage = (data: unknown) => {
          try {
            const resp = JSON.parse(String(data));
            if (resp.id === id && resp.result) {
              agent.ws.removeListener("message", onMessage);
              if (resp.result.ok && resp.result.shortId) {
                modeBSessions.set(resp.result.shortId, channelName);
              }
              resolve(resp.result);
            }
          } catch { /* ignore */ }
        };

        agent.ws.on("message", onMessage);
        agent.ws.send(JSON.stringify(msg));

        // Timeout after 10s
        setTimeout(() => {
          agent.ws.removeListener("message", onMessage);
          resolve({ ok: false, error: "Timeout waiting for node-agent response" });
        }, 10000);
      });
    },
  });
  console.log("Discord bot connected");

  // WebSocket server
  const wsServer = createWebSocketServer(WS_PORT, router, auth, {
    // Mode A: cc-plugin reply
    onCcReply(shortId, channelName, text, _files) {
      discord.sendReply(channelName, shortId, text);
    },
    onPluginConnected(shortId, channelName) {
      discord.postStatus(channelName, `*[${shortId}] session connected*`);
    },
    onPluginDisconnected(shortId, channelName) {
      discord.postStatus(channelName, `*[${shortId}] session ended*`);
    },
    // Mode B: node-agent stream events
    onStreamEvent(event) {
      const message = formatStreamEvent(event);
      if (!message) return;

      const channelName = event.channelName;
      if (!channelName) return;

      // Prefix with session ID for multi-session channels
      const prefixed = event.eventType === "text"
        ? `**[${event.shortId}]** ${message}`
        : message;

      discord.postStatus(channelName, prefixed);
    },
  });
  console.log(`WebSocket server listening on port ${WS_PORT}`);

  process.on("SIGINT", () => {
    console.log("Shutting down...");
    wsServer.close();
    discord.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
