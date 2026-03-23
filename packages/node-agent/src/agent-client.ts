import WebSocket from "ws";
import {
  createRequest,
  createNotification,
  createResponse,
  IDENTIFY_METHOD,
  NODE_HEARTBEAT_METHOD,
  NODE_START_SESSION_METHOD,
  NODE_STOP_SESSION_METHOD,
  NODE_SEND_MESSAGE_METHOD,
  NODE_STREAM_EVENT_METHOD,
  NodeStartSessionParamsSchema,
  NodeStopSessionParamsSchema,
  NodeSendMessageParamsSchema,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type NodeStreamEventParams,
} from "@cc-hub/shared";

export interface AgentClientOptions {
  serverUrl: string;
  token: string;
  shortId: string;
  hostname: string;
  onStartSession: (
    projectPath: string,
    prompt: string,
    channelName: string,
  ) => Promise<{ ok: boolean; shortId?: string; error?: string }>;
  onStopSession: (shortId: string) => Promise<{ ok: boolean; error?: string }>;
  onSendMessage: (
    shortId: string,
    text: string,
    from: string,
  ) => Promise<{ ok: boolean; error?: string }>;
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
        parsed.data.channelName,
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

    if (request.method === NODE_SEND_MESSAGE_METHOD) {
      const parsed = NodeSendMessageParamsSchema.safeParse(request.params);
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
      const result = await options.onSendMessage(
        parsed.data.shortId,
        parsed.data.text,
        parsed.data.from,
      );
      ws?.send(JSON.stringify(createResponse(request.id, result)));
    }
  }

  function sendStreamEvent(event: NodeStreamEventParams): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = createNotification(NODE_STREAM_EVENT_METHOD, event);
    ws.send(JSON.stringify(msg));
  }

  function sendHeartbeat(activeSessions: string[]): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = createNotification(NODE_HEARTBEAT_METHOD, { activeSessions });
    ws.send(JSON.stringify(msg));
  }

  return { connect, sendStreamEvent, sendHeartbeat };
}
