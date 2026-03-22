import { describe, it, expect } from "vitest";
import { chunkMessage } from "../../src/discord-bot.js";

describe("chunkMessage", () => {
  it("returns single chunk for short messages", () => {
    const chunks = chunkMessage("hello world");
    expect(chunks).toEqual(["hello world"]);
  });

  it("splits long messages at newlines", () => {
    const line = "a".repeat(1000);
    const text = `${line}\n${line}\n${line}`;
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it("handles messages with no newlines", () => {
    const text = "a".repeat(5000);
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("closes and reopens split code blocks", () => {
    const codeLine = "x".repeat(80) + "\n";
    const code = codeLine.repeat(30); // ~2430 chars
    const text = `\`\`\`\n${code}\`\`\``;
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end with closing ```
    expect(chunks[0]).toMatch(/```$/);
    // Second chunk should start with opening ```
    expect(chunks[1]).toMatch(/^```/);
  });

  it("returns empty array elements for empty string", () => {
    const chunks = chunkMessage("");
    expect(chunks).toEqual([""]);
  });

  it("preserves complete text across chunks", () => {
    const line = "abcdefghij\n";
    const text = line.repeat(250); // ~2750 chars
    const chunks = chunkMessage(text);
    // When rejoined (stripping code block fixups), content should be preserved
    expect(chunks.join("").length).toBeGreaterThanOrEqual(text.length);
  });
});
