import { z } from "zod";

// Sent by clients immediately after WebSocket connection

export const ClientType = z.enum(["cc-plugin", "node-agent"]);
export type ClientType = z.infer<typeof ClientType>;

export const IdentifyParamsSchema = z.object({
  clientType: ClientType,
  token: z.string(),
  /** Short random ID for this connection (e.g., "a3f7") */
  shortId: z.string(),
  /** Project working directory (cc-plugin only) */
  projectPath: z.string().optional(),
  /** Hostname of the connecting machine */
  hostname: z.string().optional(),
});

export type IdentifyParams = z.infer<typeof IdentifyParamsSchema>;

export const IdentifyResultSchema = z.object({
  /** Whether identification was accepted */
  ok: z.boolean(),
  /** Error message if not accepted */
  error: z.string().optional(),
  /** Assigned channel name (cc-plugin only) */
  channel: z.string().optional(),
});

export type IdentifyResult = z.infer<typeof IdentifyResultSchema>;

// Method name
export const IDENTIFY_METHOD = "identify";
