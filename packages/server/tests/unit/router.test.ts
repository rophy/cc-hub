import { describe, it, expect, beforeEach } from "vitest";
import { createRouter, toDiscordChannelName, type Router } from "../../src/router.js";
import type { ServerState } from "../../src/state.js";
import type WebSocket from "ws";

function mockWs(): WebSocket {
  return {} as WebSocket;
}

describe("router", () => {
  let state: ServerState;
  let router: Router;

  beforeEach(() => {
    state = { channels: [], machines: [] };
    router = createRouter(state, () => {});
  });

  describe("resolveChannel", () => {
    it("creates a channel name from project path basename", () => {
      const name = router.resolveChannel("/home/user/projects/my-app");
      expect(name).toBe("my-app");
    });

    it("returns existing channel for same project path", () => {
      const name1 = router.resolveChannel("/home/user/projects/my-app");
      const name2 = router.resolveChannel("/home/user/projects/my-app");
      expect(name1).toBe(name2);
    });

    it("deduplicates channel names from different paths", () => {
      const name1 = router.resolveChannel("/home/user/projects/my-app");
      const name2 = router.resolveChannel("/home/other/projects/my-app");
      expect(name1).toBe("my-app");
      expect(name2).toBe("my-app-2");
    });
  });

  describe("plugin management", () => {
    it("adds and retrieves plugins by channel", () => {
      const ws = mockWs();
      router.addPlugin({
        ws,
        shortId: "a3f7",
        projectPath: "/home/user/proj",
        channelName: "proj",
      });

      const plugins = router.getPluginsForChannel("proj");
      expect(plugins).toHaveLength(1);
      expect(plugins[0].shortId).toBe("a3f7");
    });

    it("returns multiple plugins for same channel", () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      router.addPlugin({ ws: ws1, shortId: "a3f7", projectPath: "/p", channelName: "proj" });
      router.addPlugin({ ws: ws2, shortId: "b2c1", projectPath: "/p", channelName: "proj" });

      expect(router.getPluginsForChannel("proj")).toHaveLength(2);
    });

    it("finds plugin by shortId", () => {
      const ws = mockWs();
      router.addPlugin({ ws, shortId: "a3f7", projectPath: "/p", channelName: "proj" });

      const plugin = router.getPluginByShortId("a3f7");
      expect(plugin?.shortId).toBe("a3f7");
    });

    it("handles plugin disconnect", () => {
      const ws = mockWs();
      router.addPlugin({ ws, shortId: "a3f7", projectPath: "/p", channelName: "proj" });

      const info = router.onPluginDisconnect(ws);
      expect(info?.shortId).toBe("a3f7");
      expect(info?.channelName).toBe("proj");
      expect(router.getPluginsForChannel("proj")).toHaveLength(0);
    });

    it("returns undefined for unknown disconnect", () => {
      const info = router.onPluginDisconnect(mockWs());
      expect(info).toBeUndefined();
    });
  });

  describe("discord channel mapping", () => {
    it("sets and gets discord channel ID", () => {
      router.resolveChannel("/home/user/proj");
      router.setDiscordChannelId("proj", "123456");
      expect(router.getDiscordChannelId("proj")).toBe("123456");
    });

    it("returns undefined for unmapped channel", () => {
      expect(router.getDiscordChannelId("nonexistent")).toBeUndefined();
    });
  });
});

describe("toDiscordChannelName", () => {
  it("lowercases", () => {
    expect(toDiscordChannelName("MyProject")).toBe("myproject");
  });

  it("replaces spaces with hyphens", () => {
    expect(toDiscordChannelName("My Cool Project")).toBe("my-cool-project");
  });

  it("strips invalid characters", () => {
    expect(toDiscordChannelName("project (v2)")).toBe("project-v2");
  });

  it("collapses consecutive hyphens", () => {
    expect(toDiscordChannelName("my--project")).toBe("my-project");
  });

  it("trims leading/trailing hyphens", () => {
    expect(toDiscordChannelName("-project-")).toBe("project");
  });

  it("preserves underscores", () => {
    expect(toDiscordChannelName("my_project")).toBe("my_project");
  });

  it("handles dots and special chars", () => {
    expect(toDiscordChannelName("project.v2@beta!")).toBe("projectv2beta");
  });

  it("returns 'unnamed' for empty result", () => {
    expect(toDiscordChannelName("!!!")).toBe("unnamed");
  });
});
