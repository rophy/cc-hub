import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "../../src/session-manager.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it("starts with no active sessions", () => {
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it("stopAll clears all sessions", () => {
    // Can't easily test startSession without claude binary,
    // but we can test stopAll on empty state
    manager.stopAll();
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it("stopSession returns error for unknown session", async () => {
    const result = await manager.stopSession("unknown");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});
