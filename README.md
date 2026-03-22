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

## Status

Early design phase.
