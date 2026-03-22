import { describe, it, expect } from "vitest";
import { parseTargetPrefix } from "../../src/message-utils.js";

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
