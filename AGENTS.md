# cc-hub

## Project Structure

Monorepo with npm workspaces:

- `packages/shared` — JSON-RPC 2.0 types, Zod schemas, client config
- `packages/server` — WebSocket server + Discord bot
- `packages/cc-plugin` — Claude Code channel plugin (MCP server)
- `packages/node-agent` — Remote session launcher

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

## Key Conventions

- TypeScript strict mode, ESM (`"type": "module"`)
- Zod for runtime validation of all protocol messages
- JSON-RPC 2.0 over WebSocket between server and clients
- MCP over stdio between Claude Code and cc-plugin

## Docker

```bash
docker build -t cc-hub-server .
docker run -e DISCORD_TOKEN=... cc-hub-server
```
