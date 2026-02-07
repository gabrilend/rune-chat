# RS-SDK Workflow Guide

A comprehensive guide to interacting with the RuneScape SDK research platform.

## System Overview

RS-SDK is a research platform for building RuneScape-style bot automation, based on the 2004scape (LostCity) emulator. It consists of four main components:

```
+------------------+     +------------------+     +------------------+
|   Your Script    |     |   Bot Browser    |     |  Manual Player   |
|   (TypeScript)   |     |   (Headless)     |     |   (Browser)      |
+--------+---------+     +--------+---------+     +--------+---------+
         |                        |                        |
         v                        v                        v
+--------+---------+     +--------+---------+              |
|     BotSDK       |     |    Bot Client    |              |
|   (Library)      |     |   (JavaScript)   |              |
+--------+---------+     +--------+---------+              |
         |                        |                        |
         |    WebSocket           |    WebSocket           |
         v                        v                        |
+--------+------------------------+---------+              |
|                 GATEWAY                   |              |
|              (port 7780)                  |              |
|         WebSocket Message Relay           |              |
+--------+----------------------------------+              |
         |                                                 |
         |    Proxied via /gateway                         |
         v                                                 v
+--------+------------------------------------------------+---------+
|                         ENGINE SERVER                             |
|                     (port 80 / 43594)                             |
|                                                                   |
|  +-------------+  +-------------+  +-------------+  +-----------+ |
|  | Web Server  |  | Game World  |  | TCP Server  |  | Database  | |
|  | (HTTP/WS)   |  | Simulation  |  | (Protocol)  |  | (SQLite)  | |
|  +-------------+  +-------------+  +-------------+  +-----------+ |
+-------------------------------------------------------------------+
```

## Components

### Engine Server
The core game server running a complete RuneScape 2004 simulation.

- **Web Port**: 80 (configurable)
- **Game Port**: 43594 (TCP protocol)
- **Features**: NPCs, items, skills, quests, combat, economy

### Gateway
WebSocket relay connecting bot clients to SDK scripts.

- **Port**: 7780
- **Purpose**: Bridges browser-based bot clients with TypeScript automation scripts
- **Supports**: Multiple observers, exclusive control mode

### Web Client
Browser-based game client (JavaScript port of the original Java client).

- **Standard Client**: For manual play (`/`)
- **Bot Client**: SDK-integrated version (`/bot`)

### Bot SDK
TypeScript library for programmatic bot control.

- **Low-level API** (`BotSDK`): Direct action mapping
- **High-level API** (`BotActions`): Domain-aware helpers (e.g., `chopTree()`, `walkTo()`)

---

## Quick Start Workflows

### 1. Start the Local Server

```bash
cd /home/ritz/programming/ai-stuff/runescape/scripts

# Start everything
./run

# Or start specific components
./run --engine-only
./run --gateway-only
```

### 2. Create a Bot

```bash
cd /home/ritz/programming/ai-stuff/runescape/rs-sdk

# Automated creation
bun scripts/create-bot.ts mybot

# This creates:
# bots/mybot/
#   script.ts    - Automation script template
#   bot.env      - Credentials
```

### 3. Run a Bot Script

```bash
# Run your bot
bun bots/mybot/script.ts

# Or run example scripts
bun scripts/fishing-speedrun/script.ts
bun scripts/combat-trainer/script.ts
```

### 4. Manual Play

Open in browser:
- Local: `http://localhost:80/`
- Demo: `https://rs-sdk-demo.fly.dev/`

---

## Bot Script Architecture

### Basic Script Structure

```typescript
import { BotSDK, BotActions, runScript } from '@anthropic/rs-sdk';

await runScript(async (ctx) => {
    const { bot, sdk, log } = ctx;

    // Your automation logic
    await bot.walkTo(3200, 3200);
    await bot.chopTree();
    await bot.burnLogs();

    log('Completed task!');
}, {
    timeout: 60_000,      // Script timeout
    autoConnect: true,    // Auto-connect SDK
});
```

### SDK Connection Options

```typescript
const sdk = new BotSDK({
    botUsername: 'mybot',
    password: 'secret',
    gatewayUrl: 'wss://localhost:7780',
    connectionMode: 'control',  // or 'observe'
    autoReconnect: true,
    autoLaunchBrowser: 'auto',
});
```

---

## Message Flow Diagram

```
Bot Script                Gateway                 Bot Browser              Engine
    |                        |                        |                      |
    |-- sdk_connect -------->|                        |                      |
    |                        |<-- connected ----------|                      |
    |<- sdk_connected -------|                        |                      |
    |                        |                        |                      |
    |-- sdk_action --------->|                        |                      |
    |   (walk to tree)       |-- action ------------->|                      |
    |                        |                        |-- game protocol ---->|
    |                        |                        |<-- state update -----|
    |                        |<-- state --------------|                      |
    |<- sdk_state -----------|                        |                      |
    |   (new position)       |                        |                      |
    |                        |                        |                      |
    |-- sdk_action --------->|                        |                      |
    |   (chop tree)          |-- action ------------->|                      |
    |                        |                        |-- interact tree ---->|
    |                        |                        |<-- xp gained --------|
    |                        |<-- actionResult -------|                      |
    |<- sdk_action_result ---|                        |                      |
    |                        |                        |                      |
```

---

## Available Actions

### Low-Level (BotSDK)

