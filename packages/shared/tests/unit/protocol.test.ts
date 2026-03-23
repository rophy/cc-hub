import { describe, it, expect } from "vitest";
import {
  JsonRpcRequestSchema,
  JsonRpcResponseSchema,
  createRequest,
  createNotification,
  createResponse,
} from "../../src/protocol.js";
import { IdentifyParamsSchema } from "../../src/identify.js";
import { CcMessageParamsSchema, CcReplyParamsSchema } from "../../src/cc-methods.js";
import {
  NodeStartSessionParamsSchema,
  NodeHeartbeatParamsSchema,
} from "../../src/node-methods.js";

describe("JSON-RPC helpers", () => {
  it("creates a valid request", () => {
    const req = createRequest("cc.message", { text: "hello" }, 1);
    expect(req.jsonrpc).toBe("2.0");
    expect(req.method).toBe("cc.message");
    expect(req.id).toBe(1);
    expect(JsonRpcRequestSchema.parse(req)).toBeTruthy();
  });

  it("creates a valid notification", () => {
    const notif = createNotification("node.heartbeat", { activeSessions: [] });
    expect(notif.jsonrpc).toBe("2.0");
    expect(notif.method).toBe("node.heartbeat");
    expect("id" in notif).toBe(false);
  });

  it("creates a success response", () => {
    const res = createResponse(1, { ok: true });
    expect(res.result).toEqual({ ok: true });
    expect(res.error).toBeUndefined();
    expect(JsonRpcResponseSchema.parse(res)).toBeTruthy();
  });

  it("creates an error response", () => {
    const res = createResponse(1, undefined, { code: -1, message: "fail" });
    expect(res.error?.message).toBe("fail");
    expect(res.result).toBeUndefined();
  });
});

describe("identify schema", () => {
  it("validates cc-plugin identify", () => {
    const result = IdentifyParamsSchema.parse({
      clientType: "cc-plugin",
      token: "abc123",
      shortId: "a3f7",
      projectPath: "/home/user/project",
    });
    expect(result.clientType).toBe("cc-plugin");
  });

  it("validates node-agent identify", () => {
    const result = IdentifyParamsSchema.parse({
      clientType: "node-agent",
      token: "abc123",
      shortId: "b2c1",
      hostname: "dev-machine",
    });
    expect(result.clientType).toBe("node-agent");
  });

  it("rejects invalid client type", () => {
    expect(() =>
      IdentifyParamsSchema.parse({
        clientType: "invalid",
        token: "abc",
        shortId: "x",
      }),
    ).toThrow();
  });
});

describe("cc method schemas", () => {
  it("validates cc.message params", () => {
    const result = CcMessageParamsSchema.parse({
      from: "user123",
      text: "fix the bug",
    });
    expect(result.from).toBe("user123");
  });

  it("validates cc.reply params", () => {
    const result = CcReplyParamsSchema.parse({
      text: "I found the issue...",
    });
    expect(result.text).toBe("I found the issue...");
  });
});

describe("node method schemas", () => {
  it("validates node.start_session params", () => {
    const result = NodeStartSessionParamsSchema.parse({
      projectPath: "/home/user/project",
      prompt: "work on auth",
      channelName: "project",
    });
    expect(result.projectPath).toBe("/home/user/project");
  });

  it("validates node.heartbeat params", () => {
    const result = NodeHeartbeatParamsSchema.parse({
      activeSessions: ["a3f7", "b2c1"],
    });
    expect(result.activeSessions).toHaveLength(2);
  });
});
