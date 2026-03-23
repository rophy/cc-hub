# cc-hub Design

## Overview

cc-hub bridges messaging platforms (Discord, Slack) to Claude Code sessions, enabling mobile-friendly interaction with CC through chat platforms.

A single Discord/Slack bot serves multiple CC sessions across multiple machines. This is necessary because Discord limits bot connections — running one bot per CC session does not scale.

## Components

```
                          ┌─────────────────┐
                          │     Server       │
Discord/Slack ←──HTTP────→│  (API + routing) │
                          └───────┬─────────┘
                                  │ WebSocket
                    ┌─────────────┼─────────────┐
                    │             │              │
              ┌─────┴──────┐ ┌───┴────┐   ┌─────┴──────┐
              │ cc-plugin   │ │cc-plugin│   │ node-agent │
              │ (MCP↔WS)   │ │(MCP↔WS)│   │ (orchestr.)│
              └─────┬──────┘ └───┬────┘   └────────────┘
                    │            │
              CC Session 1  CC Session 2       Machine B
                   Machine A
```

### server

Central API layer. Exposes HTTP and WebSocket endpoints.

Responsibilities:
- Accepts WebSocket connections from cc-plugins and node-agents
- Provides a chatbot interface that messaging platforms implement (Discord, Slack, etc.)
- Routes messages between platform channels and cc-plugin connections
- Manages session-to-channel mappings
- Enforces access control

The server does not know how to spawn CC sessions — it delegates that to node-agents.

### cc-plugin

A Claude Code channel plugin. Spawned by CC as an MCP server over stdio.

Responsibilities:
- Speaks MCP to Claude Code (stdio transport)
- Connects to the server via WebSocket
- Relays user messages from server → CC via `notifications/claude/channel`
- Exposes a `reply` tool that sends CC responses back to the server
- Stateless and lightweight — pure message relay

The cc-plugin does not depend on node-agent. Users can always launch CC directly:
```
claude --channels cc-hub-plugin
```

### node-agent

A long-lived process running on a machine capable of hosting CC sessions.

Responsibilities:
- Connects to the server via WebSocket
- Receives commands to start/stop CC sessions
- Reports machine and session status
- Manages working directories and session configuration

The node-agent is optional. It is only needed when users want to launch CC sessions remotely (e.g., from a Discord command).

## Project Structure

```
cc-hub/
  shared/       # Message types, Zod schemas, shared protocol definitions
  server/       # API layer + chatbot interface implementations
  cc-plugin/    # CC channel plugin (MCP server + WebSocket client)
  node-agent/   # Machine-level orchestration agent
```

## Protocol

### Transport

- **WebSocket** for all server ↔ cc-plugin and server ↔ node-agent communication
- Works across machines, through firewalls
- Built-in framing (no manual message delimiting)
- TLS for encryption over the network

### Wire Format

**JSON-RPC 2.0** over WebSocket. Both cc-plugin and node-agent connect to the same server endpoint. Message types are namespaced to distinguish the two protocols.

#### cc-plugin methods

Relay messages between a chat platform and a CC session.

| Method | Direction | Description |
|--------|-----------|-------------|
| `cc.message` | server → plugin | User message from chat platform |
| `cc.reply` | plugin → server | CC response back to chat platform |
| `cc.turn_start` | plugin → server | CC started processing |
| `cc.turn_end` | plugin → server | CC finished processing |

#### node-agent methods

Orchestration commands for managing CC sessions on a machine.

| Method | Direction | Description |
|--------|-----------|-------------|
| `node.start_session` | server → agent | Launch a new CC session |
| `node.stop_session` | server → agent | Terminate a CC session |
| `node.session_status` | both | Query or report session state |
| `node.heartbeat` | agent → server | Periodic liveness signal |

### Connection Lifecycle

1. cc-plugin or node-agent connects to server via WebSocket
2. Sends an `identify` message declaring its type (`cc-plugin` or `node-agent`) and credentials
3. Server authenticates and registers the connection
4. For cc-plugin: server maps the connection to a chat platform channel
5. Messages flow bidirectionally until disconnect

## Message Flow

### User sends a message from Discord

