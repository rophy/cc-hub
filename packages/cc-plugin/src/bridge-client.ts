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
import type { Logger } from "pino";

export interface BridgeClientOptions {
  serverUrl: string;
  token: string;
  shortId: string;
  projectPath: string;
  log: Logger;
  onMessage: (from: string, text: string, messageId?: string) => Promise<void>;
}

export function createBridgeClient(options: BridgeClientOptions) {
  const log = options.log;
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
          log.info({ pairingCode: result.pairingCode }, "pairing required — ask someone to run /pair in Discord");
          // Also write to stderr so user sees it in terminal during initial setup
          process.stderr.write(
            `\n[cc-hub] Pairing required. Ask someone to run in Discord:\n` +
            `  !pair ${result.pairingCode}\n` +
            `Waiting for approval...\n\n`,
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
      log.info("paired successfully, token saved");
    }

    // Server confirms registration
    if (request.method === "auth.identified") {
      const params = request.params as { ok: boolean; channel?: string };
      if (params.ok) {
        if (params.channel) {
          log.info({ channel: params.channel }, "connected to channel");
        }
        onReady();
      }
    }

    // User message from chat platform
    if (request.method === CC_MESSAGE_METHOD) {
      const parsed = CcMessageParamsSchema.safeParse(request.params);
      if (parsed.success) {
        log.info({ from: parsed.data.from, text: parsed.data.text.slice(0, 100) }, "received message");
        options.onMessage(parsed.data.from, parsed.data.text, parsed.data.messageId)
          .then(() => log.debug("MCP notification sent"))
          .catch((err) => log.error({ err }, "MCP notification failed"));
      } else {
        log.error({ error: parsed.error }, "failed to parse message");
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
