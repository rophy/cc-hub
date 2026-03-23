/** Convert a folder name to a valid Discord channel name: lowercase a-z, 0-9, hyphens, underscores */
export function toDiscordChannelName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/\s+/g, "-")       // spaces to hyphens
    .replace(/[^a-z0-9\-_]/g, "") // strip invalid chars
    .replace(/-{2,}/g, "-")     // collapse consecutive hyphens
    .replace(/^-|-$/g, "");     // trim leading/trailing hyphens
  return sanitized || "unnamed";
}
