# RS-SDK Quick Reference

## Start Server

```bash
cd scripts && ./run
```

## Create Bot

```bash
cd rs-sdk && bun scripts/create-bot.ts mybot
```

## Run Bot

```bash
bun bots/mybot/script.ts
```

## Ports

| Service | Port |
|---------|------|
| Engine Web | 80 |
| Engine Game | 43594 |
| Gateway | 7780 |

## URLs

| Page | URL |
|------|-----|
| Play | http://localhost/ |
| Bot Client | http://localhost/bot |
| Status | http://localhost/status |
| Hiscores | http://localhost/hiscores |

## Script Template

```typescript
import { runScript } from '@anthropic/rs-sdk';

await runScript(async ({ bot, log }) => {
    await bot.walkTo(3200, 3200);
    await bot.chopTree();
    log('Done!');
}, { timeout: 60_000 });
```

## Common BotActions

```typescript
bot.walkTo(x, z)          // Move to location
bot.chopTree()            // Chop nearest tree
bot.burnLogs()            // Light fire
bot.attackNpc('Chicken')  // Attack NPC
bot.pickupItem('Bones')   // Pick up item
bot.buyFromShop(item, n)  // Buy from shop
bot.skipTutorial()        // Skip tutorial island
```

## Build Commands

```bash
./scripts/build-deps all      # Build OpenSSL + Prisma
./scripts/install             # Full install
./scripts/install status      # Check status
```

## State Access

```typescript
const state = await sdk.getState();
state.player.x            // Player X coord
state.player.z            // Player Z coord
state.inventory           // Inventory items
state.skills              // Skill levels/XP
state.nearbyNpcs          // NPCs in view
state.dialog.open         // Dialog visible?
```

## Architecture

```
Script (TS) --> BotSDK --> Gateway (7780) --> Bot Browser
                                    |
                                    v
                            Engine Server (80)
                                    |
                                    v
                               Database
```
