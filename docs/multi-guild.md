# Multi-Guild Design (Future Enhancement)

## Goal

Allow cc-hub to operate as a public Discord bot that any guild can install. Each guild is an independent cc-hub instance with isolated state.

## Current Design (Single Guild)

- One server process per guild
- Guild admin self-hosts the server and provides their own bot token
- All state (channel mappings, tokens, sessions) is global

## Multi-Guild Architecture

### One bot, many guilds

A single hosted server process handles all guilds. The bot is invited to guilds via a public OAuth2 URL. All state is partitioned by guild ID.

```
Guild A: #proj-a, #proj-b  ─┐
                             ├──→  cc-hub server (hosted)  ←── cc-plugins / node-agents
Guild B: #api, #frontend   ─┘
```

### State Partitioning

Every piece of state must be scoped to a guild:

| State | Current key | Multi-guild key |
|---|---|---|
| Channel mappings | projectPath | guildId + projectPath |
| Paired machines | token | guildId + token |
| Plugin connections | channelName | guildId + channelName |
| Node agents | shortId | guildId + shortId |

A token issued for Guild A must not grant access to Guild B.

### Pairing Flow Changes

1. cc-plugin connects with a **guild ID** in the identify message
2. Server returns pairing code scoped to that guild
3. User DMs the bot: `!pair A3F7`
4. Bot checks which guilds the user shares with the bot
5. Bot confirms pairing only if the user has the required role in the target guild
6. Token is bound to that guild

The cc-plugin needs to know which guild to target. Options:
- Environment variable: `CC_HUB_GUILD=123456789`
- Config file: `~/.cc-hub/config.json` includes `guildId`
- Server assigns based on user's guild membership during pairing

### Authorization Model

| Action | Who can do it |
|---|---|
| Install bot to guild | Anyone with Manage Server permission |
| Approve pairings | Guild admin or users with a configurable role |
| Send messages to CC sessions | Anyone who can see the channel (Discord permissions) |
| Start/stop sessions via node-agent | Users with the configured role |

Guild admins configure the authorized role via a bot command:
```
!cc-hub config role @cc-hub-admin
```

### Persistence

Single JSON file won't scale for multi-guild. Options:
- **SQLite** — embedded, no external deps, good for moderate scale
- **PostgreSQL** — for production multi-server deployment

Schema would include a `guild_id` column on every table.

### Hosting Model

Two options:

**Centralized (SaaS-style)**
- You host the server
- Single bot token, single process
- All guilds share the same infrastructure
- CC sessions run on guild members' machines (server is just a relay)
- Needs rate limiting, abuse prevention

**Self-hosted (current model, per guild)**
- Each guild admin runs their own server
- Each guild admin creates their own bot
- Complete isolation by design
- No changes needed to current architecture

### Migration Path

1. Add `guildId` field to identify params (backward compatible — optional, defaults to single-guild mode)
2. Partition state by guild ID in the server
3. Scope token validation to guild
4. Add guild-aware pairing (check user's guild membership)
5. Replace JSON file with SQLite
6. Add rate limiting and abuse prevention for centralized hosting

### Open Questions

- **Bot permissions**: What permissions does the bot need? Manage Channels (to create per-project channels) is a significant permission for a public bot.
- **Channel creation**: Should the bot create channels automatically, or should guild admins pre-create them and map manually?
- **Billing/limits**: If centrally hosted, should there be limits per guild (max sessions, max channels)?
- **Data isolation**: Even with guild-scoped state, the server process sees all messages. For sensitive codebases, self-hosted is safer.
