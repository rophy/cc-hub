# cc-hub Design

## Overview

cc-hub bridges messaging platforms (Discord, Slack) to Claude Code sessions, enabling mobile-friendly interaction with CC through chat platforms.

A single Discord/Slack bot serves multiple CC sessions across multiple machines. This is necessary because Discord limits bot connections — running one bot per CC session does not scale.

## Two Modes

cc-hub supports two distinct modes of operation:

### Mode A: Terminal-driven (channel plugin)

The user starts CC in a terminal with the cc-hub channel plugin. Discord acts as a side channel — Discord users can send messages that Claude receives and replies to via the `reply` tool. Terminal prompts and Claude's text responses stay local to the terminal.

```
Terminal ←──stdio──→ CC session ←──stdio──→ cc-plugin ←──WS──→ Server ←──→ Discord
  (local)              (local)              (MCP relay)
```

**Use case**: Developer working locally, wants to receive messages or delegate tasks via Discord while maintaining full terminal access.

**Limitation**: Discord only sees messages explicitly sent via the channel. Claude's text responses to terminal prompts are not visible in Discord — CC hooks cannot capture assistant text output (open feature request [#37243](https://github.com/anthropics/claude-code/issues/37243)).

### Mode B: Discord-driven (headless)

Discord initiates the CC session. The node-agent spawns CC in headless mode (`-p` flag with `--output-format stream-json`). All output — text responses, tool calls, results — is captured and streamed to Discord. Follow-up messages use `--continue`/`--resume` for session continuity.

```
Discord ←──→ Server ←──WS──→ Node-agent ──spawns──→ claude -p "..." --output-format stream-json
                                  │
                                  └── parses stream-json → sends to Server → Discord
```

**Use case**: Mobile access, remote work, fully Discord-native experience. No terminal needed.

**Advantage**: Complete output mirroring — everything Claude produces is visible in Discord.

### Comparison

| | Mode A (terminal-driven) | Mode B (Discord-driven) |
|---|---|---|
| Who starts CC | User in terminal | Discord user via bot command |
| CC process | Long-lived, interactive | One per message (headless), uses `--continue` |
| Terminal access | Full | None |
| Discord sees | Channel messages only | Everything (text, tools, results) |
| Claude's text responses | Terminal only | Streamed to Discord |
| Tool activity | Not visible in Discord | Streamed to Discord |

Both modes can coexist in the same Discord channel — a terminal session (Mode A) and a headless session (Mode B) can run simultaneously in the same project channel.

## Components

```
                          ┌─────────────────┐
                          │     Server       │
Discord/Slack ←──────────→│  (API + routing) │
                          └───────┬─────────┘
                                  │ WebSocket
                    ┌─────────────┼─────────────┐
                    │             │              │
              ┌─────┴──────┐ ┌───┴────┐   ┌─────┴──────┐
              │ cc-plugin   │ │cc-plugin│   │ node-agent │
              │ (Mode A)    │ │(Mode A)│   │ (Mode B)   │
              └─────┬──────┘ └───┬────┘   └────────────┘
                    │            │
              CC Session 1  CC Session 2       Machine B
                   Machine A
```

### server

Central API layer. Exposes WebSocket endpoints.

Responsibilities:
- Accepts WebSocket connections from cc-plugins and node-agents
- Provides a chatbot interface that messaging platforms implement (Discord, Slack, etc.)
- Routes messages between platform channels and cc-plugin/node-agent connections
- Manages session-to-channel mappings
- Enforces access control

### cc-plugin (Mode A)

A Claude Code channel plugin. Spawned by CC as an MCP server over stdio.

Responsibilities:
- Speaks MCP to Claude Code (stdio transport)
- Connects to the server via WebSocket
- Relays user messages from server → CC via `notifications/claude/channel`
- Exposes a `reply` tool that sends CC responses back to the server
- Stateless and lightweight — pure message relay

The cc-plugin does not depend on node-agent. Users can always launch CC directly:
```
claude --dangerously-load-development-channels server:cc-hub
```

### node-agent (Mode B)

A long-lived process running on a machine capable of hosting CC sessions.

Responsibilities:
- Connects to the server via WebSocket
- Receives commands to start/stop CC sessions
- Spawns CC in headless mode (`claude -p "..." --output-format stream-json`)
- Parses stream-json output and sends all events to the server
- Manages session continuity via `--continue`/`--resume`
- Reports machine and session status

The node-agent is required for Mode B. It is not needed for Mode A.

## Project Structure

```
cc-hub/
  shared/       # Message types, Zod schemas, shared protocol definitions
  server/       # API layer + chatbot interface implementations
  cc-plugin/    # CC channel plugin (MCP server + WebSocket client)
  node-agent/   # Machine-level orchestration agent + headless CC manager
```

## Protocol

### Transport

- **WebSocket** for all server ↔ cc-plugin and server ↔ node-agent communication
- Works across machines, through firewalls
- Built-in framing (no manual message delimiting)
- TLS for encryption over the network

### Wire Format

**JSON-RPC 2.0** over WebSocket. Both cc-plugin and node-agent connect to the same server endpoint. Message types are namespaced to distinguish the two protocols.

#### cc-plugin methods (Mode A)

Relay messages between a chat platform and a CC session.

| Method | Direction | Description |
|--------|-----------|-------------|
| `cc.message` | server → plugin | User message from chat platform |
| `cc.reply` | plugin → server | CC response back to chat platform |

