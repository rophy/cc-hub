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

### Discord E2E Testing

The CC Discord plugin can be used for e2e testing against a live cc-hub server. Both the CC Discord bot and cc-hub bot must be in the same guild.

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

**Starting server and node-agent for testing:**
```bash
# Server (reads discordToken from ~/.cc-hub/config.json)
node packages/server/dist/index.js &

# Node-agent
node packages/node-agent/dist/index.js &
```

## Key Conventions

- TypeScript strict mode, ESM (`"type": "module"`)
- Zod for runtime validation of all protocol messages
- JSON-RPC 2.0 over WebSocket between server and clients
- MCP over stdio between Claude Code and cc-plugin
- `--output-format stream-json --verbose` for headless CC (Mode B)
- `--continue` for session continuity in headless mode
- Single session per Discord channel (Mode A or Mode B, not both)
- All Discord interactions require @mention

## Docker

```bash
docker build -t cc-hub-server .
docker run -e DISCORD_TOKEN=... cc-hub-server
```
