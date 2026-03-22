import { z } from "zod";

// JSON-RPC 2.0 base types

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
  id: z.union([z.string(), z.number()]),
});

export const JsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
});

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
  id: z.union([z.string(), z.number(), z.null()]),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// Helper to create JSON-RPC messages

export function createRequest(
  method: string,
  params: unknown,
  id: string | number,
): JsonRpcRequest {
  return { jsonrpc: "2.0", method, params, id };
}

export function createNotification(
  method: string,
  params?: unknown,
): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}

export function createResponse(
  id: string | number | null,
  result?: unknown,
  error?: { code: number; message: string; data?: unknown },
): JsonRpcResponse {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  return response;
}
