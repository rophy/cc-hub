import type { NodeStreamEventParams } from "@cc-hub/shared";

const MAX_PREVIEW = 300;

function truncate(text: string, max = MAX_PREVIEW): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

export interface FormattedEvent {
  text: string;
  color: number;
}

const COLOR_GREEN = 0x00cc00;
const COLOR_RED = 0xcc0000;
const COLOR_GREY = 0x888888;

/** Format a stream event for Discord display. Returns null to skip. */
export function formatStreamEvent(event: NodeStreamEventParams): FormattedEvent | null {
  switch (event.eventType) {
    case "text":
      return event.text ? { text: event.text, color: COLOR_GREY } : null;

    case "tool_call": {
      const input = event.toolInput || {};
      let detail = "";
      if (event.toolName === "Bash" || event.toolName === "bash") {
        detail = `\`${truncate(String(input.command ?? ""), 150)}\``;
      } else if (event.toolName === "Write" || event.toolName === "Edit" || event.toolName === "Read") {
        detail = `\`${input.file_path}\``;
      } else {
        detail = truncate(JSON.stringify(input), 150);
      }
      return { text: `🔧 **${event.toolName}** ${detail}`, color: COLOR_GREY };
    }

    case "tool_result": {
      if (!event.toolResult) return null;
      const trimmed = event.toolResult.trim();
      if (!trimmed) return null;
      return { text: `\`\`\`\n${truncate(trimmed, 200)}\n\`\`\``, color: COLOR_GREY };
    }

    case "error":
      return { text: `❌ ${truncate(event.text ?? "unknown", 200)}`, color: COLOR_RED };

    case "session_start":
      return { text: `🟢 ${event.text ?? "Session started"}`, color: COLOR_GREEN };

    case "session_end":
      return null; // Don't post session_end to Discord

    default:
      return null;
  }
}
