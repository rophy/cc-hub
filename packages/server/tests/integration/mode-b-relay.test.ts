import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import pino from "pino";
import { createWebSocketServer, type WsServerHandle } from "../../src/ws-server.js";
import { createRouter, type Router } from "../../src/router.js";
import { createAuthManager, type AuthManager } from "../../src/auth.js";
import type { ServerState } from "../../src/state.js";

const log = pino({ name: "test" });
import {
  createRequest,
  createNotification,
  IDENTIFY_METHOD,
  NODE_SEND_MESSAGE_METHOD,
  NODE_STREAM_EVENT_METHOD,
  type JsonRpcRequest,
  type NodeStreamEventParams,
} from "@cc-hub/shared";

const TEST_PORT = 18766;

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

describe("Mode B relay", () => {
  let state: ServerState;
  let router: Router;
  let auth: AuthManager;
  let server: WsServerHandle;
  let testToken: string;
  let streamLog: NodeStreamEventParams[];

  beforeEach(async () => {
    state = { channels: [], machines: [] };
    router = createRouter(state, () => {});
    auth = createAuthManager(state, () => {});
    streamLog = [];

    testToken = auth.generateToken();
    state.machines.push({ token: testToken, pairedAt: new Date().toISOString() });

    server = createWebSocketServer(TEST_PORT, router, auth, log, {
      onCcReply() {},
      onPluginConnecting() { return true; },
      onPluginConnected() {},
      onPluginDisconnected() {},
      onNodeAgentDisconnected() {},
      onNodeAgentReconnected() {},
      onStreamEvent(event) {
        streamLog.push(event);
      },
    });
  });

  afterEach(() => {
    server.close();
  });

  async function connectNodeAgent(): Promise<WebSocket> {
    const ws = await connectClient();
    ws.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "node-agent",
            token: testToken,
            shortId: "na01",
            hostname: "test-machine",
          },
          1,
        ),
      ),
    );
    await waitForMessage(ws); // auth.identified
    return ws;
  }

  it("routes send_message to node-agent", async () => {
    const ws = await connectNodeAgent();

    // Set up channel mapping
    router.resolveChannel("/home/user/proj");
    router.setDiscordChannelId("proj", "discord-123");

    const msgPromise = waitForMessage(ws);
    server.sendToNodeSession("proj", "testuser", "hello", "/home/user/proj");

    const msg = (await msgPromise) as JsonRpcRequest;
    expect(msg.method).toBe(NODE_SEND_MESSAGE_METHOD);
    expect((msg.params as { text: string }).text).toBe("hello");
    expect((msg.params as { shortId: string }).shortId).toBe("/home/user/proj");

    ws.close();
  });

  it("receives stream events from node-agent", async () => {
    const ws = await connectNodeAgent();

    // Send text event
    ws.send(
      JSON.stringify(
        createNotification(NODE_STREAM_EVENT_METHOD, {
          shortId: "s1",
          channelName: "proj",
          eventType: "text",
          text: "Hello from Claude",
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(streamLog).toHaveLength(1);
    expect(streamLog[0].eventType).toBe("text");
    expect(streamLog[0].text).toBe("Hello from Claude");

    ws.close();
  });

  it("receives tool call events", async () => {
    const ws = await connectNodeAgent();

    ws.send(
      JSON.stringify(
        createNotification(NODE_STREAM_EVENT_METHOD, {
          shortId: "s1",
          channelName: "proj",
          eventType: "tool_call",
          toolName: "Bash",
          toolInput: { command: "npm test" },
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(streamLog).toHaveLength(1);
    expect(streamLog[0].toolName).toBe("Bash");

    ws.close();
  });

  it("receives session_end event", async () => {
    const ws = await connectNodeAgent();

    ws.send(
      JSON.stringify(
        createNotification(NODE_STREAM_EVENT_METHOD, {
          shortId: "s1",
          channelName: "proj",
          eventType: "session_end",
        }),
      ),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(streamLog).toHaveLength(1);
    expect(streamLog[0].eventType).toBe("session_end");

    ws.close();
  });

  it("rejects cc-plugin when node-agent prompt is active", async () => {
    // Connect node-agent
    const agentWs = await connectNodeAgent();

    // Simulate busy channel by having onPluginConnecting check a condition
    // In the real server, busyChannels tracks this. Here we test the ws-server's
    // onPluginConnecting callback
    let channelBusy = true;
    server.close();

    server = createWebSocketServer(TEST_PORT, router, auth, log, {
      onCcReply() {},
      onPluginConnecting(_shortId, _channelName) {
        return !channelBusy;
      },
      onPluginConnected() {},
      onPluginDisconnected() {},
      onNodeAgentDisconnected() {},
      onNodeAgentReconnected() {},
      onStreamEvent() {},
    });

    // Set up channel
    router.resolveChannel("/home/user/proj");

    // Try to connect cc-plugin — should be rejected
    const pluginWs = await connectClient();
    const response = waitForMessage(pluginWs);
    pluginWs.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: testToken,
            shortId: "p1",
            projectPath: "/home/user/proj",
          },
          1,
        ),
      ),
    );

    const msg = (await response) as { error?: { message: string } };
    expect(msg.error).toBeDefined();
    expect(msg.error!.message).toContain("already has an active session");

    agentWs.close();
    pluginWs.close();
  });

  it("streams multiple events in sequence", async () => {
    const ws = await connectNodeAgent();

    const events: Partial<NodeStreamEventParams>[] = [
      { eventType: "text", text: "Let me check..." },
      { eventType: "tool_call", toolName: "Bash", toolInput: { command: "ls" } },
      { eventType: "tool_result", toolResult: "file1.ts\nfile2.ts" },
      { eventType: "text", text: "Here are the files." },
      { eventType: "session_end" },
    ];

    for (const event of events) {
      ws.send(
        JSON.stringify(
          createNotification(NODE_STREAM_EVENT_METHOD, {
            shortId: "s1",
            channelName: "proj",
            ...event,
          }),
        ),
      );
    }

    await new Promise((r) => setTimeout(r, 100));

    expect(streamLog).toHaveLength(5);
    expect(streamLog.map((e) => e.eventType)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "text",
      "session_end",
    ]);

    ws.close();
  });
});
