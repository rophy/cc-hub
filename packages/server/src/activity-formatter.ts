import type { HookEvent } from "@cc-hub/shared";

const MAX_PREVIEW = 200;

function truncate(text: string, max = MAX_PREVIEW): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function formatToolInput(event: HookEvent): string {
  const input = event.tool_input;
  if (!input) return "";

  switch (event.tool_name) {
    case "Bash":
      return `\`${truncate(String(input.command ?? ""), 150)}\``;
    case "Write":
      return `\`${input.file_path}\``;
    case "Edit":
      return `\`${input.file_path}\``;
    case "Read":
      return `\`${input.file_path}\``;
    case "Glob":
      return `\`${input.pattern}\`${input.path ? ` in \`${input.path}\`` : ""}`;
    case "Grep":
      return `\`${input.pattern}\`${input.path ? ` in \`${input.path}\`` : ""}`;
    case "WebFetch":
      return `\`${input.url}\``;
    case "WebSearch":
      return `\`${input.query}\``;
    case "Agent":
      return input.description ? String(input.description) : "";
    default:
      // MCP tools
      if (event.tool_name?.startsWith("mcp__")) {
        return truncate(JSON.stringify(input), 150);
      }
      return "";
  }
}

function formatToolResult(result: string): string {
  const trimmed = result.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 100) return trimmed;
  // Show first few lines
  const lines = trimmed.split("\n");
  if (lines.length <= 3) return truncate(trimmed, 200);
  return truncate(lines.slice(0, 3).join("\n"), 200);
}

export function formatHookEvent(event: HookEvent): string | null {
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return `💬 **Prompt**: ${truncate(event.prompt ?? "", 300)}`;

    case "PreToolUse": {
      const input = formatToolInput(event);
      return `🔧 **${event.tool_name}** ${input}`;
    }

    case "PostToolUse": {
      const result = event.tool_result ? formatToolResult(event.tool_result) : "";
      if (!result) return null; // Skip empty results to reduce noise
      return `✅ **${event.tool_name}** → \`\`\`\n${result}\n\`\`\``;
    }

    case "PostToolUseFailure":
      return `❌ **${event.tool_name}** failed: ${truncate(event.error ?? "unknown error", 200)}`;

    case "Stop":
      return `⏹️ *Turn complete*`;

    case "StopFailure":
      return `⚠️ **Error**: ${event.error_type} — ${truncate(event.error_message ?? "", 200)}`;

    case "SessionStart":
      return `🟢 *Session started* (${event.source ?? "unknown"})`;

    case "SessionEnd":
      return `🔴 *Session ended* (${event.reason ?? "unknown"})`;

    case "SubagentStart":
      return `🤖 *Subagent started*: ${event.agent_name ?? event.agent_type ?? "unknown"}`;

    case "SubagentStop":
      return `🤖 *Subagent finished*: ${event.agent_name ?? event.agent_type ?? "unknown"}`;

    default:
      return null; // Skip unknown events
  }
}
