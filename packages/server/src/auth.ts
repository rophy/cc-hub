import { randomBytes } from "node:crypto";
import type { ServerState, PairedMachine } from "./state.js";

export interface PendingPairing {
  code: string;
  createdAt: number;
  /** Callback to complete the pairing */
  resolve: (token: string) => void;
  /** Callback to reject the pairing */
  reject: (reason: string) => void;
}

const PAIRING_CODE_LENGTH = 4;
const PAIRING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_LENGTH = 32;

export function createAuthManager(
  state: ServerState,
  persistState: (state: ServerState) => void,
) {
  const pendingPairings = new Map<string, PendingPairing>();

  /** Generate a short uppercase pairing code */
  function generatePairingCode(): string {
    return randomBytes(2)
      .toString("hex")
      .toUpperCase();
  }

  /** Generate a secure token */
  function generateToken(): string {
    return randomBytes(TOKEN_LENGTH).toString("hex");
  }

  /** Validate a token. Returns true if valid. */
  function validateToken(token: string): boolean {
    return state.machines.some((m) => m.token === token);
  }

  /**
   * Start a pairing flow. Returns a pairing code and a promise that
   * resolves with the token when the user confirms.
   */
  function startPairing(): { code: string; tokenPromise: Promise<string> } {
    const code = generatePairingCode();

    const tokenPromise = new Promise<string>((resolve, reject) => {
      const pairing: PendingPairing = {
        code,
        createdAt: Date.now(),
        resolve,
        reject,
      };
      pendingPairings.set(code, pairing);

      // Auto-expire
      setTimeout(() => {
        if (pendingPairings.has(code)) {
          pendingPairings.delete(code);
          reject("Pairing code expired");
        }
      }, PAIRING_TIMEOUT_MS);
    });

    return { code, tokenPromise };
  }

  /**
   * Confirm a pairing code. Returns the generated token if valid.
   * Called when a user approves via Discord.
   */
  function confirmPairing(code: string, hostname?: string): string | null {
    const pairing = pendingPairings.get(code.toUpperCase());
    if (!pairing) return null;

    const token = generateToken();
    state.machines.push({
      token,
      hostname,
      pairedAt: new Date().toISOString(),
    });
    persistState(state);

    pendingPairings.delete(code.toUpperCase());
    pairing.resolve(token);
    return token;
  }

  /** Get list of pending pairing codes (for display) */
  function getPendingCodes(): string[] {
    return Array.from(pendingPairings.keys());
  }

  /** Revoke a token */
  function revokeToken(token: string): boolean {
    const idx = state.machines.findIndex((m) => m.token === token);
    if (idx === -1) return false;
    state.machines.splice(idx, 1);
    persistState(state);
    return true;
  }

  return {
    validateToken,
    startPairing,
    confirmPairing,
    getPendingCodes,
    revokeToken,
    generateToken,
  };
}

export type AuthManager = ReturnType<typeof createAuthManager>;
