import { describe, it, expect } from "vitest";
import { formatStreamEvent } from "../../src/stream-formatter.js";
import type { NodeStreamEventParams } from "@cc-hub/shared";

function makeEvent(overrides: Partial<NodeStreamEventParams>): NodeStreamEventParams {
  return {
    shortId: "a3f7",
    channelName: "proj",
    eventType: "text",
    ...overrides,
  };
}

describe("formatStreamEvent", () => {
  it("returns text as-is", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "text", text: "Hello world" }));
    expect(msg).toBe("Hello world");
  });

  it("returns null for empty text", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "text", text: "" }));
    expect(msg).toBeNull();
  });

  it("formats Bash tool call", () => {
    const msg = formatStreamEvent(
      makeEvent({
        eventType: "tool_call",
        toolName: "Bash",
        toolInput: { command: "npm test" },
      }),
    );
    expect(msg).toContain("Bash");
    expect(msg).toContain("npm test");
  });

  it("formats Edit tool call", () => {
    const msg = formatStreamEvent(
      makeEvent({
        eventType: "tool_call",
        toolName: "Edit",
        toolInput: { file_path: "/src/index.ts" },
      }),
    );
    expect(msg).toContain("Edit");
    expect(msg).toContain("/src/index.ts");
  });

  it("formats tool result", () => {
    const msg = formatStreamEvent(
      makeEvent({
        eventType: "tool_result",
        toolResult: "PASS: 5 tests",
      }),
    );
    expect(msg).toContain("PASS: 5 tests");
    expect(msg).toContain("```");
  });

  it("returns null for empty tool result", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "tool_result", toolResult: "" }));
    expect(msg).toBeNull();
  });

  it("truncates long tool results", () => {
    const msg = formatStreamEvent(
      makeEvent({ eventType: "tool_result", toolResult: "x".repeat(500) }),
    );
    expect(msg!.length).toBeLessThan(500);
    expect(msg).toContain("…");
  });

  it("formats error", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "error", text: "something broke" }));
    expect(msg).toContain("Error");
    expect(msg).toContain("something broke");
  });

  it("formats session_start", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "session_start", text: "started" }));
    expect(msg).toContain("started");
  });

  it("formats session_end", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "session_end", text: "ended" }));
    expect(msg).toContain("ended");
  });

  it("returns null for unknown event type", () => {
    const msg = formatStreamEvent(makeEvent({ eventType: "unknown" as any }));
    expect(msg).toBeNull();
  });
});
