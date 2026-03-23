/** Parse "@shortId message" prefix. Returns [targetShortId, message] or [undefined, original] */
export function parseTargetPrefix(text: string): [string | undefined, string] {
  const match = text.match(/^@([0-9a-f]{4})\s+([\s\S]*)$/);
  if (match) {
    return [match[1], match[2]];
  }
  return [undefined, text];
}

/** Strip Discord @mention from message. Returns [isMention, strippedText] */
export function parseMention(content: string, botId: string): [boolean, string] {
  const regex = new RegExp(`^<@!?${botId}>\\s*`);
  const isMention = regex.test(content);
  const text = content.replace(regex, "").trim();
  return [isMention, text];
}