```
User types in Discord #proj-a
  → Server receives message via Discord bot
  → Server looks up route: #proj-a → cc-plugin connection for session A
  → Server sends JSON-RPC cc.message over WebSocket
  → cc-plugin receives it
  → cc-plugin pushes MCP notification to CC session
  → Claude processes and calls the reply tool
  → cc-plugin sends JSON-RPC cc.reply over WebSocket
  → Server receives reply
  → Server sends message to Discord #proj-a
```

### User launches a CC session from Discord

```
User types "/start proj-a" in Discord
  → Server receives command
  → Server selects a node-agent (or user specifies which)
  → Server sends JSON-RPC node.start_session to the node-agent
  → Node-agent runs: claude --channels cc-hub-plugin ...
  → CC starts and spawns cc-plugin as a child process
  → cc-plugin connects to server via WebSocket and identifies itself
  → Server maps Discord channel ↔ this cc-plugin connection
  → Server confirms to Discord: "Session started in #proj-a"
```

### User launches CC directly from terminal

```
User runs: claude --channels cc-hub-plugin
  → CC spawns cc-plugin
  → cc-plugin connects to server via WebSocket
  → Server assigns or creates a channel mapping
  → Messages flow between the platform channel and this CC session
```

## Chatbot Interface

The server defines a platform-agnostic chatbot interface. Each messaging platform (Discord, Slack) implements this interface.

Responsibilities of a chatbot implementation:
- Connect to the platform (Discord Gateway, Slack RTM, etc.)
- Receive messages and translate them to internal format
- Send replies back to the platform, handling platform-specific constraints (e.g., Discord 2000-char message limit, chunking, code block formatting)
- Handle platform commands (e.g., `/start`, `/stop`)

Discord is the first implementation. The interface should be simple enough that adding Slack or other platforms is straightforward.

## Authentication

### Machine Authentication (cc-plugin and node-agent)

Both cc-plugin and node-agent use the same auth model. From the server's perspective, they are both clients connecting from a machine — the difference is capabilities, not trust level.

#### Pairing Flow (first time)

```
Client (cc-plugin or node-agent) connects to server
  → Server returns a pairing code (e.g., "A3F7")
  → User confirms the code in Discord (e.g., bot DM or command)
  → Server issues a persistent token
  → Client stores token in ~/.cc-hub/credentials
```

#### Subsequent Connections

```
Client connects to server with stored token
  → Server validates token
  → Server grants capabilities based on client type
```

#### Token Reuse

A machine running both a node-agent and CC sessions pairs once. The node-agent's token can be reused by cc-plugins it spawns (same machine, same user), avoiding repeated pairing for every new session.

#### Capabilities by Client Type

| Client type | Capabilities |
|---|---|
| cc-plugin | Send/receive messages for its session |
| node-agent | Start/stop sessions, report machine status |

### Platform User Authorization

Discord/Slack handle user identity — the server trusts the platform's user ID. Authorization determines which platform users can interact with which CC sessions.

Options (configurable per deployment):
- **Allowlist** — explicit list of Discord user IDs allowed to interact
- **Role-based** — anyone with a specific Discord role gets access
- **Open** — anyone in the Discord server can use it

## Channel Mapping

Channels are mapped by **project path**. The cc-plugin reads `$PWD` on startup and sends it to the server during `identify`. The server maps each unique project path to a chat platform channel.

- `/home/rophy/projects/cc-hub` → `#cc-hub`
- `/home/rophy/projects/api-server` → `#api-server`

If no channel exists for the path, the server creates one.

### Multiple Sessions Per Channel

Multiple CC sessions in the same project directory share the same channel. Each cc-plugin generates a **short random ID** (e.g., `a3f7`) on startup to distinguish itself.

Replies in Discord are prefixed with the session ID:
```
[a3f7] I found the bug in auth.ts...
[b2c1] The API docs say this endpoint expects...
```

To send a message to a specific session, users prefix with the ID:
```
@a3f7 what about the tests?
```

Messages without a prefix are broadcast to all sessions in the channel.

### Limitations

