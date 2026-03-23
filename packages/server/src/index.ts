#!/usr/bin/env node

import { createWebSocketServer } from "./ws-server.js";
import { createDiscordBot } from "./discord-bot.js";
import { createRouter } from "./router.js";
import { createAuthManager } from "./auth.js";
import { formatStreamEvent } from "./stream-formatter.js";
import { loadState, saveState } from "./state.js";
import { loadServerConfig } from "@cc-hub/shared";

const config = loadServerConfig();

if (!config.discordToken) {
  console.error("DISCORD_TOKEN not found. Set it via environment variable or in ~/.cc-hub/config.json (discordToken field).");
  process.exit(1);
}

async function main() {
  const state = loadState();
  const router = createRouter(state, saveState);
  const auth = createAuthManager(state, saveState);

  // Channels currently processing a headless prompt
  const busyChannels = new Set<string>();
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function hasActiveSession(channelName: string): boolean {
    if (router.getPluginsForChannel(channelName).length > 0) return true;
    if (busyChannels.has(channelName)) return true;
    return false;
  }

  // Discord bot
  const discord = await createDiscordBot(config.discordToken, router, auth, {
    hasActiveSession,

    onUserMessage(channelName, from, text, messageId) {
      // Route to Mode A (cc-plugin) if available
      const plugins = router.getPluginsForChannel(channelName);
      if (plugins.length > 0) {
        wsServer.sendToChannel(channelName, from, text, messageId);
        return;
      }

      // Route to Mode B (node-agent)
      const projectPath = router.getProjectPathForChannel(channelName);
      if (projectPath) {
        busyChannels.add(channelName);
        wsServer.sendToNodeSession(channelName, from, text, projectPath);
      }
    },

    async onStartHeadless(channelName, projectPath, prompt) {
      if (hasActiveSession(channelName)) {
        return { ok: false, error: "Channel is busy" };
      }

      const agents = router.getNodeAgents();
      if (agents.length === 0) {
        return { ok: false, error: "No node-agents connected" };
      }

      busyChannels.add(channelName);
      wsServer.sendToNodeSession(channelName, "discord", prompt, projectPath);
      return { ok: true };
    },
  });
  console.log("Discord bot connected");

  // WebSocket server
  const wsServer = createWebSocketServer(config.wsPort, router, auth, {
    // Mode A: cc-plugin
    onCcReply(shortId, channelName, text, _files) {
      discord.sendReply(channelName, shortId, text);
    },
    onPluginConnecting(_shortId, channelName) {
      return !hasActiveSession(channelName);
    },
    onPluginConnected(shortId, channelName) {
      discord.postStatus(channelName, `*[${shortId}] session connected*`);
    },
    onPluginDisconnected(shortId, channelName) {
      discord.postStatus(channelName, `*[${shortId}] session ended*`);
    },

    // Node-agent lifecycle
    onNodeAgentDisconnected(_shortId) {
      // Start timeout — if agent doesn't reconnect, clear busy channels
      disconnectTimer = setTimeout(() => {
        busyChannels.clear();
        console.log("Node-agent disconnect timeout — busy channels cleared");
      }, config.disconnectTimeoutMs);
    },
    onNodeAgentReconnected(_shortId, agentBusyChannels) {
      // Cancel disconnect timeout — agent is back
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      // Reconcile: clear busy channels the agent no longer claims
      for (const ch of busyChannels) {
        if (!agentBusyChannels.includes(ch)) {
          busyChannels.delete(ch);
        }
      }
      // Add any channels the agent says are busy
      for (const ch of agentBusyChannels) {
        busyChannels.add(ch);
      }
    },

    // Mode B: node-agent stream events
    onStreamEvent(event) {
      if (!event.channelName) return;

      // Prompt finished — release the channel
      if (event.eventType === "session_end") {
        busyChannels.delete(event.channelName);
        return; // Don't post "session ended" to Discord
      }

      const message = formatStreamEvent(event);
      if (!message) return;
      discord.postStatus(event.channelName, message);
    },
  });
  console.log(`WebSocket server listening on port ${config.wsPort}`);

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
