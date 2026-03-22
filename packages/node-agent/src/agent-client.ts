import WebSocket from "ws";
import {
  createRequest,
  createNotification,
  createResponse,
  IDENTIFY_METHOD,
  NODE_HEARTBEAT_METHOD,
  NODE_START_SESSION_METHOD,
  NODE_STOP_SESSION_METHOD,
  NodeStartSessionParamsSchema,
  NodeStopSessionParamsSchema,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "@cc-hub/shared";

export interface AgentClientOptions {
  serverUrl: string;
  token: string;
  shortId: string;
  hostname: string;
  onStartSession: (projectPath: string, prompt?: string) => Promise<{ ok: boolean; error?: string }>;
  onStopSession: (shortId: string) => Promise<{ ok: boolean; error?: string }>;
}

export function createAgentClient(options: AgentClientOptions) {
  let ws: WebSocket | null = null;
  let requestId = 0;

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
            clientType: "node-agent",
            token: options.token,
            shortId: options.shortId,
            hostname: options.hostname,
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

      ws.on("error", reject);

      ws.on("close", () => {
        setTimeout(() => {
          connect().catch(() => {});
        }, 5000);
      });
    });
  }

  async function handleMessage(msg: JsonRpcMessage): Promise<void> {
    if (!("method" in msg) || !("id" in msg)) return;

    const request = msg as JsonRpcRequest;

    if (request.method === NODE_START_SESSION_METHOD) {
      const parsed = NodeStartSessionParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        ws?.send(
          JSON.stringify(
            createResponse(request.id, undefined, {
              code: -1,
              message: "Invalid params",
            }),
          ),
        );
        return;
      }
      const result = await options.onStartSession(
        parsed.data.projectPath,
        parsed.data.prompt,
      );
      ws?.send(JSON.stringify(createResponse(request.id, result)));
    }

    if (request.method === NODE_STOP_SESSION_METHOD) {
      const parsed = NodeStopSessionParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        ws?.send(
          JSON.stringify(
            createResponse(request.id, undefined, {
              code: -1,
              message: "Invalid params",
            }),
          ),
        );
        return;
      }
      const result = await options.onStopSession(parsed.data.shortId);
      ws?.send(JSON.stringify(createResponse(request.id, result)));
    }
  }

  function sendHeartbeat(activeSessions: string[]): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = createNotification(NODE_HEARTBEAT_METHOD, { activeSessions });
    ws.send(JSON.stringify(msg));
  }

  return { connect, sendHeartbeat };
}