| Method | Description |
|--------|-------------|
| `sendWalk(x, z, running)` | Move to coordinates |
| `sendInteractNpc(index, option)` | Interact with NPC |
| `sendInteractLoc(x, z, id, option)` | Interact with object |
| `sendShopBuy(slot, amount)` | Buy from shop |
| `sendClickDialog(option)` | Select dialog option |
| `waitForTicks(count)` | Wait game ticks |
| `getState()` | Get current world state |

### High-Level (BotActions)

| Method | Description |
|--------|-------------|
| `walkTo(x, z)` | Pathfind and walk |
| `chopTree()` | Chop nearest tree |
| `burnLogs()` | Light fire with logs |
| `attackNpc(name)` | Attack and kill NPC |
| `pickupItem(name)` | Pick up ground item |
| `buyFromShop(item, qty)` | Purchase from shop |
| `skipTutorial()` | Complete tutorial island |

---

## Web Endpoints

### Engine Server (port 80)

| Endpoint | Description |
|----------|-------------|
| `/` | Standard game client |
| `/bot` | Bot client (SDK-integrated) |
| `/engine-status` | Server health (JSON) |
| `/playercount` | Online player count |
| `/status` | All bot statuses |
| `/status/{name}` | Single bot status |
| `/hiscores` | Leaderboard |
| `/screenshots` | Bot screenshots |
| `/scriptRuns` | Bot execution logs |

### Gateway (port 7780)

WebSocket only - connect with SDK or bot client.

---

## Bot State Object

When you call `sdk.getState()`, you receive:

```typescript
interface BotWorldState {
    tick: number;              // Current game tick
    inGame: boolean;           // Logged in?
    player: {
        x: number;             // World X coordinate
        z: number;             // World Z coordinate
        name: string;
        combatLevel: number;
    };
    skills: [{
        id: number;
        level: number;
        xp: number;
    }];
    inventory: [{
        slot: number;
        itemId: number;
        quantity: number;
    }];
    nearbyNpcs: [...];         // NPCs in view
    nearbyLocs: [...];         // Objects in view
    groundItems: [...];        // Items on ground
    dialog: {                  // Current dialog
        open: boolean;
        options: string[];
        text: string;
    };
    shop: {...};               // Open shop
    bank: {...};               // Bank contents
}
```

---

## Development Workflow

### Recommended Iteration Process

1. **Start small**: Use 1-3 minute timeouts
2. **Run and observe**: Watch the bot's actions
3. **Document findings**: Update `lab_log.md` in your bot folder
4. **Fix issues**: Handle edge cases found during testing
5. **Extend timeout**: Once stable, increase for longer runs
6. **Record results**: Save screenshots and logs

### Example lab_log.md

```markdown
# My Bot - Development Log

## Iteration 1 (2024-01-15)
- Initial script: walk to trees, chop, burn
- Issue: Bot gets stuck on fence
- Fix: Added pathfinding detour

## Iteration 2 (2024-01-15)
- Added inventory check before chopping
- Issue: Doesn't handle full inventory
- Fix: Drop logs when full
```

---

## Local Scripts Reference

| Script | Location |
|--------|----------|
| Run server | `./scripts/run` |
| Install deps | `./scripts/install` |
| Update project | `./scripts/update` |
| Build native deps | `./scripts/build-deps` |

### Build-deps Commands

```bash
./scripts/build-deps all       # Build OpenSSL + Prisma
./scripts/build-deps openssl   # Build OpenSSL only
./scripts/build-deps prisma    # Build Prisma only
./scripts/build-deps status    # Show what's built
./scripts/build-deps env       # Regenerate env.sh
```

---

## Database Schema

Key tables in `engine/db.sqlite`:

| Table | Purpose |
|-------|---------|
| `account` | Player accounts (username, password, staff) |
| `session` | Active game sessions |
| `hiscore` | Skill leaderboards |
| `wealth_event` | Economic transactions |
| `public_chat` | Chat history |

---

## Troubleshooting

### Bot won't connect

1. Check gateway is running: `./run --gateway-only`
2. Verify port 7780 is accessible
3. Check bot.env has correct credentials

### Prisma errors on NixOS

```bash
# Build Prisma engines locally
./scripts/build-deps all

# Source the environment
source ../libs/env.sh
```

### Engine cache not built

```bash
cd rs-sdk/engine
bun run build
```

### Database needs migration

```bash
cd rs-sdk/engine
bun run sqlite:migrate
```

---

## Example Scripts Directory

Located at `/home/ritz/programming/ai-stuff/runescape/rs-sdk/scripts/`:

- `fishing-speedrun/` - Fish, cook, bank cycle
- `combat-trainer/` - Melee training automation
- `crafting/` - Leather/jewelry crafting
- `cooking/` - Range cooking
- `mining-trainer/` - Mine and smelt
- `fletching/` - Arrow/bow making
- `agility/` - Obstacle courses
- `cowhide-banking/` - Trade cycles
- `al-kharid-travel/` - Movement examples

Each script includes `script.ts` and `lab_log.md` documenting the development process.

---

## Architecture Notes

### Key Design Decisions

1. **Browser-based bots**: Bot clients run in actual browsers (headless), allowing visual inspection and manual intervention

2. **Gateway separation**: SDK scripts don't connect directly to the engine - the gateway handles message routing and session management

3. **State-driven actions**: High-level actions (`chopTree()`) wait for observable effects (logs in inventory) rather than just acknowledgment

4. **Multiple SDK modes**: `control` mode for active automation, `observe` mode for read-only monitoring

5. **Auto-launch**: SDK can automatically launch a browser for the bot if none is connected

### Game Modifications for Research

- Faster XP progression
- Infinite run energy
- No random events (anti-bot disabled)
- Leaderboard ranked by efficiency (level/playtime)
