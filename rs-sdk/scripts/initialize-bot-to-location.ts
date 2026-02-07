#!/usr/bin/env bun
/**
 * Initialize Bot to Location
 *
 * Creates a new bot, skips tutorial, and walks to a target player's position.
 * The target must be another bot connected to the gateway (so we can query their position).
 *
 * Usage:
 *   bun scripts/initialize-bot-to-location.ts --target <player> [--name <botname>]
 *
 * Examples:
 *   bun scripts/initialize-bot-to-location.ts --target myplayer
 *   bun scripts/initialize-bot-to-location.ts --target myplayer --name newcomp
 *   bun scripts/initialize-bot-to-location.ts -t myplayer -n newcomp
 */

import { BotSDK } from '../sdk/index';
import { BotActions } from '../sdk/actions';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ============ Configuration ============

const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://localhost:8245';
const GATEWAY_HTTP = GATEWAY_URL.replace('ws://', 'http://').replace('wss://', 'https://');

interface TargetPosition {
    name: string;
    worldX: number;
    worldZ: number;
}

// ============ Utility Functions ============

function generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function log(msg: string): void {
    const time = new Date().toISOString().slice(11, 19);
    console.log(`[${time}] ${msg}`);
}

function getDistance(x1: number, z1: number, x2: number, z2: number): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
}

// ============ Gateway API ============

async function getTargetPosition(targetName: string): Promise<TargetPosition | null> {
    try {
        const url = `${GATEWAY_HTTP}/status/${encodeURIComponent(targetName)}`;
        const response = await fetch(url);

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (data.status === 'dead' || !data.player) {
            return null;
        }

        return {
            name: data.player.name,
            worldX: data.player.worldX,
            worldZ: data.player.worldZ,
        };
    } catch (error) {
        return null;
    }
}

// ============ Bot Creation ============

async function createBotDirectory(botName: string, password: string): Promise<string> {
    const botDir = join(process.cwd(), 'bots', botName);

    if (existsSync(botDir)) {
        log(`Bot directory already exists: ${botDir}`);
        // Read existing password
        const envPath = join(botDir, 'bot.env');
        if (existsSync(envPath)) {
            const envContent = await readFile(envPath, 'utf-8');
            const pwMatch = envContent.match(/PASSWORD=(.+)/);
            if (pwMatch) {
                return pwMatch[1].trim();
            }
        }
        return password;
    }

    await mkdir(botDir, { recursive: true });

    // Create bot.env
    const envContent = `BOT_USERNAME=${botName}
PASSWORD=${password}
GATEWAY_URL=${GATEWAY_URL}
`;
    await writeFile(join(botDir, 'bot.env'), envContent);

    // Create a minimal script.ts
    const scriptContent = `import { runScript } from '../../sdk/runner';

await runScript(async (ctx) => {
    const { bot, sdk, log } = ctx;
    log('Bot ${botName} initialized');

    // Idle forever
    while (true) {
        await sdk.waitForTicks(10);
    }
}, { timeout: 0 });
`;
    await writeFile(join(botDir, 'script.ts'), scriptContent);

    log(`Created bot directory: ${botDir}`);
    return password;
}

// ============ Main Initialization Logic ============

