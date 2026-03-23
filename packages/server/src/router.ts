import { basename } from "node:path";
import type { ServerState, ChannelMapping } from "./state.js";
import type WebSocket from "ws";

export interface ConnectedPlugin {
  ws: WebSocket;
  shortId: string;
  projectPath: string;
  channelName: string;
}

export interface ConnectedNodeAgent {
  ws: WebSocket;
  shortId: string;
  hostname?: string;
}

export interface Router {
  /** Register a cc-plugin connection */
  addPlugin(plugin: ConnectedPlugin): void;
  /** Remove a cc-plugin connection */
  removePlugin(ws: WebSocket): void;
  /** Register a node-agent connection */
  addNodeAgent(agent: ConnectedNodeAgent): void;
  /** Remove a node-agent connection */
  removeNodeAgent(ws: WebSocket): void;
  /** Get all plugins for a given channel name */
  getPluginsForChannel(channelName: string): ConnectedPlugin[];
  /** Get a specific plugin by shortId */
  getPluginByShortId(shortId: string): ConnectedPlugin | undefined;
  /** Get a specific plugin by WebSocket reference */
  getPluginByWs(ws: WebSocket): ConnectedPlugin | undefined;
  /** Get channel name for a project path, creating mapping if needed */
  resolveChannel(projectPath: string): string;
  /** Get Discord channel ID for a channel name */
  getDiscordChannelId(channelName: string): string | undefined;
  /** Set Discord channel ID for a channel name */
  setDiscordChannelId(channelName: string, discordChannelId: string): void;
  /** Get project path for a channel name */
  getProjectPathForChannel(channelName: string): string | undefined;
  /** Get all connected node agents */
  getNodeAgents(): ConnectedNodeAgent[];
  /** Called when a plugin disconnects — returns channel name for status message */
  onPluginDisconnect(ws: WebSocket): { shortId: string; channelName: string } | undefined;
}

export function createRouter(
  state: ServerState,
  persistState: (state: ServerState) => void,
): Router {
  const plugins = new Map<WebSocket, ConnectedPlugin>();
  const nodeAgents = new Map<WebSocket, ConnectedNodeAgent>();

  function resolveChannel(projectPath: string): string {
    const existing = state.channels.find((c) => c.projectPath === projectPath);
    if (existing) return existing.channelName;

    const name = basename(projectPath);
    // Avoid duplicates by appending a suffix
    const existingNames = new Set(state.channels.map((c) => c.channelName));
    let channelName = name;
    let suffix = 2;
    while (existingNames.has(channelName)) {
      channelName = `${name}-${suffix}`;
      suffix++;
    }

    state.channels.push({
      projectPath,
      discordChannelId: "",
      channelName,
    });
    persistState(state);
    return channelName;
  }

  function getDiscordChannelId(channelName: string): string | undefined {
    const mapping = state.channels.find((c) => c.channelName === channelName);
    return mapping?.discordChannelId || undefined;
  }

  function setDiscordChannelId(channelName: string, discordChannelId: string): void {
    const mapping = state.channels.find((c) => c.channelName === channelName);
    if (mapping) {
      mapping.discordChannelId = discordChannelId;
      persistState(state);
    }
  }

  return {
    addPlugin(plugin) {
      plugins.set(plugin.ws, plugin);
    },
    removePlugin(ws) {
      plugins.delete(ws);
    },
    addNodeAgent(agent) {
      nodeAgents.set(agent.ws, agent);
    },
    removeNodeAgent(ws) {
      nodeAgents.delete(ws);
    },
    getPluginsForChannel(channelName) {
      return Array.from(plugins.values()).filter(
        (p) => p.channelName === channelName,
      );
    },
    getPluginByShortId(shortId) {
      return Array.from(plugins.values()).find((p) => p.shortId === shortId);
    },
    getPluginByWs(ws) {
      return plugins.get(ws);
    },
    resolveChannel,
    getDiscordChannelId,
    setDiscordChannelId,
    getProjectPathForChannel(channelName) {
      const mapping = state.channels.find((c) => c.channelName === channelName);
      return mapping?.projectPath;
    },
    getNodeAgents() {
      return Array.from(nodeAgents.values());
    },
    onPluginDisconnect(ws) {
      const plugin = plugins.get(ws);
      if (!plugin) return undefined;
      plugins.delete(ws);
      return { shortId: plugin.shortId, channelName: plugin.channelName };
    },
  };
}
