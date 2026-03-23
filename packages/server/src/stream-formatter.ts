import type { NodeStreamEventParams } from "@cc-hub/shared";

const MAX_PREVIEW = 300;

function truncate(text: string, max = MAX_PREVIEW): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/** Format a stream event for Discord display. Returns null to skip. */
export function formatStreamEvent(event: NodeStreamEventParams): string | null {
  switch (event.eventType) {
    case "text":
      return event.text || null;

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
      return `🔧 **${event.toolName}** ${detail}`;
    }

    case "tool_result": {
      if (!event.toolResult) return null;
      const trimmed = event.toolResult.trim();
      if (!trimmed) return null;
      if (trimmed.length <= 200) {
        return `\`\`\`\n${trimmed}\n\`\`\``;
      }
      return `\`\`\`\n${truncate(trimmed, 200)}\n\`\`\``;
    }

    case "error":
      return `❌ **Error**: ${truncate(event.text ?? "unknown", 200)}`;

    case "session_start":
      return `🟢 *${event.text ?? "Session started"}*`;

    case "session_end":
      return `🔴 *${event.text ?? "Session ended"}*`;

    default:
      return null;
  }
}
