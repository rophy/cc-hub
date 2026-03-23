/** Parse a single line of stream-json output from Claude Code */
export interface StreamJsonEvent {
  type: string;
  subtype?: string;
  session_id?: string;

  // assistant message
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
  };

  // result
  result?: string;
  is_error?: boolean;

  // system init
  cwd?: string;
  tools?: string[];

  // tool result content block
  content?: Array<{
    type: string;
    text?: string;
  }>;

  // error
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
