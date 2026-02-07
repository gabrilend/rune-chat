#!/usr/bin/env bun
/**
 * bot-launcher.ts - Standalone subprocess for running a bot
 *
 * Launched by bot-manager.ts as a subprocess with a sheet ID.
 * Reads the sheet + rune_sheet from SQLite, resolves personality,
 * creates a BotRunner, registers all behaviors, and runs.
 *
 * Usage: bun run tools/bot-launcher.ts <sheet_id>
 */

import { db } from '#/db/query.js';
import { sql } from 'kysely';
import { createBotRunner } from '../../bot-core/bot-runner';
import { getPersonalityPreset, type FullPersonality } from '../../bot-core/personality-presets';
import { allBehaviors } from '../../behaviors/index';

// =============================================================================
// CLI ARG
// =============================================================================

const sheetId = parseInt(process.argv[2], 10);
if (isNaN(sheetId)) {
    console.error('Usage: bun run tools/bot-launcher.ts <sheet_id>');
    process.exit(1);
}

// =============================================================================
// DB READ
// =============================================================================

interface Sheet {
    id: number;
    name: string;
    username: string;
    password: string;
    personality_preset: string | null;
    backstory: string | null;
    playing_since: number | null;
    hardcore_mode: number;
    rune_sheet_id: number | null;
}

interface RuneSheet {
    id: number;
    online: number;
}

async function loadSheet(id: number): Promise<Sheet> {
    const row = await db
        .selectFrom('sheet' as any)
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst() as Sheet | undefined;

    if (!row) {
        console.error(`Sheet #${id} not found`);
        process.exit(1);
    }
    return row;
}

async function setOnline(runeSheetId: number, online: boolean): Promise<void> {
    await sql`UPDATE rune_sheet SET online = ${online ? 1 : 0} WHERE id = ${runeSheetId}`.execute(db);
}

// =============================================================================
// PERSONALITY -> DESCRIPTION
// =============================================================================

function describePersonality(preset: FullPersonality, presetName: string): string {
    const traits: string[] = [];

    if (preset.sociability > 0.7) traits.push('very social');
    else if (preset.sociability < 0.3) traits.push('quiet and reserved');

    if (preset.helpfulness > 0.7) traits.push('eager to help others');
    else if (preset.helpfulness < 0.3) traits.push('self-focused');

    if (preset.adventurousness > 0.7) traits.push('loves exploring');
    else if (preset.adventurousness < 0.3) traits.push('prefers familiar places');

    if (preset.diligence > 0.7) traits.push('hardworking and focused');

    if (preset.rudeness > 0.5) traits.push('rude and confrontational');
    if (preset.childishness > 0.5) traits.push('childlike with limited vocabulary');
    if (preset.mysticism > 0.5) traits.push('speaks in mysterious, poetic ways');
    if (preset.playfulness > 0.7) traits.push('playful and silly');
    if (preset.mischievousness > 0.3) traits.push('a bit mischievous');
    if (preset.independence > 0.7) traits.push('very independent');

    const name = presetName.replace(/_/g, ' ');
    if (traits.length === 0) return `A ${name} personality.`;
    return `A ${name} who is ${traits.join(', ')}.`;
}

// =============================================================================
// MAIN
// =============================================================================

const GATEWAY_HOST = process.env.GATEWAY_HOST || 'localhost';
const GATEWAY_PORT = process.env.GATEWAY_PORT || '8245';

async function main(): Promise<void> {
    const sheet = await loadSheet(sheetId);

    console.log(`[bot-launcher] Sheet #${sheet.id}: ${sheet.name}`);
    console.log(`[bot-launcher] Personality: ${sheet.personality_preset || 'custom'}`);

    // Resolve personality
    let personality = sheet.backstory || 'A RuneScape adventurer.';
    if (sheet.personality_preset) {
        const preset = getPersonalityPreset(sheet.personality_preset);
        if (preset) {
            personality = describePersonality(preset, sheet.personality_preset);
        }
    }

    console.log(`[bot-launcher] Description: ${personality}`);
    console.log(`[bot-launcher] Gateway: ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);

    // Create runner
    const runner = await createBotRunner({
        username: sheet.username,
        password: sheet.password,
        gatewayUrl: `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`,
        botName: sheet.name,
        personality,
        respondToNearbyChat: true,
        log: (...args: any[]) => console.log(`[${sheet.name}]`, ...args),
    });

    // Register all behaviors
    for (const behavior of allBehaviors) {
        runner.registerBehavior(behavior);
    }

    console.log(`[bot-launcher] Registered ${allBehaviors.length} behaviors`);

    // Mark online on connect, offline on exit
    if (sheet.rune_sheet_id !== null) {
        await setOnline(sheet.rune_sheet_id, true);
    }

    // Graceful shutdown
    const shutdown = async () => {
        console.log(`\n[bot-launcher] Shutting down ${sheet.name}...`);
        await runner.stop();
        if (sheet.rune_sheet_id !== null) {
            await setOnline(sheet.rune_sheet_id, false);
        }
        await db.destroy();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start
    console.log(`[bot-launcher] Starting ${sheet.name}...`);
    await runner.start();
    console.log(`[bot-launcher] ${sheet.name} is running. Press Ctrl+C to stop.`);
}

main().catch(err => {
    console.error(`[bot-launcher] Fatal: ${err.message}`);
    process.exit(1);
});
