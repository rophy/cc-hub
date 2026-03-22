import { describe, it, expect } from "vitest";
import { generateShortId } from "../../src/utils.js";

describe("generateShortId", () => {
  it("returns a 4-character hex string", () => {
    const id = generateShortId();
    expect(id).toMatch(/^[0-9a-f]{4}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()));
    expect(ids.size).toBeGreaterThan(90);
  });
});
