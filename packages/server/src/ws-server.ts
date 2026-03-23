import { WebSocketServer, WebSocket } from "ws";
import {
  IDENTIFY_METHOD,
  CC_REPLY_METHOD,
  NODE_STREAM_EVENT_METHOD,
  NODE_SEND_MESSAGE_METHOD,
  IdentifyParamsSchema,
  CcReplyParamsSchema,
  NodeStreamEventParamsSchema,
  createResponse,
  createRequest,
  CC_MESSAGE_METHOD,
  type JsonRpcRequest,
  type JsonRpcNotification,
  type NodeStreamEventParams,
} from "@cc-hub/shared";
import type { Router } from "./router.js";
import type { AuthManager } from "./auth.js";

export interface WsServerEvents {
  /** Called when a cc-plugin sends a reply (Mode A) */
  onCcReply(shortId: string, channelName: string, text: string, files?: string[]): void;
  /** Called when a cc-plugin wants to connect. Return false to reject. */
  onPluginConnecting(shortId: string, channelName: string): boolean;
  /** Called when a cc-plugin connects successfully */
  onPluginConnected(shortId: string, channelName: string): void;
  /** Called when a cc-plugin disconnects */
  onPluginDisconnected(shortId: string, channelName: string): void;
  /** Called when a node-agent disconnects */
  onNodeAgentDisconnected(shortId: string): void;
  /** Called when a node-agent reconnects, with its current busy channels */
  onNodeAgentReconnected(shortId: string, agentBusyChannels: string[]): void;
  /** Called when a node-agent streams an event (Mode B) */
  onStreamEvent(event: NodeStreamEventParams): void;
}

export interface WsServerHandle {
  close(): void;
  /** Send a user message to all plugins in a channel, or a specific one (Mode A) */
  sendToChannel(
    channelName: string,
    from: string,
    text: string,
    messageId?: string,
    targetShortId?: string,
  ): void;
  /** Send a message to a node-agent for headless execution (Mode B) */
  sendToNodeSession(
    channelName: string,
    from: string,
    text: string,
    projectPath: string,
  ): void;
}

export function createWebSocketServer(
  port: number,
  router: Router,
  auth: AuthManager,
  events: WsServerEvents,
): WsServerHandle {
  const wss = new WebSocketServer({ port });
  let requestIdCounter = 0;

  wss.on("connection", (ws) => {
    let identified = false;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg, identified, () => {
          identified = true;
        });
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      const info = router.onPluginDisconnect(ws);
      if (info) {
        events.onPluginDisconnected(info.shortId, info.channelName);
      }
      // Check if this was a node-agent
      const agents = router.getNodeAgents();
      const agentBefore = agents.find((a) => a.ws === ws);
      if (agentBefore) {
        events.onNodeAgentDisconnected(agentBefore.shortId);
      }
      router.removeNodeAgent(ws);
    });
  });

  function handleMessage(
    ws: WebSocket,
    msg: JsonRpcRequest | JsonRpcNotification,
    identified: boolean,
    markIdentified: () => void,
  ): void {
    if (!("method" in msg)) return;

    // Identify must come first
    if (msg.method === IDENTIFY_METHOD && "id" in msg) {
      const result = IdentifyParamsSchema.safeParse(msg.params);
      if (!result.success) {
        ws.send(
          JSON.stringify(
            createResponse(msg.id, undefined, {
              code: -1,
              message: "Invalid identify params",
            }),
          ),
        );
        return;
      }

      const params = result.data;

      // Validate token
      if (!params.token || !auth.validateToken(params.token)) {
        // Start pairing flow
        const { code, tokenPromise } = auth.startPairing();
        // Send pairing code to client
        ws.send(
          JSON.stringify(
            createResponse(msg.id, {
              ok: false,
              needsPairing: true,
              pairingCode: code,
            }),
          ),
        );

        // When pairing completes, send the token and register
        tokenPromise
          .then((token) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            // Send token to client for storage
            ws.send(
              JSON.stringify(
                createRequest("auth.paired", { token }, ++requestIdCounter),
              ),
            );
            // Now register the client
            registerClient(ws, params, markIdentified);
          })
          .catch(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(
              JSON.stringify(
                createResponse(null, undefined, {
                  code: -2,
                  message: "Pairing expired or rejected",
                }),
              ),
            );
          });

        return;
      }

      // Token is valid — register immediately
      registerClient(ws, params, markIdentified);
      return;
    }

    if (!identified) return;

    // Handle cc.reply from plugin (Mode A)
    if (msg.method === CC_REPLY_METHOD) {
      const result = CcReplyParamsSchema.safeParse(msg.params);
      if (!result.success) return;

      const plugin = router.getPluginByWs(ws);
      if (!plugin) return;

      events.onCcReply(
        plugin.shortId,
        plugin.channelName,
        result.data.text,
        result.data.files,
      );
    }

    // Handle node.stream_event from node-agent (Mode B)
    if (msg.method === NODE_STREAM_EVENT_METHOD) {
      const result = NodeStreamEventParamsSchema.safeParse(msg.params);
      if (!result.success) return;

      events.onStreamEvent(result.data);
    }
  }

  function registerClient(
    ws: WebSocket,
    params: { clientType: string; shortId: string; projectPath?: string; hostname?: string; busyChannels?: string[] },
    markIdentified: () => void,
  ): void {
    if (params.clientType === "cc-plugin") {
      const channelName = router.resolveChannel(params.projectPath || process.cwd());

      // Single session enforcement
      if (!events.onPluginConnecting(params.shortId, channelName)) {
        ws.send(
          JSON.stringify(
            createResponse(0, undefined, {
              code: -3,
              message: `Channel "${channelName}" already has an active session`,
            }),
          ),
        );
        ws.close();
        return;
      }

      router.addPlugin({
        ws,
        shortId: params.shortId,
        projectPath: params.projectPath || "",
        channelName,
      });
      ws.send(
        JSON.stringify(
          createRequest("auth.identified", { ok: true, channel: channelName }, ++requestIdCounter),
        ),
      );
      events.onPluginConnected(params.shortId, channelName);
    } else if (params.clientType === "node-agent") {
      router.addNodeAgent({
        ws,
        shortId: params.shortId,
        hostname: params.hostname,
      });
      events.onNodeAgentReconnected(params.shortId, params.busyChannels || []);
      ws.send(
        JSON.stringify(
          createRequest("auth.identified", { ok: true }, ++requestIdCounter),
        ),
      );
    }
    markIdentified();
  }

  return {
    close() {
      wss.close();
    },
    sendToChannel(channelName, from, text, messageId, targetShortId) {
      let plugins = router.getPluginsForChannel(channelName);
      if (targetShortId) {
        plugins = plugins.filter((p) => p.shortId === targetShortId);
      }
      for (const plugin of plugins) {
        const msg = createRequest(
          CC_MESSAGE_METHOD,
          { from, text, messageId },
          ++requestIdCounter,
        );
        plugin.ws.send(JSON.stringify(msg));
      }
    },
    sendToNodeSession(channelName, from, text, projectPath) {
      const agents = router.getNodeAgents();
      if (agents.length === 0) return;

      // Send to first available node-agent
      const agent = agents[0];
      const msg = createRequest(
        NODE_SEND_MESSAGE_METHOD,
        { shortId: projectPath, text, from },
        ++requestIdCounter,
      );
      agent.ws.send(JSON.stringify(msg));
    },
  };
}
