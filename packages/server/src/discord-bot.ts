import {
  Client,
  GatewayIntentBits,
  ChannelType,
  type TextChannel,
  type Message,
} from "discord.js";
import type { Router } from "./router.js";

const MAX_MESSAGE_LENGTH = 2000;

export interface DiscordBotEvents {
  /** Called when a user sends a message in a mapped channel */
  onUserMessage(
    channelName: string,
    from: string,
    text: string,
    messageId: string,
  ): void;
}

export interface DiscordBotHandle {
  destroy(): void;
  /** Send a message to a Discord channel, prefixed with session short ID */
  sendReply(channelName: string, shortId: string, text: string): Promise<void>;
  /** Post a status message (e.g., session connected/ended) */
  postStatus(channelName: string, text: string): Promise<void>;
}

export async function createDiscordBot(
  token: string,
  router: Router,
  events: DiscordBotEvents,
): Promise<DiscordBotHandle> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on("messageCreate", (message: Message) => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const channel = message.channel as TextChannel;
    const channelName = channel.name;

    // Only handle messages in mapped channels
    const discordId = router.getDiscordChannelId(channelName);
    if (!discordId) return;

    const from = message.author.displayName || message.author.username;
    events.onUserMessage(channelName, from, message.content, message.id);
  });

  await client.login(token);

  async function findOrCreateChannel(channelName: string): Promise<TextChannel | null> {
    // Check if we already have a mapped channel ID
    const existingId = router.getDiscordChannelId(channelName);
    if (existingId) {
      const ch = await client.channels.fetch(existingId).catch(() => null);
      if (ch && ch.type === ChannelType.GuildText) return ch as TextChannel;
    }

    // Find by name in the first guild
    const guild = client.guilds.cache.first();
    if (!guild) return null;

    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === channelName,
    ) as TextChannel | undefined;

    if (existing) {
      router.setDiscordChannelId(channelName, existing.id);
      return existing;
    }

    // Create the channel
    const created = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
    });
    router.setDiscordChannelId(channelName, created.id);
    return created;
  }

  return {
    destroy() {
      client.destroy();
    },

    async sendReply(channelName, shortId, text) {
      const channel = await findOrCreateChannel(channelName);
      if (!channel) return;

      const prefixed = `**[${shortId}]** ${text}`;
      const chunks = chunkMessage(prefixed);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    },

    async postStatus(channelName, text) {
      const channel = await findOrCreateChannel(channelName);
      if (!channel) return;
      await channel.send(`*${text}*`);
    },
  };
}

/** Split text into chunks respecting Discord's message limit and code blocks */
export function chunkMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline before the limit
    let splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) {
      splitAt = MAX_MESSAGE_LENGTH;
    }

    const chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    // Handle split code blocks — if chunk has odd number of ```, close it
    const backtickCount = (chunk.match(/```/g) || []).length;
    if (backtickCount % 2 !== 0) {
      chunks.push(chunk + "\n```");
      remaining = "```\n" + remaining;
    } else {
      chunks.push(chunk);
    }
  }

  return chunks;
}
