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
    const result = formatStreamEvent(makeEvent({ eventType: "text", text: "Hello world" }));
    expect(result?.text).toBe("Hello world");
  });

  it("returns null for empty text", () => {
    const result = formatStreamEvent(makeEvent({ eventType: "text", text: "" }));
    expect(result).toBeNull();
  });

  it("formats Bash tool call", () => {
    const result = formatStreamEvent(
      makeEvent({
        eventType: "tool_call",
        toolName: "Bash",
        toolInput: { command: "npm test" },
      }),
    );
    expect(result?.text).toContain("Bash");
    expect(result?.text).toContain("npm test");
  });

  it("formats Edit tool call", () => {
    const result = formatStreamEvent(
      makeEvent({
        eventType: "tool_call",
        toolName: "Edit",
        toolInput: { file_path: "/src/index.ts" },
      }),
    );
    expect(result?.text).toContain("Edit");
    expect(result?.text).toContain("/src/index.ts");
  });

  it("formats tool result", () => {
    const result = formatStreamEvent(
      makeEvent({
        eventType: "tool_result",
        toolResult: "PASS: 5 tests",
      }),
    );
    expect(result?.text).toContain("PASS: 5 tests");
    expect(result?.text).toContain("```");
  });

  it("returns null for empty tool result", () => {
    const result = formatStreamEvent(makeEvent({ eventType: "tool_result", toolResult: "" }));
    expect(result).toBeNull();
  });

  it("truncates long tool results", () => {
    const result = formatStreamEvent(
      makeEvent({ eventType: "tool_result", toolResult: "x".repeat(500) }),
    );
    expect(result!.text.length).toBeLessThan(500);
    expect(result?.text).toContain("…");
  });

  it("formats error with red color", () => {
    const result = formatStreamEvent(makeEvent({ eventType: "error", text: "something broke" }));
    expect(result?.text).toContain("something broke");
    expect(result?.color).toBe(0xcc0000);
  });

  it("formats session_start with green color", () => {
    const result = formatStreamEvent(makeEvent({ eventType: "session_start", text: "started" }));
    expect(result?.text).toContain("started");
    expect(result?.color).toBe(0x00cc00);
  });

  it("returns null for session_end", () => {
    const result = formatStreamEvent(makeEvent({ eventType: "session_end", text: "ended" }));
    expect(result).toBeNull();
  });

  it("returns null for unknown event type", () => {
    const result = formatStreamEvent(makeEvent({ eventType: "unknown" as any }));
    expect(result).toBeNull();
  });
});
