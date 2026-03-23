# cc-hub

## Project Structure

Monorepo with npm workspaces:

- `packages/shared` — JSON-RPC 2.0 types, Zod schemas, client config
- `packages/server` — WebSocket server + Discord bot
- `packages/cc-plugin` — Claude Code channel plugin (MCP server)
- `packages/node-agent` — Remote session launcher (headless CC executor)

## Build

```bash
npm install
npm run build          # builds all workspaces (shared must build first)
```

## Test

Tests are separated by type with distinct vitest configs:

```bash
npm run test:unit          # fast, no external deps
npm run test:integration   # spins up WebSocket server
npm run test:e2e           # full flow (not yet implemented)
```

Always redirect test output to a temp file before grepping.

### Discord Manual Testing

The CC Discord plugin can be used for manual testing against a live cc-hub server. Both the CC Discord bot and cc-hub bot must be in the same guild.

**Prerequisites:**
- cc-hub server running (reads token from `~/.cc-hub/config.json`)
- cc-hub node-agent running
- CC Discord plugin channel `#infra` (ID: `1485410147739238421`) added to `~/.claude/channels/discord/access.json` groups
- cc-hub bot ID: `1485345642011295835`

**Send a message to cc-hub via CC Discord plugin:**
```
mcp__plugin_discord_discord__reply(chat_id="1485410147739238421", text="<@1485345642011295835> your prompt here")
```

**Fetch responses:**
```
mcp__plugin_discord_discord__fetch_messages(channel="1485410147739238421", limit=5)
```

**Important:** The cc-hub bot only ignores its own messages (not all bots), so messages from the CC Discord bot are processed normally.

**Reading bot responses:** Control plane messages (session status, errors, tool calls) are sent as Discord embeds. `fetch_messages` cannot read embed content — it only shows plain text messages (Claude Code responses). To see embed content, check the server logs:
```bash
docker compose logs server --tail=20
```
The server logs each embed via `postStatus` with the text content included.

**Starting server and node-agent for testing:**
```bash
docker compose up -d
docker compose logs -f
```

## cc-plugin Setup (Mode A)

The cc-plugin is a Claude Code [channel plugin](https://code.claude.com/docs/en/channels-reference). It connects a local Claude Code session to cc-hub so Discord users can interact with it.

### 1. Register the MCP server

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "cc-hub": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cc-hub/packages/cc-plugin/dist/index.js"]
    }
  }
}
```

### 2. Start Claude Code with the channel flag

Channel plugins require `--dangerously-load-development-channels` during the research preview. Without this flag, the MCP server connects but channel notifications are silently ignored.

```bash
cd /path/to/your/project
claude --dangerously-load-development-channels server:cc-hub
```

### 3. Verify

Run `/mcp` in the session — cc-hub should show as connected with `experimental/claude/channel` capability.

## Key Conventions

- TypeScript strict mode, ESM (`"type": "module"`)
- Zod for runtime validation of all protocol messages
- JSON-RPC 2.0 over WebSocket between server and clients
- MCP over stdio between Claude Code and cc-plugin
- `--output-format stream-json --verbose` for headless CC (Mode B)
- `--continue` for session continuity in headless mode
- Single session per Discord channel (Mode A or Mode B, not both)
- All Discord interactions require @mention

## Deploy

Uses `docker compose` with two services:

- **server** — built from `packages/server/Dockerfile` (node:22-slim)
- **node-agent** — built from `packages/node-agent/Dockerfile` (ghcr.io/rophy/containers/claude, includes claude CLI)

The server mounts `~/.cc-hub` for state and config. The node-agent mounts `~/.claude` for Claude Code credentials and session data.

### Setup

1. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN` — Discord bot token
   - `CC_HUB_TOKEN` — shared auth token (from `~/.cc-hub/config.json` `token` field)

2. Start:
   ```bash
   docker compose up -d
   ```

3. View logs:
   ```bash
   docker compose logs -f
   ```

4. Stop:
   ```bash
   docker compose down
   ```

### Rebuild after code changes

```bash
docker compose up -d --build
```
