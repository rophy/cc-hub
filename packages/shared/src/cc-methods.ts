import { z } from "zod";

// cc.message — server → cc-plugin
// A user message from the chat platform destined for this CC session

export const CcMessageParamsSchema = z.object({
  /** Display name of the sender */
  from: z.string(),
  /** Message text */
  text: z.string(),
  /** Platform message ID (for reply threading) */
  messageId: z.string().optional(),
});

export type CcMessageParams = z.infer<typeof CcMessageParamsSchema>;

export const CC_MESSAGE_METHOD = "cc.message";

// cc.reply — cc-plugin → server
// A response from CC back to the chat platform

export const CcReplyParamsSchema = z.object({
  /** Reply text (markdown) */
  text: z.string(),
  /** Files to attach */
  files: z.array(z.string()).optional(),
});

export type CcReplyParams = z.infer<typeof CcReplyParamsSchema>;

export const CC_REPLY_METHOD = "cc.reply";
