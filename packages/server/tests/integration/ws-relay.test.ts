import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { createWebSocketServer, type WsServerHandle } from "../../src/ws-server.js";
import { createRouter, type Router } from "../../src/router.js";
import { createAuthManager, type AuthManager } from "../../src/auth.js";
import type { ServerState } from "../../src/state.js";
import {
  createRequest,
  createNotification,
  IDENTIFY_METHOD,
  CC_MESSAGE_METHOD,
  CC_REPLY_METHOD,
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
  let auth: AuthManager;
  let server: WsServerHandle;
  let testToken: string;
  let replyLog: { shortId: string; channelName: string; text: string }[];
  let connectLog: { shortId: string; channelName: string }[];
  let disconnectLog: { shortId: string; channelName: string }[];

  beforeEach(async () => {
    state = { channels: [], machines: [] };
    router = createRouter(state, () => {});
    auth = createAuthManager(state, () => {});
    replyLog = [];
    connectLog = [];
    disconnectLog = [];

    // Pre-generate a valid token for tests
    testToken = auth.generateToken();
    state.machines.push({ token: testToken, pairedAt: new Date().toISOString() });

    server = createWebSocketServer(TEST_PORT, router, auth, {
      onCcReply(shortId, channelName, text) {
        replyLog.push({ shortId, channelName, text });
      },
      onPluginConnecting() {
        return true; // Allow all in tests
      },
      onPluginConnected(shortId, channelName) {
        connectLog.push({ shortId, channelName });
      },
      onPluginDisconnected(shortId, channelName) {
        disconnectLog.push({ shortId, channelName });
      },
      onStreamEvent() {},
    });
  });

  afterEach(() => {
    server.close();
  });

  function identifyMsg(shortId: string, projectPath: string, id: number, token?: string) {
    return createRequest(
      IDENTIFY_METHOD,
      {
        clientType: "cc-plugin",
        token: token ?? testToken,
        shortId,
        projectPath,
      },
      id,
    );
  }

  it("accepts cc-plugin identify with valid token", async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify(identifyMsg("a3f7", "/home/user/my-project", 1)));

    const response = (await msgPromise) as JsonRpcRequest;
    expect(response.method).toBe("auth.identified");
    expect((response.params as { ok: boolean }).ok).toBe(true);
    expect((response.params as { channel: string }).channel).toBe("my-project");
    expect(connectLog).toHaveLength(1);

    ws.close();
  });

  it("triggers pairing for invalid token", async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify(identifyMsg("a3f7", "/home/user/proj", 1, "bad-token")));

    const response = (await msgPromise) as { result?: { needsPairing: boolean; pairingCode: string } };
    expect(response.result?.needsPairing).toBe(true);
    expect(response.result?.pairingCode).toMatch(/^[0-9A-F]{4}$/);

    ws.close();
  });

  it("completes pairing flow and registers plugin", async () => {
    const ws = await connectClient();
    const pairingResponse = waitForMessage(ws);

    ws.send(JSON.stringify(identifyMsg("a3f7", "/home/user/proj", 1, "")));

    const resp = (await pairingResponse) as { result?: { pairingCode: string } };
    const code = resp.result!.pairingCode;

    // Collect the next two messages (auth.paired + auth.identified)
    const messages: unknown[] = [];
    const allReceived = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 2) resolve();
      });
    });

    // Confirm pairing (simulates Discord !pair command)
    auth.confirmPairing(code);
    await allReceived;

    const paired = messages[0] as JsonRpcRequest;
    expect(paired.method).toBe("auth.paired");
    expect((paired.params as { token: string }).token).toBeTruthy();

    const identified = messages[1] as JsonRpcRequest;
    expect(identified.method).toBe("auth.identified");
    expect((identified.params as { ok: boolean }).ok).toBe(true);

    ws.close();
  });

  it("rejects invalid identify params", async () => {
    const ws = await connectClient();
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify(createRequest(IDENTIFY_METHOD, { invalid: true }, 1)));

    const response = (await msgPromise) as { error?: { message: string } };
    expect(response.error).toBeDefined();

    ws.close();
  });

  it("routes messages from server to plugin", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify(identifyMsg("a3f7", "/home/user/proj", 1)));
    await waitForMessage(ws); // auth.identified

    const msgPromise = waitForMessage(ws);
    server.sendToChannel("proj", "testuser", "hello from discord");

    const msg = (await msgPromise) as JsonRpcRequest;
    expect(msg.method).toBe(CC_MESSAGE_METHOD);
    expect((msg.params as { text: string }).text).toBe("hello from discord");

    ws.close();
  });

  it("routes replies from plugin to server events", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify(identifyMsg("b2c1", "/home/user/proj", 1)));
    await waitForMessage(ws); // auth.identified

    ws.send(JSON.stringify(createNotification(CC_REPLY_METHOD, { text: "I found the bug" })));

    await new Promise((r) => setTimeout(r, 50));

    expect(replyLog).toHaveLength(1);
    expect(replyLog[0].shortId).toBe("b2c1");
    expect(replyLog[0].text).toBe("I found the bug");

    ws.close();
  });

  it("targets specific plugin with shortId", async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    ws1.send(JSON.stringify(identifyMsg("aaaa", "/home/user/proj", 1)));
    await waitForMessage(ws1);

    ws2.send(JSON.stringify(identifyMsg("bbbb", "/home/user/proj", 2)));
    await waitForMessage(ws2);

    const msg1Promise = waitForMessage(ws1);
    let ws2Received = false;
    ws2.on("message", () => { ws2Received = true; });

    server.sendToChannel("proj", "user", "targeted msg", undefined, "aaaa");

    const msg1 = (await msg1Promise) as JsonRpcRequest;
    expect((msg1.params as { text: string }).text).toBe("targeted msg");

    await new Promise((r) => setTimeout(r, 50));
    expect(ws2Received).toBe(false);

    ws1.close();
    ws2.close();
  });

  it("emits disconnect event when plugin closes", async () => {
    const ws = await connectClient();
    ws.send(JSON.stringify(identifyMsg("c3d4", "/home/user/proj", 1)));
    await waitForMessage(ws);

    disconnectLog.length = 0;
    ws.close();

    await new Promise((r) => setTimeout(r, 50));

    expect(disconnectLog).toHaveLength(1);
    expect(disconnectLog[0].shortId).toBe("c3d4");
  });

  it("broadcasts to all plugins when no target specified", async () => {
    const ws1 = await connectClient();
    const ws2 = await connectClient();

    ws1.send(JSON.stringify(identifyMsg("aaaa", "/home/user/proj", 1)));
    await waitForMessage(ws1);

    ws2.send(JSON.stringify(identifyMsg("bbbb", "/home/user/proj", 2)));
    await waitForMessage(ws2);

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
