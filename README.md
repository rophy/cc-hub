# cc-hub

A bridge between messaging platforms (Discord, Slack, etc.) and Claude Code sessions.

## Problem

Claude Code is a powerful CLI tool, but interacting with it requires terminal access. Mobile-friendly options are limited. Existing solutions like remote control work but have UX limitations on mobile devices.

## Approach

Use messaging platforms (Discord, Slack) as the UI layer, and Claude Code Channels as the interface to CC sessions. A central server routes messages between platform channels and CC sessions across one or more machines.

## Components

- **server** — Central API that connects messaging platforms to CC sessions
- **cc-plugin** — Claude Code channel plugin that relays messages to/from the server
- **node-agent** — Optional agent for remotely launching and managing CC sessions

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
DISCORD_TOKEN=<your-bot-token> node packages/server/dist/index.js
```

Or with Docker:

```bash
docker build -t cc-hub-server .
docker run -e DISCORD_TOKEN=<your-bot-token> -p 3000:3000 cc-hub-server
```

### 3. Configure the CC Plugin

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

### 4. Start a Claude Code Session

```bash
claude --dangerously-load-development-channels server:cc-hub
```

On first connection, your terminal will show a pairing code:

```
[cc-hub] Pairing required. Ask someone to run in Discord:
  !pair A3F7
Waiting for approval...
```

A guild admin runs `/pair A3F7` in any Discord channel to approve. The token is saved to `~/.cc-hub/config.json` for future connections.

### 5. Chat

Send messages in the Discord channel that was created (named after your project directory). Claude receives them and replies through the same channel.

To target a specific session when multiple are active:

```
@a3f7 what about the tests?
```

## Status

Working prototype. See [docs/design.md](docs/design.md) for architecture details and [docs/multi-guild.md](docs/multi-guild.md) for planned multi-guild support.