#### node-agent methods (Mode B)

Orchestration and output streaming for headless CC sessions.

| Method | Direction | Description |
|--------|-----------|-------------|
| `node.start_session` | server → agent | Launch a new headless CC session |
| `node.stop_session` | server → agent | Terminate a CC session |
| `node.send_message` | server → agent | Send a follow-up message to a session |
| `node.stream_event` | agent → server | Streamed output event (text, tool call, result) |
| `node.session_status` | both | Query or report session state |
| `node.heartbeat` | agent → server | Periodic liveness signal |

### Connection Lifecycle

1. cc-plugin or node-agent connects to server via WebSocket
2. Sends an `identify` message declaring its type (`cc-plugin` or `node-agent`) and credentials
3. Server authenticates and registers the connection
4. For cc-plugin: server maps the connection to a chat platform channel
5. Messages flow bidirectionally until disconnect

## Message Flow

### Mode A: User sends a message from Discord (terminal-driven)

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

### Mode B: User sends a message from Discord (headless)

```
User types in Discord #proj-a
  → Server receives message via Discord bot
  → Server looks up route: #proj-a → node-agent managing session A
  → Server sends JSON-RPC node.send_message over WebSocket
  → Node-agent runs: claude -p "user's message" --continue --output-format stream-json
  → Node-agent parses stream-json events as they arrive
  → For each event (text chunk, tool call, result):
    → Node-agent sends JSON-RPC node.stream_event over WebSocket
    → Server formats and sends to Discord #proj-a
  → CC process exits
  → Node-agent reports session idle
```

### Mode B: User starts a CC session from Discord

```
User types "/start proj-a" in Discord
  → Server receives command
  → Server selects a node-agent (or user specifies which)
  → Server sends JSON-RPC node.start_session to the node-agent
  → Node-agent spawns: claude -p "initial prompt" --output-format stream-json --session-id <id>
  → Stream-json output is parsed and forwarded to Discord
  → Session ID is stored for future --continue/--resume
```

### Mode A: User launches CC directly from terminal

```
User runs: claude --dangerously-load-development-channels server:cc-hub
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
- Handle platform commands (e.g., `/start`, `/stop`, `/pair`)

Discord is the first implementation. The interface should be simple enough that adding Slack or other platforms is straightforward.

## Authentication

### Machine Authentication (cc-plugin and node-agent)

Both cc-plugin and node-agent use the same auth model. From the server's perspective, they are both clients connecting from a machine — the difference is capabilities, not trust level.

#### Pairing Flow (first time)

```
Client (cc-plugin or node-agent) connects to server
  → Server returns a pairing code (e.g., "A3F7")
  → Guild admin runs /pair A3F7 in Discord (slash command, admin-only)
  → Server issues a persistent token
  → Client stores token in ~/.cc-hub/config.json
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
| node-agent | Start/stop sessions, stream output, report machine status |

### Platform User Authorization

Discord/Slack handle user identity — the server trusts the platform's user ID. Authorization determines which platform users can interact with which CC sessions.

Options (configurable per deployment):
- **Allowlist** — explicit list of Discord user IDs allowed to interact
- **Role-based** — anyone with a specific Discord role gets access
- **Open** — anyone in the Discord server can use it

## Channel Mapping

Channels are mapped by **project path**. The cc-plugin reads `$PWD` on startup and sends it to the server during `identify`. For Mode B, the project path is specified in the `/start` command. The server maps each unique project path to a chat platform channel.

- `/home/rophy/projects/cc-hub` → `#cc-hub`
- `/home/rophy/projects/api-server` → `#api-server`

If no channel exists for the path, the server creates one.

### Multiple Sessions Per Channel

Multiple CC sessions in the same project directory share the same channel. Each session has a **short random ID** (e.g., `a3f7`) to distinguish itself.

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

## Message Formatting

- **Chunking**: Split long messages at Discord's 2000-char limit, respecting markdown boundaries (don't split mid-code-block)
- **Markdown passthrough**: Claude already formats output as markdown. Discord renders markdown natively. No transformation needed.

## Technology Stack

- **Runtime**: Node.js (all components)
- **Language**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk` (cc-plugin)
- **Discord**: discord.js (server)
- **WebSocket**: ws (server ↔ cc-plugin/node-agent)
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

All three components (server, cc-plugin, node-agent) live in a monorepo managed with npm workspaces.

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

## Design Decisions

### Why not parse CLI output?

Projects like Happy Coder parse Claude CLI stdout to mirror terminal activity. This is fragile — CLI output format is not a stable API, and every CC update can break the parser. cc-hub avoids this by using official interfaces:
- **MCP channel protocol** (Mode A) — documented, stable
- **`--output-format stream-json`** (Mode B) — structured output format designed for programmatic consumption

### Why not CC hooks for activity mirroring?

CC hooks (PostToolUse, PreToolUse, etc.) can capture tool calls but **cannot capture Claude's text responses**. There is no hook event that provides the assistant's response text (open feature request [#37243](https://github.com/anthropics/claude-code/issues/37243)). This makes hooks insufficient for full activity mirroring. Mode B's headless approach with stream-json provides complete output instead.

### Why two modes?

Mode A (channel plugin) is lightweight and non-invasive — it adds Discord as a side channel to an existing terminal workflow. Mode B (headless) provides full mirroring but requires the node-agent and has no terminal access. Different use cases call for different tradeoffs.
