/** Parse "@shortId message" prefix. Returns [targetShortId, message] or [undefined, original] */
export function parseTargetPrefix(text: string): [string | undefined, string] {
  const match = text.match(/^@([0-9a-f]{4})\s+([\s\S]*)$/);
  if (match) {
    return [match[1], match[2]];
  }
  return [undefined, text];
}