Claude Code does not expose its session/conversation ID to MCP servers (channel plugins). There is no env var, no hook mechanism, and no MCP method to discover it. This is a known gap with open feature requests ([#17188](https://github.com/anthropics/claude-code/issues/17188), [#25642](https://github.com/anthropics/claude-code/issues/25642)). Using `$PWD` avoids this limitation entirely.

## State Persistence

Server state is stored in a JSON config file in the user's home directory (e.g., `~/.cc-hub/state.json`). This includes:
- Project path → channel mappings
- Paired machine tokens
- Platform user allowlists

A single server process reads/writes this file — no concurrent access concerns. Atomic writes (write to temp file, rename) prevent corruption on crash.

## Activity Mirroring

cc-hub mirrors CC session activity to Discord using two mechanisms:

### Channel Plugin (bidirectional messaging)

The cc-plugin handles user ↔ Claude conversation via MCP channel notifications and the `reply` tool.

### Hooks (activity streaming)

CC hooks (an official, stable interface) stream session activity to the server via HTTP POST. This gives Discord visibility into everything Claude is doing — not just channel messages.

The server exposes an HTTP endpoint at `POST /hooks/activity` that receives hook events and forwards them to the appropriate Discord channel based on `cwd`.

#### Supported hook events

| Event | What Discord sees |
|---|---|
| UserPromptSubmit | User's prompt text |
| PreToolUse | Tool about to execute (name + args) |
| PostToolUse | Tool result (output preview) |
| PostToolUseFailure | Tool error message |
| Stop | Turn complete indicator |
| SessionStart/End | Session lifecycle |
| SubagentStart/Stop | Subagent activity |

#### Hook configuration

Users configure hooks in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3001/hooks/activity" }] }],
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3001/hooks/activity" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3001/hooks/activity" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3001/hooks/activity" }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3001/hooks/activity" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:3001/hooks/activity" }] }]
  }
}
```

#### Why hooks instead of CLI output parsing

Projects like Happy Coder parse Claude CLI stdout to mirror activity. This is fragile — CLI output format is not a stable API, and every CC update can break the parser. Hooks are an official, documented interface with structured JSON input, designed for external integrations.

## Message Formatting

- **Chunking**: Split long messages at Discord's 2000-char limit, respecting markdown boundaries (don't split mid-code-block)
- **Markdown passthrough**: Claude already formats output as markdown. Discord renders markdown natively. No transformation needed.

## Technology Stack

- **Runtime**: Node.js (all components)
- **Language**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk` (cc-plugin)
- **Discord**: discord.js (server)
- **WebSocket**: ws or Socket.IO (server ↔ cc-plugin/node-agent)
- **Validation**: Zod (shared message schemas)
- **Testing**: Vitest (separate configs for unit, integration, and e2e)

### Test Structure

Tests are organized by type within each package, with separate Vitest configs so they can be run independently:

```
packages/<package>/tests/
  unit/           # Pure logic, no external deps, fast
  integration/    # Component interaction (WebSocket, mock clients)
  e2e/            # Full flow across components
```

Scripts at the root level:
```bash
npm run test:unit          # All unit tests across packages
npm run test:integration   # All integration tests
npm run test:e2e           # All e2e tests
```

All three components (server, cc-plugin, node-agent) live in a monorepo managed with npm workspaces or similar.

Note: Claude Code's official channel plugins use Bun, but this is a choice not a requirement. Any Node.js-compatible runtime works.

## Deployment

The server runs as a Docker container. It needs to be always-on to maintain the Discord bot connection.

cc-plugin and node-agent run as bare processes on the developer's machine — no containerization needed.

## Reconnection

No message buffering. If a cc-plugin or node-agent is disconnected, messages sent during the gap are lost.

| Event | Behavior |
|---|---|
| CC session exits normally | Plugin dies. Server posts `[a3f7] session ended` in channel. |
| Network blip | Plugin auto-reconnects with same short ID. Server re-links to channel. |
| Server restarts | All connections drop. Clients reconnect. Server reloads state from JSON file. |
| Node-agent disconnects | Server marks node as offline. Pending `start_session` commands fail with error. |

## Access Control

A single server instance maps to a single Discord guild (server). Any user who can see a channel can send messages to the CC sessions in that channel. Access is controlled entirely by Discord's native channel permissions.

Fine-grained roles (reader vs. speaker) can be added as a future enhancement.
