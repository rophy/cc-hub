import { describe, it, expect } from "vitest";
import { parseTargetPrefix, parseMention } from "../../src/message-utils.js";

describe("parseTargetPrefix", () => {
  it("parses @shortId prefix", () => {
    const [target, text] = parseTargetPrefix("@a3f7 fix the bug");
    expect(target).toBe("a3f7");
    expect(text).toBe("fix the bug");
  });

  it("returns undefined target for no prefix", () => {
    const [target, text] = parseTargetPrefix("fix the bug");
    expect(target).toBeUndefined();
    expect(text).toBe("fix the bug");
  });

  it("does not match non-hex IDs", () => {
    const [target, text] = parseTargetPrefix("@zzzz fix the bug");
    expect(target).toBeUndefined();
    expect(text).toBe("@zzzz fix the bug");
  });

  it("requires space after shortId", () => {
    const [target, text] = parseTargetPrefix("@a3f7");
    expect(target).toBeUndefined();
    expect(text).toBe("@a3f7");
  });

  it("preserves multiline message", () => {
    const [target, text] = parseTargetPrefix("@a3f7 line1\nline2");
    expect(target).toBe("a3f7");
    expect(text).toBe("line1\nline2");
  });
});

describe("parseMention", () => {
  const botId = "123456789";

  it("detects @mention with message", () => {
    const [isMention, text] = parseMention(`<@${botId}> hello`, botId);
    expect(isMention).toBe(true);
    expect(text).toBe("hello");
  });

  it("detects @mention with ! format", () => {
    const [isMention, text] = parseMention(`<@!${botId}> hello`, botId);
    expect(isMention).toBe(true);
    expect(text).toBe("hello");
  });

  it("returns false for no mention", () => {
    const [isMention, text] = parseMention("just a message", botId);
    expect(isMention).toBe(false);
    expect(text).toBe("just a message");
  });

  it("returns false for mention of different bot", () => {
    const [isMention, text] = parseMention("<@999999> hello", botId);
    expect(isMention).toBe(false);
    expect(text).toBe("<@999999> hello");
  });

  it("strips mention and trims whitespace", () => {
    const [isMention, text] = parseMention(`<@${botId}>   hello world  `, botId);
    expect(isMention).toBe(true);
    expect(text).toBe("hello world");
  });

  it("handles mention-only message (no text)", () => {
    const [isMention, text] = parseMention(`<@${botId}>`, botId);
    expect(isMention).toBe(true);
    expect(text).toBe("");
  });
});
