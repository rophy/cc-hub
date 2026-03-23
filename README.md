# cc-hub

A bridge between messaging platforms (Discord, Slack, etc.) and Claude Code sessions.

## Problem

Claude Code is a powerful CLI tool, but interacting with it requires terminal access. Mobile-friendly options are limited. Existing solutions like remote control work but have UX limitations on mobile devices.

## Approach

Use messaging platforms (Discord, Slack) as the UI layer for Claude Code sessions. cc-hub supports two modes:

- **Mode A (terminal-driven)**: User starts CC in a terminal with the cc-hub channel plugin. Discord acts as a side channel for messaging.
- **Mode B (Discord-driven)**: User @mentions the bot in Discord. CC runs in headless mode with full output streamed to Discord.

## Components

- **server** — Central API that connects Discord to CC sessions
- **cc-plugin** — Claude Code channel plugin for Mode A (terminal-driven)
- **node-agent** — Headless CC executor for Mode B (Discord-driven)

See [docs/design.md](docs/design.md) for architecture details.

## Setup

### Prerequisites

- Node.js 22+

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name, then click **Create**
3. Go to **Bot** in the left sidebar
4. Click **Reset Token** → copy the token (you won't be able to see it again)
5. Enable **Message Content Intent** under Privileged Gateway Intents
6. Go to **Installation** in the left sidebar
7. Under **Default Install Settings → Guild Install**, add scopes: `bot`, `applications.commands`
8. Add bot permissions: `Send Messages`, `Manage Channels`
9. Copy the install link and open it to invite the bot to your Discord server

### 2. Start the Server

```bash
git clone https://github.com/rophy/cc-hub.git
cd cc-hub
npm install
npm run build
```

Save your Discord bot token to `~/.cc-hub/config.json`:

```json
{
  "discordToken": "<your-bot-token>"
}
```

Then start the server:

```bash
node packages/server/dist/index.js
```

Or with Docker (pass token via env var):

```bash
docker build -t cc-hub-server .
docker run -e DISCORD_TOKEN=<your-bot-token> -p 3000:3000 cc-hub-server
```

### 3. Pairing

On first connection from a cc-plugin or node-agent, the terminal shows a pairing code:

```
[cc-hub] Pairing required. DM the bot or run in Discord:
  /pair A3F7
Waiting for approval...
```

A guild admin runs `/pair A3F7` in any Discord channel to approve. The token is saved to `~/.cc-hub/config.json` for future connections.

### 4. Mode A: Terminal-driven

Add the cc-hub MCP server to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "cc-hub": {
      "command": "node",
      "args": ["/path/to/cc-hub/packages/cc-plugin/dist/index.js"]
    }
  }
}
```

Start a CC session with the channel plugin:

```bash
claude --dangerously-load-development-channels server:cc-hub
```

The server creates a Discord channel named after your project directory. @mention the bot in that channel to send messages to Claude.

### 5. Mode B: Discord-driven (headless)

Start the node-agent on a machine with Claude Code installed:

```bash
node packages/node-agent/dist/index.js
```

Then @mention the bot in any mapped Discord channel:

```
@cc-hub fix the auth bug
```

The node-agent runs `claude -p "fix the auth bug" --continue` in headless mode. All output (text, tool calls, results) is streamed to the Discord channel. Follow-up @mentions continue the same conversation via `--continue`.

### Interaction Rules

- **@mention required** — all messages to the bot require @mention
- **Single session per channel** — only one CC session (Mode A or B) can be active per channel at a time

## Status

Working prototype. See [docs/design.md](docs/design.md) for architecture details and [docs/multi-guild.md](docs/multi-guild.md) for planned multi-guild support.
