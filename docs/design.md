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

Users @mention the bot in a mapped channel. The node-agent spawns CC in headless mode (`claude -p "..." --continue --output-format stream-json --verbose`). All output — text responses, tool calls, results — is captured and streamed to Discord. Each message is a separate `claude -p` invocation; `--continue` preserves conversation context across invocations.

```
Discord user @mentions bot
  → Server ←──WS──→ Node-agent ──spawns──→ claude -p "..." --continue --output-format stream-json --verbose
                          │
                          └── parses stream-json → sends to Server → Discord
                          └── process exits → notifies Server → channel freed
```

**Use case**: Mobile access, remote work, fully Discord-native experience. No terminal needed.

**Advantage**: Complete output mirroring — everything Claude produces is visible in Discord.

### Comparison

| | Mode A (terminal-driven) | Mode B (Discord-driven) |
|---|---|---|
| Who starts CC | User in terminal | User @mentions bot |
| CC process | Long-lived, interactive | One per message (headless), uses `--continue` |
| Terminal access | Full | None |
| Discord sees | Channel messages only | Everything (text, tools, results) |
| Claude's text responses | Terminal only | Streamed to Discord |
| Tool activity | Not visible in Discord | Streamed to Discord |
| Session continuity | CC manages internally | `--continue` resumes latest session in directory |

### Single Session Per Channel

Only one session (Mode A or Mode B) can be active in a channel at a time.

- If a Mode A session (cc-plugin) is connected, Mode B @mentions route to it as messages.
- If a Mode B prompt is running (headless), new cc-plugin connections are rejected and @mentions are queued/rejected.
- Between Mode B prompts, the channel is free — either a new @mention (Mode B) or a cc-plugin connection (Mode A) can take it.

## Interaction Model

### @mention

All Discord interaction uses @mention. No slash commands for messaging (only `/pair` for admin pairing).

- **@mention in a mapped channel with an active session** → message routes to the active session (Mode A or Mode B)
- **@mention in a mapped channel with no active session** → starts a Mode B headless prompt using `--continue` in the channel's project directory
- **Messages without @mention** → ignored (unless Mode A session is active, then all messages in mapped channels route)

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
- Enforces single session per channel
- Tracks busy channels (Mode B prompts in progress)

### cc-plugin (Mode A)

A Claude Code channel plugin. Spawned by CC as an MCP server over stdio.

Responsibilities:
- Speaks MCP to Claude Code (stdio transport)
- Connects to the server via WebSocket
- Relays user messages from server → CC via `notifications/claude/channel`
- Exposes a `reply` tool that sends CC responses back to the server
- Stateless and lightweight — pure message relay

The cc-plugin does not depend on node-agent. Users launch CC directly:
```
claude --dangerously-load-development-channels server:cc-hub
```

### node-agent (Mode B)

A long-lived process running on a machine capable of hosting CC sessions.

Responsibilities:
- Connects to the server via WebSocket
- Receives prompts from server (triggered by Discord @mentions)
- Spawns `claude -p "..." --continue --output-format stream-json --verbose` per prompt
- Parses stream-json output and streams events to the server
- Signals prompt completion (`session_end` event) so server frees the channel
- Tracks busy channels to reject concurrent prompts

The node-agent is stateless between prompts. `--continue` handles session continuity automatically (CC resumes the latest session in the working directory).

## Project Structure

```
cc-hub/
  packages/
    shared/       # Message types, Zod schemas, client config
    server/       # API layer + Discord bot
    cc-plugin/    # CC channel plugin (MCP server + WebSocket client)
    node-agent/   # Headless CC executor
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

| Method | Direction | Description |
|--------|-----------|-------------|
| `cc.message` | server → plugin | User message from chat platform |
| `cc.reply` | plugin → server | CC response back to chat platform |

#### node-agent methods (Mode B)

| Method | Direction | Description |
|--------|-----------|-------------|
| `node.send_message` | server → agent | Run a prompt in headless mode |
| `node.stream_event` | agent → server | Streamed output event (text, tool call, result, session_end) |
| `node.heartbeat` | agent → server | Periodic liveness signal |

### Connection Lifecycle

1. cc-plugin or node-agent connects to server via WebSocket
2. Sends an `identify` message declaring its type (`cc-plugin` or `node-agent`) and credentials
3. Server authenticates and registers the connection
4. For cc-plugin: server checks single session rule, maps to channel or rejects
5. Messages flow bidirectionally until disconnect

## Message Flow

### Mode A: User sends a message from Discord (terminal-driven)

```
User sends message in Discord #proj-a
  → Server receives message via Discord bot
  → Server sees cc-plugin connected for #proj-a
  → Server sends JSON-RPC cc.message over WebSocket
  → cc-plugin pushes MCP notification to CC session
  → Claude processes and calls the reply tool
  → cc-plugin sends JSON-RPC cc.reply over WebSocket
  → Server sends reply to Discord #proj-a
