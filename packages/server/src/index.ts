#!/usr/bin/env node

import { createWebSocketServer } from "./ws-server.js";
import { createDiscordBot } from "./discord-bot.js";
import { createRouter } from "./router.js";
import { createAuthManager } from "./auth.js";
import { loadState, saveState } from "./state.js";
import { parseTargetPrefix } from "./message-utils.js";

const WS_PORT = parseInt(process.env.CC_HUB_WS_PORT || "3000", 10);
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN environment variable is required");
  process.exit(1);
}

async function main() {
  const state = loadState();
  const router = createRouter(state, saveState);
  const auth = createAuthManager(state, saveState);

  // Discord bot
  const discord = await createDiscordBot(DISCORD_TOKEN!, router, auth, {
    onUserMessage(channelName, from, text, messageId) {
      const [targetShortId, message] = parseTargetPrefix(text);
      wsServer.sendToChannel(channelName, from, message, messageId, targetShortId);
    },
  });
  console.log("Discord bot connected");

  // WebSocket server
  const wsServer = createWebSocketServer(WS_PORT, router, auth, {
    onCcReply(shortId, channelName, text, _files) {
      discord.sendReply(channelName, shortId, text);
    },
    onPluginConnected(shortId, channelName) {
      discord.postStatus(channelName, `[${shortId}] session connected`);
    },
    onPluginDisconnected(shortId, channelName) {
      discord.postStatus(channelName, `[${shortId}] session ended`);
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
