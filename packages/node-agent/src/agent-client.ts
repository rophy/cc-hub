import WebSocket from "ws";
import {
  createRequest,
  createNotification,
  createResponse,
  IDENTIFY_METHOD,
  NODE_HEARTBEAT_METHOD,
  NODE_SEND_MESSAGE_METHOD,
  NodeSendMessageParamsSchema,
  NODE_STREAM_EVENT_METHOD,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type NodeStreamEventParams,
} from "@cc-hub/shared";

export interface AgentClientOptions {
  serverUrl: string;
  token: string;
  shortId: string;
  hostname: string;
  onRunPrompt: (
    projectPath: string,
    prompt: string,
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
          // ignore
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

    // Server asks node-agent to run a prompt (either new session or follow-up)
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

      // shortId carries the projectPath for Mode B
      const projectPath = parsed.data.shortId;
      const result = await options.onRunPrompt(
        projectPath,
        parsed.data.text,
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