```

### Mode B: User @mentions bot (headless)

```
User @mentions bot in Discord #proj-a with "fix the auth bug"
  → Server receives message, strips @mention
  → Server sees no active session for #proj-a
  → Server marks #proj-a as busy
  → Server sends node.send_message to node-agent (projectPath + prompt)
  → Node-agent runs: claude -p "fix the auth bug" --continue --output-format stream-json --verbose
  → Node-agent parses stream-json line by line:
    → text → buffers, flushes every 500ms → node.stream_event (text)
    → tool_use → node.stream_event (tool_call)
    → tool_result → node.stream_event (tool_result)
  → Server formats each event and posts to Discord #proj-a
  → CC process exits
  → Node-agent sends node.stream_event (session_end)
  → Server marks #proj-a as free
```

### Mode A: User launches CC from terminal

```
User runs: claude --dangerously-load-development-channels server:cc-hub
  → CC spawns cc-plugin
  → cc-plugin connects to server via WebSocket, sends identify
  → Server checks single session rule for the channel
  → If free: registers plugin, posts "session connected" to Discord
  → If busy: rejects connection, closes WebSocket
```

## Chatbot Interface

The server defines a platform-agnostic chatbot interface. Each messaging platform (Discord, Slack) implements this interface.

Responsibilities of a chatbot implementation:
- Connect to the platform (Discord Gateway, Slack RTM, etc.)
- Receive messages and translate them to internal format
- Send replies back to the platform, handling platform-specific constraints (e.g., Discord 2000-char message limit, chunking, code block formatting)
- Handle @mentions and route to active sessions or start headless
- Handle platform commands (e.g., `/pair`)

Discord is the first implementation. The interface should be simple enough that adding Slack or other platforms is straightforward.

## Authentication

### Machine Authentication (cc-plugin and node-agent)

Both cc-plugin and node-agent use the same auth model. From the server's perspective, they are both clients connecting from a machine — the difference is capabilities, not trust level.

#### Pairing Flow (first time)

```
Client (cc-plugin or node-agent) connects to server
  → Server returns a pairing code (e.g., "A3F7")
  → Client displays code in terminal
  → Guild admin runs /pair A3F7 in Discord (slash command, ManageGuild permission required)
  → Server issues a persistent token
  → Client stores token in ~/.cc-hub/config.json
```

The `/pair` slash command is ephemeral (only the admin sees the response) and requires `ManageGuild` permission. Non-admins cannot see or use it.

#### Subsequent Connections

```
Client connects to server with stored token
  → Server validates token
  → Server grants capabilities based on client type
```

#### Token Reuse

A machine running both a node-agent and CC sessions pairs once. The node-agent's token can be reused by cc-plugins it spawns (same machine, same user), avoiding repeated pairing for every new session.

### Platform User Authorization

Discord/Slack handle user identity — the server trusts the platform's user ID. Authorization determines which platform users can interact with which CC sessions.

Options (configurable per deployment):
- **Allowlist** — explicit list of Discord user IDs allowed to interact
- **Role-based** — anyone with a specific Discord role gets access
- **Open** — anyone in the Discord server can use it

## Channel Mapping

Channels are mapped by **project path**. The cc-plugin reads `$PWD` on startup and sends it to the server during `identify`. For Mode B, the project path comes from the existing channel mapping. The server maps each unique project path to a Discord channel.

- `/home/rophy/projects/cc-hub` → `#cc-hub`
- `/home/rophy/projects/api-server` → `#api-server`

If no channel exists for the path, the server creates one.

### Limitations

Claude Code does not expose its session/conversation ID to MCP servers (channel plugins). There is no env var, no hook mechanism, and no MCP method to discover it. This is a known gap with open feature requests ([#17188](https://github.com/anthropics/claude-code/issues/17188), [#25642](https://github.com/anthropics/claude-code/issues/25642)). Using `$PWD` avoids this limitation entirely.

## State Persistence

Server state is stored in a JSON config file in the user's home directory (`~/.cc-hub/state.json`). This includes:
- Project path → channel mappings
- Paired machine tokens

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
| CC session exits normally (Mode A) | Plugin dies. Server posts "session ended" in channel. Channel freed. |
| Headless prompt finishes (Mode B) | Process exits. Node-agent sends session_end. Channel freed. |
| Network blip | Plugin/agent auto-reconnects (5s delay). |
| Server restarts | All connections drop. Clients reconnect. Server reloads state from JSON file. |
| Node-agent disconnects | Pending prompts fail. Busy channels freed. |

## Access Control

A single server instance maps to a single Discord guild. Any user who can see a channel can send messages to the CC sessions in that channel. Access is controlled entirely by Discord's native channel permissions.

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

### Why single session per channel?

Simplicity. Multiple concurrent sessions in one channel would require message targeting (`@shortId` prefixes), confuse Discord users about which session responded, and create race conditions. One session per channel keeps the UX clean — you type in the channel, the session responds.

### Why @mention instead of slash commands?

@mention is the natural Discord interaction model for bot conversations. Slash commands are used for administrative actions (`/pair`). Messages in mapped channels with active Mode A sessions route automatically without @mention — the bot acts as a transparent relay.
