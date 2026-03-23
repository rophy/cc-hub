/** Parse a single line of stream-json output from Claude Code */
export interface StreamJsonEvent {
  type: string;
  session_id?: string;
  event?: {
    delta?: {
      type: string;
      text?: string;
      name?: string;
      tool_id?: string;
      input?: Record<string, unknown>;
      content?: string;
    };
  };
  // System events
  subtype?: string;
  error?: string;
}

export function parseStreamLine(line: string): StreamJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamJsonEvent;
  } catch {
    return null;
  }
}
