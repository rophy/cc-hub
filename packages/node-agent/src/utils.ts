import { randomBytes } from "node:crypto";

/** Generate a short random hex ID (e.g., "a3f7") */
export function generateShortId(): string {
  return randomBytes(2).toString("hex");
}