async function initializeBotToLocation(targetName: string, botName?: string): Promise<void> {
    // Validate target exists and is connected
    log(`Checking target player: ${targetName}`);
    const targetPos = await getTargetPosition(targetName);

    if (!targetPos) {
        console.error(`Error: Target "${targetName}" not found or not connected to gateway.`);
        console.error(`Make sure the target is logged in and connected via the gateway.`);
        process.exit(1);
    }

    log(`Target found at (${targetPos.worldX}, ${targetPos.worldZ})`);

    // Generate bot name if not provided
    const newBotName = botName || `bot${generateRandomString(6)}`;
    const password = generateRandomString(12);

    log(`Creating bot: ${newBotName}`);
    const actualPassword = await createBotDirectory(newBotName, password);

    // Connect to gateway
    log(`Connecting to gateway...`);
    const sdk = new BotSDK({
        botUsername: newBotName,
        password: actualPassword,
        gatewayUrl: GATEWAY_URL,
        autoLaunchBrowser: true,
        browserLaunchTimeout: 30000,
    });

    try {
        await sdk.connect();
        log(`Connected! Waiting for game state...`);

        // Wait for game to be ready
        await sdk.waitForReady(30000);

        const bot = new BotActions(sdk);

        // Randomize character appearance
        log(`Randomizing character appearance...`);
        const state = sdk.getState();
        if (state?.dialog.isOpen) {
            // We're in character creation
            await sdk.sendRandomizeCharacterDesign();
            await sdk.waitForTicks(2);
            await sdk.sendAcceptCharacterDesign();
            await sdk.waitForTicks(5);
        }

        // Skip tutorial
        log(`Skipping tutorial...`);
        const tutorialResult = await bot.skipTutorial();
        log(tutorialResult.message);

        // Now we should be in Lumbridge
        await sdk.waitForTicks(10);

        const currentState = sdk.getState();
        if (!currentState?.player) {
            throw new Error('No player state after tutorial');
        }

        log(`Bot spawned at (${currentState.player.worldX}, ${currentState.player.worldZ})`);

        // Walk toward target, updating position as we go
        log(`Walking toward ${targetName}...`);

        const CLOSE_ENOUGH = 5;  // tiles
        const UPDATE_INTERVAL = 10;  // ticks between position updates
        let ticksSinceUpdate = 0;
        let lastTargetPos = targetPos;

        while (true) {
            const myState = sdk.getState();
            if (!myState?.player) {
                await sdk.waitForTicks(5);
                continue;
            }

            const myX = myState.player.worldX;
            const myZ = myState.player.worldZ;

            // Update target position periodically
            ticksSinceUpdate++;
            if (ticksSinceUpdate >= UPDATE_INTERVAL) {
                const newTargetPos = await getTargetPosition(targetName);
                if (newTargetPos) {
                    lastTargetPos = newTargetPos;
                    ticksSinceUpdate = 0;
                }
            }

            const distance = getDistance(myX, myZ, lastTargetPos.worldX, lastTargetPos.worldZ);

            if (distance <= CLOSE_ENOUGH) {
                log(`Arrived! Distance to ${targetName}: ${distance.toFixed(1)} tiles`);
                break;
            }

            // Check if target is visible as a nearby player
            const targetPlayer = myState.nearbyPlayers.find(
                p => p.name.toLowerCase() === targetName.toLowerCase()
            );

            if (targetPlayer) {
                // Target is visible, walk directly to them
                log(`${targetName} visible at (${targetPlayer.x}, ${targetPlayer.z}), distance: ${targetPlayer.distance.toFixed(1)}`);
                await sdk.sendWalk(targetPlayer.x, targetPlayer.z, true);
            } else {
                // Target not visible, walk toward last known position
                log(`Walking toward (${lastTargetPos.worldX}, ${lastTargetPos.worldZ}), distance: ${distance.toFixed(1)}`);
                await sdk.sendWalk(lastTargetPos.worldX, lastTargetPos.worldZ, true);
            }

            await sdk.waitForTicks(5);
        }

        // Success!
        log(`\n${'='.repeat(50)}`);
        log(`Bot "${newBotName}" initialized and moved to ${targetName}!`);
        log(`Bot is now at (${sdk.getState()?.player?.worldX}, ${sdk.getState()?.player?.worldZ})`);
        log(`${'='.repeat(50)}\n`);

        // Keep running for a bit so user can see
        log(`Bot will idle for 30 seconds then disconnect...`);
        await sdk.waitForTicks(75);  // ~30 seconds

    } finally {
        await sdk.disconnect();
        log(`Disconnected.`);
    }
}

// ============ CLI Entry Point ============

interface CliArgs {
    target?: string;
    name?: string;
    help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {};
    let i = 0;

    while (i < argv.length) {
        const arg = argv[i];

        if (arg === '--target' || arg === '-t') {
            args.target = argv[++i];
        } else if (arg === '--name' || arg === '-n') {
            args.name = argv[++i];
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg.startsWith('--target=')) {
            args.target = arg.split('=')[1];
        } else if (arg.startsWith('--name=')) {
            args.name = arg.split('=')[1];
        } else if (!arg.startsWith('-')) {
            // Legacy positional support: first positional is target
            if (!args.target) {
                args.target = arg;
            }
        }
        i++;
    }

    return args;
}

function showHelp(): void {
    console.log(`
Initialize Bot to Location
==========================

Creates a new bot, skips tutorial, randomizes appearance, and walks to a target player.

Usage:
  bun scripts/initialize-bot-to-location.ts --target <player> [--name <botname>]

Options:
  -t, --target <name>   Target player/bot to walk toward (required, must be connected to gateway)
  -n, --name <name>     Name for the new bot (optional, random if not provided)
  -h, --help            Show this help message

Environment:
  GATEWAY_URL           Gateway WebSocket URL (default: ws://localhost:8245)

Examples:
  # Create bot with random name, walk to "myplayer"
  bun scripts/initialize-bot-to-location.ts --target myplayer

  # Create bot named "newcomp", walk to "myplayer"
  bun scripts/initialize-bot-to-location.ts --target myplayer --name newcomp

  # Short flags
  bun scripts/initialize-bot-to-location.ts -t myplayer -n newcomp

  # Custom gateway
  GATEWAY_URL=ws://192.168.1.10:8245 bun scripts/initialize-bot-to-location.ts --target myplayer
`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || !args.target) {
        showHelp();
        process.exit(args.help ? 0 : 1);
    }

    const targetName = args.target;
    const botName = args.name;

    if (botName && botName.length > 12) {
        console.error('Error: Bot name must be 12 characters or less');
        process.exit(1);
    }

    if (botName && !/^[a-zA-Z0-9]+$/.test(botName)) {
        console.error('Error: Bot name must be alphanumeric');
        process.exit(1);
    }

    await initializeBotToLocation(targetName, botName);
}

main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
});
