import { z } from "zod";

export const HookEventSchema = z.object({
  session_id: z.string(),
  cwd: z.string().optional(),
  hook_event_name: z.string(),
  // Tool events
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  tool_input: z.record(z.unknown()).optional(),
  tool_result: z.string().optional(),
  error: z.string().optional(),
  // User prompt
  prompt: z.string().optional(),
  // Session events
  source: z.string().optional(),
  reason: z.string().optional(),
  // Subagent events
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
  agent_name: z.string().optional(),
  // Stop failure
  error_type: z.string().optional(),
  error_message: z.string().optional(),
});

export type HookEvent = z.infer<typeof HookEventSchema>;
