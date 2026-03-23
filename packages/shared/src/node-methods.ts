import { z } from "zod";

// node.start_session — server → node-agent
// Request to launch a new headless CC session

export const NodeStartSessionParamsSchema = z.object({
  /** Working directory for the CC session */
  projectPath: z.string(),
  /** Initial prompt for CC */
  prompt: z.string(),
  /** Channel name for routing responses */
  channelName: z.string(),
});

export type NodeStartSessionParams = z.infer<typeof NodeStartSessionParamsSchema>;

export const NodeStartSessionResultSchema = z.object({
  ok: z.boolean(),
  /** Short ID assigned to this session */
  shortId: z.string().optional(),
  error: z.string().optional(),
});

export type NodeStartSessionResult = z.infer<typeof NodeStartSessionResultSchema>;

export const NODE_START_SESSION_METHOD = "node.start_session";

// node.send_message — server → node-agent
// Send a follow-up message to an existing headless session

export const NodeSendMessageParamsSchema = z.object({
  /** Short ID of the target session */
  shortId: z.string(),
  /** Message text from the Discord user */
  text: z.string(),
  /** Display name of the sender */
  from: z.string(),
});

export type NodeSendMessageParams = z.infer<typeof NodeSendMessageParamsSchema>;

export const NODE_SEND_MESSAGE_METHOD = "node.send_message";

// node.stream_event — node-agent → server
// Streamed output event from a headless CC session

export const StreamEventType = z.enum([
  "text",
  "tool_call",
  "tool_result",
  "error",
  "session_start",
  "session_end",
]);

export const NodeStreamEventParamsSchema = z.object({
  /** Short ID of the session producing this event */
  shortId: z.string(),
  /** Channel name for routing */
  channelName: z.string(),
  /** Event type */
  eventType: StreamEventType,
  /** Text content (for text, error events) */
  text: z.string().optional(),
  /** Tool name (for tool_call, tool_result events) */
  toolName: z.string().optional(),
  /** Tool input (for tool_call events) */
  toolInput: z.record(z.unknown()).optional(),
  /** Tool result content (for tool_result events) */
  toolResult: z.string().optional(),
  /** CC session ID for --resume */
  sessionId: z.string().optional(),
});

export type NodeStreamEventParams = z.infer<typeof NodeStreamEventParamsSchema>;

export const NODE_STREAM_EVENT_METHOD = "node.stream_event";

// node.stop_session — server → node-agent
// Request to stop a CC session

export const NodeStopSessionParamsSchema = z.object({
  /** Short ID of the session to stop */
  shortId: z.string(),
});

export type NodeStopSessionParams = z.infer<typeof NodeStopSessionParamsSchema>;

export const NODE_STOP_SESSION_METHOD = "node.stop_session";

// node.heartbeat — node-agent → server
// Periodic liveness signal

export const NodeHeartbeatParamsSchema = z.object({
  /** List of active session short IDs on this node */
  activeSessions: z.array(z.string()),
});

export type NodeHeartbeatParams = z.infer<typeof NodeHeartbeatParamsSchema>;

export const NODE_HEARTBEAT_METHOD = "node.heartbeat";

// node.session_status — both directions
// Report or query session state

export const NodeSessionStatusParamsSchema = z.object({
  shortId: z.string(),
  status: z.enum(["running", "idle", "stopped", "error"]),
  error: z.string().optional(),
});

export type NodeSessionStatusParams = z.infer<typeof NodeSessionStatusParamsSchema>;

export const NODE_SESSION_STATUS_METHOD = "node.session_status";
