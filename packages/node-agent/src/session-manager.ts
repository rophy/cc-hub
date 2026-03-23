import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { parseStreamLine } from "./stream-parser.js";
import type { NodeStreamEventParams } from "@cc-hub/shared";
import { generateShortId } from "./utils.js";

export interface SessionEvents {
  onStreamEvent(event: NodeStreamEventParams): void;
  onSessionEnd(shortId: string, channelName: string): void;
}

interface ManagedSession {
  shortId: string;
  channelName: string;
  projectPath: string;
  ccSessionId?: string;
  process: ChildProcess | null;
  textBuffer: string;
  textFlushTimer: ReturnType<typeof setTimeout> | null;
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private events: SessionEvents;
  private static TEXT_FLUSH_INTERVAL = 500;

  constructor(events: SessionEvents) {
    this.events = events;
  }

  async startSession(
    projectPath: string,
    prompt: string,
    channelName: string,
  ): Promise<{ ok: boolean; shortId?: string; error?: string }> {
    const shortId = generateShortId();

    const session: ManagedSession = {
      shortId,
      channelName,
      projectPath,
      process: null,
      textBuffer: "",
      textFlushTimer: null,
    };
    this.sessions.set(shortId, session);

    this.events.onStreamEvent({
      shortId,
      channelName,
      eventType: "session_start",
      text: `Session started in \`${projectPath}\``,
    });

    try {
      await this.runPrompt(session, prompt);
      return { ok: true, shortId };
    } catch (err) {
      return {
        ok: false,
        shortId,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async sendMessage(
    shortId: string,
    text: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(shortId);
    if (!session) {
      return { ok: false, error: `Session ${shortId} not found` };
    }

    if (session.process) {
      return { ok: false, error: "Session is busy processing" };
    }

    try {
      await this.runPrompt(session, text);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  private runPrompt(session: ManagedSession, prompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-p", prompt,
        "--output-format", "stream-json",
      ];

      if (session.ccSessionId) {
        // Resume the specific session
        args.push("--resume", session.ccSessionId);
      } else {
        // First message — continue the latest session in this directory
        args.push("--continue");
      }

      const child = spawn("claude", args, {
        cwd: session.projectPath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      session.process = child;

      const rl = createInterface({ input: child.stdout! });

      rl.on("line", (line) => {
        const event = parseStreamLine(line);
        if (!event) return;

        // Capture session ID
        if (event.session_id && !session.ccSessionId) {
          session.ccSessionId = event.session_id;
        }

        if (event.type === "stream_event" && event.event?.delta) {
          const delta = event.event.delta;

          switch (delta.type) {
            case "text_delta":
              if (delta.text) {
                this.bufferText(session, delta.text);
              }
              break;

            case "tool_call":
              this.flushText(session);
              this.events.onStreamEvent({
                shortId: session.shortId,
                channelName: session.channelName,
                eventType: "tool_call",
                toolName: delta.name,
                toolInput: delta.input,
              });
              break;

            case "tool_result":
              this.events.onStreamEvent({
                shortId: session.shortId,
                channelName: session.channelName,
                eventType: "tool_result",
                toolName: delta.name,
                toolResult: delta.content,
              });
              break;
          }
        }

        if (event.type === "system" && event.error) {
          this.events.onStreamEvent({
            shortId: session.shortId,
            channelName: session.channelName,
            eventType: "error",
            text: event.error,
          });
        }
      });

      let stderr = "";
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("exit", (code) => {
        session.process = null;
        this.flushText(session);

        if (code !== 0 && stderr) {
          this.events.onStreamEvent({
            shortId: session.shortId,
            channelName: session.channelName,
            eventType: "error",
            text: stderr.slice(0, 500),
          });
        }

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CC exited with code ${code}: ${stderr.slice(0, 200)}`));
        }
      });

      child.on("error", (err) => {
        session.process = null;
        reject(err);
      });
    });
  }

  private bufferText(session: ManagedSession, text: string): void {
    session.textBuffer += text;
    if (!session.textFlushTimer) {
      session.textFlushTimer = setTimeout(() => {
        this.flushText(session);
      }, SessionManager.TEXT_FLUSH_INTERVAL);
    }
  }

  private flushText(session: ManagedSession): void {
    if (session.textFlushTimer) {
      clearTimeout(session.textFlushTimer);
      session.textFlushTimer = null;
    }
    if (session.textBuffer) {
      this.events.onStreamEvent({
        shortId: session.shortId,
        channelName: session.channelName,
        eventType: "text",
        text: session.textBuffer,
      });
      session.textBuffer = "";
    }
  }

  async stopSession(shortId: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(shortId);
    if (!session) {
      return { ok: false, error: `Session ${shortId} not found` };
    }

    if (session.process) {
      session.process.kill("SIGTERM");
    }
    this.sessions.delete(shortId);

    this.events.onSessionEnd(shortId, session.channelName);
    return { ok: true };
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  getSession(shortId: string): ManagedSession | undefined {
    return this.sessions.get(shortId);
  }

  getSessionsForChannel(channelName: string): ManagedSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.channelName === channelName,
    );
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      if (session.process) {
        session.process.kill("SIGTERM");
      }
    }
    this.sessions.clear();
  }
}
