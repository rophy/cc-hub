import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ClientConfig {
  serverUrl: string;
  token: string;
}

const CONFIG_DIR = join(homedir(), ".cc-hub");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadClientConfig(): ClientConfig {
  // Env vars take precedence
  const serverUrl = process.env.CC_HUB_SERVER_URL;
  const token = process.env.CC_HUB_TOKEN;

  let fileConfig: Partial<ClientConfig> = {};
  try {
    fileConfig = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    // no config file yet
  }

  return {
    serverUrl: serverUrl || fileConfig.serverUrl || "ws://localhost:3000",
    token: token || fileConfig.token || "",
  };
}

export function saveClientConfig(config: Partial<ClientConfig>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    // no existing config
  }

  const merged = { ...existing, ...config };
  const tmp = CONFIG_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n");
  renameSync(tmp, CONFIG_FILE);
}
