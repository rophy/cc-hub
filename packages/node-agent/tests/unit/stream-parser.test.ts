import { describe, it, expect } from "vitest";
import { parseStreamLine } from "../../src/stream-parser.js";

describe("parseStreamLine", () => {
  it("parses valid JSON", () => {
    const event = parseStreamLine('{"type":"assistant","session_id":"abc"}');
    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!.session_id).toBe("abc");
  });

  it("returns null for empty line", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("  ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseStreamLine("not json")).toBeNull();
  });

  it("parses assistant message with text content", () => {
    const line = JSON.stringify({
      type: "assistant",
      session_id: "sess-1",
      message: {
        content: [
          { type: "text", text: "Hello world" },
        ],
      },
    });
    const event = parseStreamLine(line);
    expect(event!.type).toBe("assistant");
    expect(event!.message!.content![0].text).toBe("Hello world");
  });

  it("parses assistant message with tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      session_id: "sess-1",
      message: {
        content: [
          { type: "tool_use", name: "Bash", id: "tc1", input: { command: "ls" } },
        ],
      },
    });
    const event = parseStreamLine(line);
    expect(event!.message!.content![0].name).toBe("Bash");
    expect(event!.message!.content![0].input).toEqual({ command: "ls" });
  });

  it("parses tool_result event", () => {
    const line = JSON.stringify({
      type: "tool_result",
      content: [
        { type: "text", text: "file1.ts\nfile2.ts" },
      ],
    });
    const event = parseStreamLine(line);
    expect(event!.type).toBe("tool_result");
    expect(event!.content![0].text).toBe("file1.ts\nfile2.ts");
  });

  it("parses result event", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done",
      session_id: "sess-1",
    });
    const event = parseStreamLine(line);
    expect(event!.type).toBe("result");
    expect(event!.is_error).toBe(false);
    expect(event!.result).toBe("Done");
  });

  it("parses error result", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Something went wrong",
    });
    const event = parseStreamLine(line);
    expect(event!.is_error).toBe(true);
    expect(event!.result).toBe("Something went wrong");
  });

  it("parses system error", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "api_retry",
      error: "rate_limit",
    });
    const event = parseStreamLine(line);
    expect(event!.type).toBe("system");
    expect(event!.error).toBe("rate_limit");
  });

  it("parses system init event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: "/home/user/proj",
      session_id: "sess-1",
      tools: ["Bash", "Read", "Write"],
    });
    const event = parseStreamLine(line);
    expect(event!.cwd).toBe("/home/user/proj");
    expect(event!.tools).toContain("Bash");
  });
});
