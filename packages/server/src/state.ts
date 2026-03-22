import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface ChannelMapping {
  projectPath: string;
  discordChannelId: string;
  channelName: string;
}

export interface PairedMachine {
  token: string;
  hostname?: string;
  pairedAt: string;
}

export interface ServerState {
  channels: ChannelMapping[];
  machines: PairedMachine[];
}

const STATE_DIR = join(homedir(), ".cc-hub");
const STATE_FILE = join(STATE_DIR, "state.json");

export function loadState(): ServerState {
  try {
    const data = readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(data) as ServerState;
  } catch {
    return { channels: [], machines: [] };
  }
}

export function saveState(state: ServerState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE_FILE);
}
