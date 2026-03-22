import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { createWebSocketServer, type WsServerHandle } from "../../src/ws-server.js";
import { createRouter, type Router } from "../../src/router.js";
import type { ServerState } from "../../src/state.js";
import {
  createRequest,
  createNotification,
  IDENTIFY_METHOD,
  CC_MESSAGE_METHOD,
  CC_REPLY_METHOD,
  type JsonRpcResponse,
  type JsonRpcRequest,
} from "@cc-hub/shared";

const TEST_PORT = 18765;

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

describe("WebSocket relay", () => {
  let state: ServerState;
  let router: Router;
  let server: WsServerHandle;
  let replyLog: { shortId: string; channelName: string; text: string }[];
  let connectLog: { shortId: string; channelName: string }[];
  let disconnectLog: { shortId: string; channelName: string }[];

  beforeEach(async () => {
    state = { channels: [], machines: [] };
    router = createRouter(state, () => {});
    replyLog = [];
    connectLog = [];
    disconnectLog = [];

    server = createWebSocketServer(TEST_PORT, router, {
      onCcReply(shortId, channelName, text) {
        replyLog.push({ shortId, channelName, text });
      },
      onPluginConnected(shortId, channelName) {
        connectLog.push({ shortId, channelName });
      },
      onPluginDisconnected(shortId, channelName) {
        disconnectLog.push({ shortId, channelName });
      },
    });
  });

  afterEach(() => {
    server.close();
  });

  it("accepts cc-plugin identify and assigns channel", async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    ws.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "test-token",
            shortId: "a3f7",
            projectPath: "/home/user/my-project",
          },
          1,
        ),
      ),
    );

    const response = (await msgPromise) as JsonRpcResponse;
    expect(response.result).toEqual({ ok: true, channel: "my-project" });
    expect(connectLog).toHaveLength(1);
    expect(connectLog[0].shortId).toBe("a3f7");

    ws.close();
  });

  it("rejects invalid identify params", async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    ws.send(
      JSON.stringify(
        createRequest(IDENTIFY_METHOD, { invalid: true }, 1),
      ),
    );

    const response = (await msgPromise) as JsonRpcResponse;
    expect(response.error).toBeDefined();
    expect(response.error!.message).toContain("Invalid");

    ws.close();
  });

  it("routes messages from server to plugin", async () => {
    const ws = await connectClient();

    // Identify first
    const identifyPromise = waitForMessage(ws);
    ws.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "test-token",
            shortId: "a3f7",
            projectPath: "/home/user/proj",
          },
          1,
        ),
      ),
    );
    await identifyPromise;

    // Send a message to the channel
    const msgPromise = waitForMessage(ws);
    server.sendToChannel("proj", "testuser", "hello from discord");

    const msg = (await msgPromise) as JsonRpcRequest;
    expect(msg.method).toBe(CC_MESSAGE_METHOD);
    expect((msg.params as { from: string }).from).toBe("testuser");
    expect((msg.params as { text: string }).text).toBe("hello from discord");

    ws.close();
  });

  it("routes replies from plugin to server events", async () => {
    const ws = await connectClient();

    // Identify
    const identifyPromise = waitForMessage(ws);
    ws.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "test-token",
            shortId: "b2c1",
            projectPath: "/home/user/proj",
          },
          1,
        ),
      ),
    );
    await identifyPromise;

    // Send a reply
    ws.send(
      JSON.stringify(
        createNotification(CC_REPLY_METHOD, {
          text: "I found the bug",
        }),
      ),
    );

    // Wait for event processing
    await new Promise((r) => setTimeout(r, 50));

    expect(replyLog).toHaveLength(1);
    expect(replyLog[0].shortId).toBe("b2c1");
    expect(replyLog[0].channelName).toBe("proj");
    expect(replyLog[0].text).toBe("I found the bug");

    ws.close();
  });

  it("targets specific plugin with @shortId", async () => {
    // Connect two plugins to the same channel
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    const id1Promise = waitForMessage(ws1);
    ws1.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "t1",
            shortId: "aaaa",
            projectPath: "/home/user/proj",
          },
          1,
        ),
      ),
    );
    await id1Promise;

    const id2Promise = waitForMessage(ws2);
    ws2.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "t2",
            shortId: "bbbb",
            projectPath: "/home/user/proj",
          },
          2,
        ),
      ),
    );
    await id2Promise;

    // Send targeted message to aaaa only
    const msg1Promise = waitForMessage(ws1);
    let ws2Received = false;
    ws2.on("message", () => {
      ws2Received = true;
    });

    server.sendToChannel("proj", "user", "targeted msg", undefined, "aaaa");

    const msg1 = (await msg1Promise) as JsonRpcRequest;
    expect((msg1.params as { text: string }).text).toBe("targeted msg");

    // Give ws2 time to receive (it shouldn't)
    await new Promise((r) => setTimeout(r, 50));
    expect(ws2Received).toBe(false);

    ws1.close();
    ws2.close();
  });

  it("emits disconnect event when plugin closes", async () => {
    const ws = await connectClient();

    const identifyPromise = waitForMessage(ws);
    ws.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "test",
            shortId: "c3d4",
            projectPath: "/home/user/proj",
          },
          1,
        ),
      ),
    );
    await identifyPromise;

    // Clear any stale disconnects from previous tests
    disconnectLog.length = 0;

    ws.close();

    // Wait for close event
    await new Promise((r) => setTimeout(r, 50));

    expect(disconnectLog).toHaveLength(1);
    expect(disconnectLog[0].shortId).toBe("c3d4");
  });

  it("broadcasts to all plugins when no target specified", async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    const id1Promise = waitForMessage(ws1);
    ws1.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "t1",
            shortId: "aaaa",
            projectPath: "/home/user/proj",
          },
          1,
        ),
      ),
    );
    await id1Promise;

    const id2Promise = waitForMessage(ws2);
    ws2.send(
      JSON.stringify(
        createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: "t2",
            shortId: "bbbb",
            projectPath: "/home/user/proj",
          },
          2,
        ),
      ),
    );
    await id2Promise;

    // Broadcast (no target)
    const msg1Promise = waitForMessage(ws1);
    const msg2Promise = waitForMessage(ws2);
    server.sendToChannel("proj", "user", "broadcast msg");

    const msg1 = (await msg1Promise) as JsonRpcRequest;
    const msg2 = (await msg2Promise) as JsonRpcRequest;
    expect((msg1.params as { text: string }).text).toBe("broadcast msg");
    expect((msg2.params as { text: string }).text).toBe("broadcast msg");

    ws1.close();
    ws2.close();
  });
});
