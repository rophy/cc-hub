import WebSocket from "ws";
import {
  createRequest,
  createNotification,
  IDENTIFY_METHOD,
  CC_REPLY_METHOD,
  CC_MESSAGE_METHOD,
  type JsonRpcMessage,
  type CcMessageParams,
} from "@cc-hub/shared";
import { CcMessageParamsSchema } from "@cc-hub/shared";

export interface BridgeClientOptions {
  serverUrl: string;
  token: string;
  shortId: string;
  projectPath: string;
  onMessage: (from: string, text: string, messageId?: string) => Promise<void>;
}

export function createBridgeClient(options: BridgeClientOptions) {
  let ws: WebSocket | null = null;
  let requestId = 0;

  function nextId(): number {
    return ++requestId;
  }

  async function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(options.serverUrl);

      ws.on("open", () => {
        // Send identify message
        const msg = createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: options.token,
            shortId: options.shortId,
            projectPath: options.projectPath,
          },
          nextId(),
        );
        ws!.send(JSON.stringify(msg));
        resolve();
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as JsonRpcMessage;
          handleMessage(msg);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("error", (err) => {
        reject(err);
      });

      ws.on("close", () => {
        // Auto-reconnect after delay
        setTimeout(() => {
          connect().catch(() => {});
        }, 5000);
      });
    });
  }

  function handleMessage(msg: JsonRpcMessage): void {
    if ("method" in msg && msg.method === CC_MESSAGE_METHOD) {
      const params = CcMessageParamsSchema.parse(msg.params);
      options.onMessage(params.from, params.text, params.messageId);
    }
  }

  async function sendReply(text: string, files?: string[]): Promise<void> {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to server");
    }
    const msg = createNotification(CC_REPLY_METHOD, { text, files });
    ws.send(JSON.stringify(msg));
  }

  return { connect, sendReply };
}
