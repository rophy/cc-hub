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

export interface WsServerHandle {
  close(): void;
  /** Send a user message to all plugins in a channel */
  sendToChannel(channelName: string, from: string, text: string, messageId?: string): void;
}

export function createWebSocketServer(port: number, router: Router): WsServerHandle {
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
        // Emit disconnect event — Discord bot can post status message
        onPluginDisconnect?.(info.shortId, info.channelName);
      }
      router.removeNodeAgent(ws);
    });
  });

  let onPluginDisconnect: ((shortId: string, channelName: string) => void) | undefined;

  function handleMessage(
    ws: WebSocket,
    msg: JsonRpcRequest | JsonRpcNotification,
    identified: boolean,
    markIdentified: () => void,
  ): void {
    if ("method" in msg && msg.method === IDENTIFY_METHOD && "id" in msg) {
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

    if (!identified) {
      return; // ignore messages before identify
    }

    if ("method" in msg && msg.method === CC_REPLY_METHOD) {
      const result = CcReplyParamsSchema.safeParse(msg.params);
      if (!result.success) return;

      // Find which plugin sent this
      const plugin = Array.from(
        router.getPluginsForChannel("") // we need to find by ws
      ).find(() => false); // placeholder — need to look up by ws

      // Look through all channels to find this plugin
      onCcReply?.(ws, result.data.text, result.data.files);
    }
  }

  let onCcReply:
    | ((ws: WebSocket, text: string, files?: string[]) => void)
    | undefined;

  return {
    close() {
      wss.close();
    },
    sendToChannel(channelName, from, text, messageId) {
      const plugins = router.getPluginsForChannel(channelName);
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
