import WebSocket from "ws";
import {
  createRequest,
  createNotification,
  IDENTIFY_METHOD,
  CC_REPLY_METHOD,
  CC_MESSAGE_METHOD,
  CcMessageParamsSchema,
  saveClientConfig,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "@cc-hub/shared";

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
  let currentToken = options.token;

  function nextId(): number {
    return ++requestId;
  }

  async function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(options.serverUrl);

      ws.on("open", () => {
        const msg = createRequest(
          IDENTIFY_METHOD,
          {
            clientType: "cc-plugin",
            token: currentToken,
            shortId: options.shortId,
            projectPath: options.projectPath,
          },
          nextId(),
        );
        ws!.send(JSON.stringify(msg));
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as JsonRpcMessage;
          handleMessage(msg, resolve);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("error", (err) => {
        reject(err);
      });

      ws.on("close", () => {
        setTimeout(() => {
          connect().catch(() => {});
        }, 5000);
      });
    });
  }

  function handleMessage(msg: JsonRpcMessage, onReady: () => void): void {
    if (!("method" in msg)) {
      // JSON-RPC response — check if it's pairing needed
      if ("result" in msg) {
        const result = msg.result as { needsPairing?: boolean; pairingCode?: string };
        if (result?.needsPairing && result?.pairingCode) {
          console.error(
            `\n[cc-hub] Pairing required. Ask someone to run in Discord:\n` +
            `  !pair ${result.pairingCode}\n` +
            `Waiting for approval...\n`,
          );
        }
      }
      return;
    }

    const request = msg as JsonRpcRequest;

    // Server sends token after pairing
    if (request.method === "auth.paired") {
      const params = request.params as { token: string };
      currentToken = params.token;
      saveClientConfig({ token: params.token });
      console.error("[cc-hub] Paired successfully. Token saved.");
    }

    // Server confirms registration
    if (request.method === "auth.identified") {
      const params = request.params as { ok: boolean; channel?: string };
      if (params.ok) {
        if (params.channel) {
          console.error(`[cc-hub] Connected to channel: ${params.channel}`);
        }
        onReady();
      }
    }

    // User message from chat platform
    if (request.method === CC_MESSAGE_METHOD) {
      const parsed = CcMessageParamsSchema.safeParse(request.params);
      if (parsed.success) {
        options.onMessage(parsed.data.from, parsed.data.text, parsed.data.messageId);
      }
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
