import { describe, it, expect, beforeEach } from "vitest";
import { createAuthManager, type AuthManager } from "../../src/auth.js";
import type { ServerState } from "../../src/state.js";

describe("AuthManager", () => {
  let state: ServerState;
  let auth: AuthManager;

  beforeEach(() => {
    state = { channels: [], machines: [] };
    auth = createAuthManager(state, () => {});
  });

  describe("token validation", () => {
    it("rejects empty token", () => {
      expect(auth.validateToken("")).toBe(false);
    });

    it("rejects unknown token", () => {
      expect(auth.validateToken("nonexistent")).toBe(false);
    });

    it("accepts valid token after pairing", () => {
      const { code } = auth.startPairing();
      const token = auth.confirmPairing(code);
      expect(token).toBeTruthy();
      expect(auth.validateToken(token!)).toBe(true);
    });
  });

  describe("pairing flow", () => {
    it("generates a 4-char hex code", () => {
      const { code } = auth.startPairing();
      expect(code).toMatch(/^[0-9A-F]{4}$/);
    });

    it("confirms pairing and returns token", () => {
      const { code } = auth.startPairing();
      const token = auth.confirmPairing(code);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
      expect(token!.length).toBe(64); // 32 bytes hex
    });

    it("rejects unknown pairing code", () => {
      const token = auth.confirmPairing("ZZZZ");
      expect(token).toBeNull();
    });

    it("pairing code is case-insensitive", () => {
      const { code } = auth.startPairing();
      const token = auth.confirmPairing(code.toLowerCase());
      expect(token).toBeTruthy();
    });

    it("cannot reuse pairing code", () => {
      const { code } = auth.startPairing();
      auth.confirmPairing(code);
      const again = auth.confirmPairing(code);
      expect(again).toBeNull();
    });

    it("resolves tokenPromise on confirm", async () => {
      const { code, tokenPromise } = auth.startPairing();
      const directToken = auth.confirmPairing(code);
      const promiseToken = await tokenPromise;
      expect(promiseToken).toBe(directToken);
    });

    it("lists pending codes", () => {
      auth.startPairing();
      auth.startPairing();
      expect(auth.getPendingCodes()).toHaveLength(2);
    });

    it("removes code from pending after confirm", () => {
      const { code } = auth.startPairing();
      auth.confirmPairing(code);
      expect(auth.getPendingCodes()).toHaveLength(0);
    });
  });

  describe("token revocation", () => {
    it("revokes an existing token", () => {
      const { code } = auth.startPairing();
      const token = auth.confirmPairing(code)!;
      expect(auth.revokeToken(token)).toBe(true);
      expect(auth.validateToken(token)).toBe(false);
    });

    it("returns false for unknown token", () => {
      expect(auth.revokeToken("nonexistent")).toBe(false);
    });
  });

  describe("state persistence", () => {
    it("stores paired machine in state", () => {
      const { code } = auth.startPairing();
      auth.confirmPairing(code, "dev-machine");
      expect(state.machines).toHaveLength(1);
      expect(state.machines[0].hostname).toBe("dev-machine");
      expect(state.machines[0].pairedAt).toBeTruthy();
    });
  });
});
