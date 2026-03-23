import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseStreamLine } from "./stream-parser.js";
import type { NodeStreamEventParams } from "@cc-hub/shared";
import { generateShortId } from "./utils.js";

export interface SessionEvents {
  onStreamEvent(event: NodeStreamEventParams): void;
}

/** Tracks whether a channel is currently processing a prompt */
const busyChannels = new Set<string>();

export function getBusyChannels(): string[] {
  return Array.from(busyChannels);
}

export class SessionManager {
  private events: SessionEvents;

  constructor(events: SessionEvents) {
    this.events = events;
  }

  /** Run a prompt in headless mode, streaming output via events */
  async runPrompt(
    projectPath: string,
    prompt: string,
    channelName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (busyChannels.has(channelName)) {
      return { ok: false, error: "Channel is busy processing a previous message" };
    }

    busyChannels.add(channelName);
    const shortId = generateShortId();

    try {
      await this.spawnClaude(projectPath, prompt, channelName, shortId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    } finally {
      busyChannels.delete(channelName);
    }
  }

  private spawnClaude(
    projectPath: string,
    prompt: string,
    channelName: string,
    shortId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", [
        "-p", prompt,
        "--continue",
        "--dangerously-skip-permissions",
        "--output-format", "stream-json",
        "--verbose",
      ], {
        cwd: projectPath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let textBuffer = "";
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushText = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (textBuffer) {
          this.events.onStreamEvent({
            shortId,
            channelName,
            eventType: "text",
            text: textBuffer,
          });
          textBuffer = "";
        }
      };

      const bufferText = (text: string) => {
        textBuffer += text;
        if (!flushTimer) {
          flushTimer = setTimeout(flushText, 500);
        }
      };

      const rl = createInterface({ input: child.stdout! });

      rl.on("line", (line) => {
        const event = parseStreamLine(line);
        if (!event) return;

        // Assistant message — text and tool_use blocks
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              bufferText(block.text);
            }
            if (block.type === "tool_use" && block.name) {
              flushText();
              this.events.onStreamEvent({
                shortId,
                channelName,
                eventType: "tool_call",
                toolName: block.name,
                toolInput: block.input,
              });
            }
          }
        }

        // Tool result
        if (event.type === "tool_result" && event.content) {
          for (const block of event.content) {
            if (block.type === "text" && block.text) {
              this.events.onStreamEvent({
                shortId,
                channelName,
                eventType: "tool_result",
                toolResult: block.text,
              });
            }
          }
        }

        // Error result
        if (event.type === "result" && event.is_error && event.result) {
          flushText();
          this.events.onStreamEvent({
            shortId,
            channelName,
            eventType: "error",
            text: event.result,
          });
        }

        // System error
        if (event.type === "system" && event.error) {
          this.events.onStreamEvent({
            shortId,
            channelName,
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
        flushText();

        if (code !== 0 && stderr) {
          this.events.onStreamEvent({
            shortId,
            channelName,
            eventType: "error",
            text: stderr.slice(0, 500),
          });
        }

        // Signal prompt completion
        this.events.onStreamEvent({
          shortId,
          channelName,
          eventType: "session_end",
        });

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CC exited with code ${code}: ${stderr.slice(0, 200)}`));
        }
      });

      child.on("error", reject);
    });
  }
}
