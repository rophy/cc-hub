# cc-hub

A bridge between messaging platforms (Discord, Slack, etc.) and local Claude Code sessions.

## Problem

Claude Code is a powerful CLI tool, but interacting with it requires terminal access. Mobile-friendly options are limited. Existing solutions like remote control work but have UX limitations on mobile devices.

## Approach

Use messaging platforms (Discord, Slack) as the UI layer, and Claude Code Channels as the interface to CC sessions. A bridge daemon manages the lifecycle of sessions and routes messages between platform channels and local CC sessions.

## Architecture

```
Discord/Slack ←→ [Bridge daemon] ←→ [Local CC channel plugin] ←→ CC Worker Session
                   (no LLM)          (per worker, MCP server)
```

### Components

1. **Bridge daemon** — A standalone process (no LLM needed) that:
   - Connects to messaging platforms (Discord, Slack, etc.)
   - Routes messages between platform channels and CC sessions
   - Manages session lifecycle (create channels, archive on termination)
   - Enforces access control (RBAC per channel)

2. **Local CC channel plugin** — A minimal MCP server that:
   - Listens on a unix socket for messages from the bridge
   - Pushes them to CC as `notifications/claude/channel`
   - Exposes a `reply` tool that sends responses back over the socket to the bridge

### Message Flow

```
User sends message in Discord #proj-a
  → Bridge receives via discord.js
  → Bridge looks up route: #proj-a → /tmp/cc-worker-a.sock
  → Bridge sends message over unix socket
  → Local channel plugin receives it
  → Plugin pushes MCP notification to CC session
  → Claude processes and calls `reply` tool
  → Plugin sends reply back over unix socket
  → Bridge receives reply
  → Bridge sends message to Discord #proj-a
```

### Features

#### Phase 1: Core Relay
- 1:1 mapping between platform channels and CC sessions
- Bidirectional message routing over unix sockets
- Platform-agnostic local plugin (doesn't know about Discord/Slack)

#### Phase 2: Session Lifecycle
- Auto-create a Discord channel when a new CC session starts
- Mark channel as read-only when the CC session terminates
- Start a new CC session from Discord (e.g. bot command)

#### Phase 3: Multi-User Collaboration
- RBAC so multiple users can interact with the same CC session over a shared channel
- Role-based permissions (e.g. viewer, operator, admin)

#### Future: Multi-Platform
- Discord first, Slack next
- Same local channel plugin works for all platforms

## Status

Early design phase.
