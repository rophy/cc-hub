#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadClientConfig, createLogger } from "@cc-hub/shared";
import { createBridgeClient } from "./bridge-client.js";
import { generateShortId } from "./utils.js";

const shortId = generateShortId();
const projectPath = process.cwd();
const config = loadClientConfig();
const log = createLogger({
  name: "cc-plugin",
  transport: "file",
  filePath: join(homedir(), ".cc-hub", `cc-plugin-${shortId}.log`),
});

// MCP Server setup
const mcp = new Server(
  { name: "cc-hub", version: "0.0.1" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      `Messages from cc-hub arrive as <channel source="cc-hub" chat_id="..." user="...">.`,
      `You MUST call the reply tool for EVERY channel message — the sender cannot see your terminal output.`,
      `Always pass the chat_id back when calling reply.`,
      `Your session ID is [${shortId}].`,
    ].join(" "),
  },
);

// Register tools
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send a reply back to the chat platform channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: {
            type: "string",
            description: "The chat_id from the incoming message",
          },
          text: {
            type: "string",
            description: "The reply text (markdown)",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Absolute file paths to attach",
          },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "reply") {
    const { text, files } = request.params.arguments as {
      chat_id: string;
      text: string;
      files?: string[];
    };
    await bridgeClient.sendReply(text, files);
    return { content: [{ type: "text", text: "sent" }] };
  }
  return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
});

// Bridge client setup
const bridgeClient = createBridgeClient({
  serverUrl: config.serverUrl,
  token: config.token,
  shortId,
  projectPath,
  log,
  onMessage: async (from: string, text: string, messageId?: string) => {
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: text,
        meta: {
          source: "cc-hub",
          chat_id: shortId,
          user: from,
          ...(messageId ? { message_id: messageId } : {}),
        },
      },
    });
  },
});

// Start
async function main() {
  await bridgeClient.connect();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  log.fatal({ err }, "cc-hub plugin failed to start");
  process.exit(1);
});
