import { WebSocketServer, WebSocket } from "ws";
import {
  IDENTIFY_METHOD,
  CC_REPLY_METHOD,
  IdentifyParamsSchema,
  CcReplyParamsSchema,
  createResponse,
  createRequest,
  CC_MESSAGE_METHOD,
  type JsonRpcRequest,
  type JsonRpcNotification,
} from "@cc-hub/shared";
import type { Router } from "./router.js";

export interface WsServerEvents {
  /** Called when a cc-plugin sends a reply */
  onCcReply(shortId: string, channelName: string, text: string, files?: string[]): void;
  /** Called when a cc-plugin connects */
  onPluginConnected(shortId: string, channelName: string): void;
  /** Called when a cc-plugin disconnects */
  onPluginDisconnected(shortId: string, channelName: string): void;
}

export interface WsServerHandle {
  close(): void;
  /** Send a user message to all plugins in a channel, or a specific one */
  sendToChannel(
    channelName: string,
    from: string,
    text: string,
    messageId?: string,
    targetShortId?: string,
  ): void;
}

export function createWebSocketServer(
  port: number,
  router: Router,
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

      if (params.clientType === "cc-plugin") {
        const channelName = router.resolveChannel(params.projectPath || process.cwd());
        router.addPlugin({
          ws,
          shortId: params.shortId,
          projectPath: params.projectPath || "",
          channelName,
        });
        ws.send(
          JSON.stringify(createResponse(msg.id, { ok: true, channel: channelName })),
        );
        events.onPluginConnected(params.shortId, channelName);
      } else if (params.clientType === "node-agent") {
        router.addNodeAgent({
          ws,
          shortId: params.shortId,
          hostname: params.hostname,
        });
        ws.send(JSON.stringify(createResponse(msg.id, { ok: true })));
      }

      markIdentified();
      return;
    }

    if (!identified) return;

    // Handle cc.reply from plugin
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
  };
}
