import { spawn, type ChildProcess } from "node:child_process";

interface ManagedSession {
  shortId: string;
  projectPath: string;
  process: ChildProcess;
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private nextShortId = 0;

  private generateSessionId(): string {
    this.nextShortId++;
    return this.nextShortId.toString(16).padStart(4, "0");
  }

  async startSession(
    projectPath: string,
    prompt?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const shortId = this.generateSessionId();

    try {
      const args = ["--channels", "cc-hub-plugin"];
      if (prompt) {
        args.push("-p", prompt);
      }

      const child = spawn("claude", args, {
        cwd: projectPath,
        stdio: "ignore",
        detached: true,
        env: {
          ...process.env,
          CC_HUB_SERVER_URL: process.env.CC_HUB_SERVER_URL || "ws://localhost:3000",
          CC_HUB_TOKEN: process.env.CC_HUB_TOKEN || "",
        },
      });

      child.unref();

      child.on("exit", () => {
        this.sessions.delete(shortId);
      });

      this.sessions.set(shortId, { shortId, projectPath, process: child });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async stopSession(shortId: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(shortId);
    if (!session) {
      return { ok: false, error: `Session ${shortId} not found` };
    }

    session.process.kill("SIGTERM");
    this.sessions.delete(shortId);
    return { ok: true };
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.process.kill("SIGTERM");
    }
    this.sessions.clear();
  }
}
