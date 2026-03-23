import {
  Client,
  GatewayIntentBits,
  ChannelType,
  SlashCommandBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  type TextChannel,
  type Message,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Router } from "./router.js";
import type { AuthManager } from "./auth.js";

const MAX_MESSAGE_LENGTH = 2000;

export interface DiscordBotEvents {
  /** Called when a user sends a message to an active session */
  onUserMessage(
    channelName: string,
    from: string,
    text: string,
    messageId: string,
  ): void;
  /** Called when a user @mentions the bot and no session exists — start headless */
  onStartHeadless(
    channelName: string,
    projectPath: string,
    prompt: string,
  ): Promise<{ ok: boolean; shortId?: string; error?: string }>;
  /** Check if a channel has an active session (Mode A or B) */
  hasActiveSession(channelName: string): boolean;
}

export interface DiscordBotHandle {
  destroy(): void;
  /** Send a message to a Discord channel, prefixed with session short ID */
  sendReply(channelName: string, shortId: string, text: string): Promise<void>;
  /** Post a status message */
  postStatus(channelName: string, text: string): Promise<void>;
}

export async function createDiscordBot(
  token: string,
  router: Router,
  auth: AuthManager,
  events: DiscordBotEvents,
): Promise<DiscordBotHandle> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Slash command: /pair (admin only)
  const pairCommand = new SlashCommandBuilder()
    .setName("pair")
    .setDescription("Pair a cc-hub client with this guild")
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("The 4-character pairing code shown in your terminal")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "pair") {
      await handlePairCommand(interaction);
    }
  });

  async function handlePairCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const code = interaction.options.getString("code", true).toUpperCase();

    if (!/^[0-9A-F]{4}$/.test(code)) {
      await interaction.reply({
        content: "Invalid pairing code. Must be 4 hex characters (e.g., A3F7).",
        ephemeral: true,
      });
      return;
    }

    const result = auth.confirmPairing(code);
    if (result) {
      await interaction.reply({
        content: "Pairing confirmed. Token has been sent to the client.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `Unknown or expired pairing code: ${code}`,
        ephemeral: true,
      });
    }
  }

  // Handle messages — @mention to interact with sessions
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    const channel = message.channel as TextChannel;
    const channelName = channel.name;

    // Check if this is a mapped channel
    const discordId = router.getDiscordChannelId(channelName);

    // Strip @mention prefix to get the actual message
    const botId = client.user?.id;
    const mentionRegex = botId ? new RegExp(`^<@!?${botId}>\\s*`) : null;
    const isMention = mentionRegex ? mentionRegex.test(message.content) : false;
    const text = mentionRegex
      ? message.content.replace(mentionRegex, "").trim()
      : message.content.trim();

    // Require @mention for all interactions
    if (!isMention) return;
    if (!text) return;

    const from = message.author.displayName || message.author.username;

    // If channel has an active session, route the message
    if (discordId && events.hasActiveSession(channelName)) {
      events.onUserMessage(channelName, from, text, message.id);
      return;
    }

    // No active session — start headless Mode B
    {
      // Look up project path from channel mapping
      const projectPath = getProjectPathForChannel(channelName);
      if (!projectPath) {
        await message.reply("No project path mapped for this channel. Use a channel created by cc-hub.");
        return;
      }

      const result = await events.onStartHeadless(channelName, projectPath, text);
      if (!result.ok) {
        await message.reply(`Failed to start session: ${result.error}`);
      }
      // Success — stream events will appear in this channel
      return;
    }

    // Not a mention and no active session — ignore
  });

  function getProjectPathForChannel(channelName: string): string | undefined {
    return router.getProjectPathForChannel(channelName);
  }

  await client.login(token);

  // Register slash commands
  const rest = new REST().setToken(token);
  const appId = client.application?.id;
  if (appId) {
    await rest.put(Routes.applicationCommands(appId), {
      body: [pairCommand.toJSON()],
    });
  }

  async function findOrCreateChannel(channelName: string): Promise<TextChannel | null> {
    const existingId = router.getDiscordChannelId(channelName);
    if (existingId) {
      const ch = await client.channels.fetch(existingId).catch(() => null);
      if (ch && ch.type === ChannelType.GuildText) return ch as TextChannel;
    }

    const guild = client.guilds.cache.first();
    if (!guild) return null;

    const existing = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === channelName,
    ) as TextChannel | undefined;

    if (existing) {
      router.setDiscordChannelId(channelName, existing.id);
      return existing;
    }

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
      await channel.send(text);
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

    let splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) {
      splitAt = MAX_MESSAGE_LENGTH;
    }

    const chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

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
