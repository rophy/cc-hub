import { z } from "zod";

// node.start_session — server → node-agent
// Request to launch a new CC session

export const NodeStartSessionParamsSchema = z.object({
  /** Working directory for the CC session */
  projectPath: z.string(),
  /** Initial prompt for CC (optional) */
  prompt: z.string().optional(),
});

export type NodeStartSessionParams = z.infer<typeof NodeStartSessionParamsSchema>;

export const NodeStartSessionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

export type NodeStartSessionResult = z.infer<typeof NodeStartSessionResultSchema>;

export const NODE_START_SESSION_METHOD = "node.start_session";

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
  status: z.enum(["running", "stopped", "error"]),
  error: z.string().optional(),
});

export type NodeSessionStatusParams = z.infer<typeof NodeSessionStatusParamsSchema>;

export const NODE_SESSION_STATUS_METHOD = "node.session_status";
