#!/usr/bin/env bun
/**
 * bot-manager.ts - TUI for managing bot characters
 *
 * Uses the same database connection as the game engine (SQLite by default).
 *
 * Schema: 3-table "sheet" design
 *   sheet      - Core identity (id, name, personality, pointers to subsheets)
 *   wow_sheet  - WoW character data (race, class, gear, etc.)
 *   rune_sheet - RuneScape character data (levels, appearance, position, etc.)
 *
 * A sheet is like a C struct with two pointers:
 *   { id, wow_sheet_id, rune_sheet_id }
 *
 * Run from engine directory:
 *   bun run tools/bot-manager.ts
 */

import { db } from '#/db/query.js';
import { sql } from 'kysely';
import Environment from '#/util/Environment.js';
import { describeCoordinates } from '../../locations/resolver';

// =============================================================================
// SHEET TYPES (3-table design)
// =============================================================================

/** Main sheet - one per bot */
interface Sheet {
    id: number;
    name: string;
    username: string;
    password: string;
    personality_preset: string | null;
    backstory: string | null;
    birthday: string | null;
    playing_since: number | null;
    hardcore_mode: number; // SQLite boolean (0/1)
    created_at: string;
    wow_sheet_id: number | null;
    rune_sheet_id: number | null;
}

/** WoW subsheet - character data for World of Warcraft */
interface WowSheet {
    id: number;
    race: number;
    class_id: number;
    gender: number;
    level: number;
    skin: number;
    face: number;
    hair_style: number;
    hair_color: number;
    facial_hair: number;
    map_id: number;
    x: number;
    y: number;
    z: number;
}

/** RuneScape subsheet - character data for RuneScape */
interface RuneSheet {
    id: number;
    combat_level: number;
    total_level: number;
    appearance: string | null;
    world: number;
    x: number;
    z: number;
    plane: number;
    online: number; // SQLite boolean (0/1)
    death_count: number;
    total_playtime: number;
    gateway_status: string | null;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const DB_BACKEND = Environment.DB_BACKEND;
const GATEWAY_HOST = process.env.GATEWAY_HOST || 'localhost';
const GATEWAY_PORT = process.env.GATEWAY_PORT || '8245';

// =============================================================================
// ANSI COLORS (simple, portable)
// =============================================================================

const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatStatus(status: string | null, online: boolean): string {
    if (online) return `${c.green}ONLINE${c.reset}`;
    if (status === 'stale') return `${c.yellow}STALE${c.reset}`;
    return `${c.dim}OFFLINE${c.reset}`;
}

function formatPlaytime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

function pad(str: string, len: number): string {
    const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, len - stripped.length);
    return str + ' '.repeat(padding);
}

// =============================================================================
// RANDOM NAME GENERATOR (RuneScape style)
// =============================================================================

const NAME_PREFIXES = [
    'Dark', 'Iron', 'Steel', 'Shadow', 'Fire', 'Ice', 'Storm', 'Thunder',
    'Swift', 'Silent', 'Wild', 'Brave', 'Noble', 'Grim', 'Dusk', 'Dawn',
    'Red', 'Blue', 'Green', 'Black', 'White', 'Gold', 'Silver', 'Bronze',
    'Lone', 'Mad', 'Old', 'Young', 'Lost', 'Free', 'True', 'Pure',
];

const NAME_ROOTS = [
    'wolf', 'hawk', 'bear', 'lion', 'raven', 'dragon', 'knight', 'mage',
    'blade', 'storm', 'fire', 'frost', 'shadow', 'light', 'hunter', 'ranger',
    'king', 'lord', 'sage', 'smith', 'archer', 'warrior', 'wizard', 'rogue',
    'oak', 'ash', 'stone', 'iron', 'star', 'moon', 'sun', 'wind',
];

const NAME_SUFFIXES = [
    '', '', '', '', // Empty more often for shorter names
    '42', '99', '07', '04', 'x', 'xx', 'btw', 'pk', 'hc', 'im',
    '_rs', '_pk', '_btw', 'scape', 'rune', 'gp',
];

function generateRandomPassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
        password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password;
}

function generateRandomName(): string {
    const usePrefix = Math.random() > 0.4;
    const useSuffix = Math.random() > 0.5;
    const useSpace = usePrefix && Math.random() < 0.25; // 25% chance for space between prefix and root

    let name = '';
    if (usePrefix) {
        name += NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)];
        if (useSpace) name += ' ';
    }
    name += NAME_ROOTS[Math.floor(Math.random() * NAME_ROOTS.length)];
    if (useSuffix) {
        name += NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)];
    }

    // Capitalize first letter, max 12 chars (RS limit)
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return name.slice(0, 12);
}

// =============================================================================
// MENU SELECTION (gameboy-style)
// =============================================================================

interface MenuOption<T> {
    label: string;
    value: T;
    description?: string;
}

async function selectMenu<T>(
    title: string,
    options: MenuOption<T>[],
    initialIndex = 0
): Promise<T> {
    let selected = initialIndex;

    while (true) {
        console.clear();
        console.log(`${c.cyan}${c.bold}${title}${c.reset}`);
        console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
        console.log('');

        options.forEach((opt, idx) => {
            const selector = idx === selected ? `${c.cyan}>${c.reset}` : ' ';
            const label = idx === selected ? `${c.bold}${opt.label}${c.reset}` : opt.label;
            console.log(`${selector} ${label}`);
            if (opt.description && idx === selected) {
                console.log(`   ${c.dim}${opt.description}${c.reset}`);
            }
        });

        console.log('');
        console.log(`${c.dim}↑/↓ or j/k to navigate, Enter to select, q to cancel${c.reset}`);

        const key = await readKey();

        switch (key) {
            case 'j':
            case 'down':
                if (selected < options.length - 1) selected++;
                break;
            case 'k':
            case 'up':
                if (selected > 0) selected--;
                break;
            case 'enter':
            case 'l':
                return options[selected].value;
            case 'q':
            case 'ctrl-c':
                throw new Error('cancelled');
        }
    }
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

/** Create all three tables if they don't exist */
async function ensureTables(): Promise<void> {
    await sql`
        CREATE TABLE IF NOT EXISTS sheet (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            personality_preset TEXT,
            backstory       TEXT,
            birthday        TEXT,
            playing_since   INTEGER,
            hardcore_mode   INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            wow_sheet_id    INTEGER,
            rune_sheet_id   INTEGER,
            FOREIGN KEY (wow_sheet_id) REFERENCES wow_sheet(id),
            FOREIGN KEY (rune_sheet_id) REFERENCES rune_sheet(id)
        )
    `.execute(db);

    // Add username/password columns if missing (migration for existing DBs)
    try {
        await sql`ALTER TABLE sheet ADD COLUMN username TEXT NOT NULL DEFAULT ''`.execute(db);
    } catch (_) { /* column already exists */ }
    try {
        await sql`ALTER TABLE sheet ADD COLUMN password TEXT NOT NULL DEFAULT ''`.execute(db);
    } catch (_) { /* column already exists */ }

    await sql`
        CREATE TABLE IF NOT EXISTS wow_sheet (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            race        INTEGER NOT NULL DEFAULT 1,
            class_id    INTEGER NOT NULL DEFAULT 1,
            gender      INTEGER NOT NULL DEFAULT 0,
            level       INTEGER NOT NULL DEFAULT 1,
            skin        INTEGER NOT NULL DEFAULT 0,
            face        INTEGER NOT NULL DEFAULT 0,
            hair_style  INTEGER NOT NULL DEFAULT 0,
            hair_color  INTEGER NOT NULL DEFAULT 0,
            facial_hair INTEGER NOT NULL DEFAULT 0,
            map_id      INTEGER NOT NULL DEFAULT 0,
            x           REAL NOT NULL DEFAULT 0,
            y           REAL NOT NULL DEFAULT 0,
            z           REAL NOT NULL DEFAULT 0
        )
    `.execute(db);

    await sql`
        CREATE TABLE IF NOT EXISTS rune_sheet (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            combat_level    INTEGER NOT NULL DEFAULT 3,
            total_level     INTEGER NOT NULL DEFAULT 32,
            appearance      TEXT,
            world           INTEGER NOT NULL DEFAULT 1,
            x               INTEGER NOT NULL DEFAULT 3222,
            z               INTEGER NOT NULL DEFAULT 3222,
            plane           INTEGER NOT NULL DEFAULT 0,
            online          INTEGER NOT NULL DEFAULT 0,
            death_count     INTEGER NOT NULL DEFAULT 0,
            total_playtime  INTEGER NOT NULL DEFAULT 0,
            gateway_status  TEXT
        )
    `.execute(db);
}

async function listSheets(): Promise<Sheet[]> {
    return await db
        .selectFrom('sheet' as any)
        .selectAll()
        .orderBy('name')
        .execute() as any;
}

async function getSheet(id: number): Promise<Sheet | undefined> {
    return await db
        .selectFrom('sheet' as any)
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst() as any;
}

async function getRuneSheet(id: number): Promise<RuneSheet | undefined> {
    return await db
        .selectFrom('rune_sheet' as any)
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst() as any;
}

async function createSheet(data: {
    name: string;
    personality_preset: string;
    hardcore_mode: boolean;
    playing_since: number;
}): Promise<number> {
    // Create RuneScape subsheet
    await sql`
        INSERT INTO rune_sheet (combat_level, total_level, world, x, z, plane)
        VALUES (3, 32, 1, 3222, 3222, 0)
    `.execute(db);
    const runeResult = await sql<{ id: number }>`
        SELECT last_insert_rowid() as id
    `.execute(db);
    const runeId = runeResult.rows[0].id;

    // Create WoW subsheet
    await sql`
        INSERT INTO wow_sheet (race, class_id, gender, level)
        VALUES (1, 1, 0, 1)
    `.execute(db);
    const wowResult = await sql<{ id: number }>`
        SELECT last_insert_rowid() as id
    `.execute(db);
    const wowId = wowResult.rows[0].id;

    // Create main sheet with pointers
    const username = data.name;
    const password = generateRandomPassword();
    await sql`
        INSERT INTO sheet (name, username, password, personality_preset, hardcore_mode, playing_since, wow_sheet_id, rune_sheet_id)
        VALUES (${data.name}, ${username}, ${password}, ${data.personality_preset}, ${data.hardcore_mode ? 1 : 0}, ${data.playing_since}, ${wowId}, ${runeId})
    `.execute(db);
    const sheetResult = await sql<{ id: number }>`
        SELECT last_insert_rowid() as id
    `.execute(db);

    return sheetResult.rows[0].id;
}

// =============================================================================
// DISPLAY FUNCTIONS
// =============================================================================

function printHeader(): void {
    console.clear();
    console.log(`${c.cyan}${c.bold}RS-SDK Bot Manager${c.reset}`);
    console.log(`${c.dim}Database: ${DB_BACKEND}  Gateway: ${GATEWAY_HOST}:${GATEWAY_PORT}${c.reset}`);
    console.log('');
}

function printCharacterList(sheets: Sheet[], selected: number): void {
    console.log(`${c.bold}ID    Name                 Preset              Since${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);

    sheets.forEach((s, idx) => {
        const selector = idx === selected ? `${c.cyan}>${c.reset}` : ' ';
        const preset = s.personality_preset || 'custom';
        const hardcore = s.hardcore_mode ? `${c.red}[HC]${c.reset}` : '';
        const since = s.playing_since ? String(s.playing_since) : '';

        console.log(
            `${selector} ${pad(String(s.id), 5)} ` +
            `${pad(s.name + hardcore, 20)} ` +
            `${pad(preset, 19)} ` +
            `${since}`
        );
    });

    console.log('');
}

function printCommands(): void {
    console.log(`${c.dim}Commands:${c.reset}`);
    console.log(`  ${c.bold}j/k${c.reset} or ${c.bold}↑/↓${c.reset}  Navigate`);
    console.log(`  ${c.bold}Enter${c.reset}        Launch selected bot`);
    console.log(`  ${c.bold}n${c.reset}            Create new character`);
    console.log(`  ${c.bold}d${c.reset}            Show details`);
    console.log(`  ${c.bold}r${c.reset}            Refresh list`);
    console.log(`  ${c.bold}q${c.reset}            Quit`);
    console.log('');
}

async function showDetails(s: Sheet): Promise<void> {
    console.clear();
    console.log(`${c.cyan}${c.bold}Sheet #${s.id}: ${s.name}${c.reset}`);
    console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
    console.log('');

    // Identity section
    console.log(`${c.bold}Identity${c.reset}`);
    console.log(`  Personality: ${s.personality_preset || 'custom'}`);
    console.log(`  Since:       ${s.playing_since || 'Unknown'}`);
    console.log(`  Hardcore:    ${s.hardcore_mode ? `${c.red}Yes${c.reset}` : 'No'}`);

    // RuneScape section
    if (s.rune_sheet_id !== null) {
        const rs = await getRuneSheet(s.rune_sheet_id);
        if (rs) {
            const location = describeCoordinates(rs.x, rs.z);
            console.log('');
            console.log(`${c.bold}RuneScape${c.reset}`);
            console.log(`  Combat: ${rs.combat_level}    Total: ${rs.total_level}`);
            console.log(`  Location: ${location}`);
            console.log(`  Deaths: ${rs.death_count}   Playtime: ${formatPlaytime(rs.total_playtime)}`);
            console.log(`  Status: ${formatStatus(rs.gateway_status, !!rs.online)}`);
        }
    }

    console.log('');
    console.log(`${c.dim}Press any key to return...${c.reset}`);
}

// =============================================================================
// CREATE CHARACTER WIZARD (gameboy-style: j/k, enter, backspace, space)
// =============================================================================

const PRESETS = [
    { key: 'friendly_helper', name: 'Friendly Helper' },
    { key: 'independent_explorer', name: 'Explorer' },
    { key: 'quiet_worker', name: 'Quiet Worker' },
    { key: 'social_butterfly', name: 'Social Butterfly' },
    { key: 'rude_pvp', name: 'Rude PvPer' },
    { key: 'toddler', name: 'Toddler' },
    { key: 'mad_mage', name: 'Mad Mage' },
    { key: 'wise_sage', name: 'Wise Sage' },
    { key: 'cat_follower', name: 'Cat Follower' },
    { key: 'hardcore_janitor', name: 'Janitor (HC)' },
];

async function createCharacterWizard(): Promise<void> {
    // State
    let names = Array.from({ length: 6 }, () => generateRandomName());
    let nameIdx = 0;
    let presetIdx = 0;
    let hardcore = false;
    let step = 0; // 0=name, 1=preset, 2=confirm

    while (true) {
        console.clear();

        if (step === 0) {
            // STEP 1: Pick name
            console.log(`${c.cyan}${c.bold}New Character - Name${c.reset}`);
            console.log(`${c.dim}${'─'.repeat(40)}${c.reset}`);
            console.log('');
            names.forEach((name, idx) => {
                const sel = idx === nameIdx ? `${c.cyan}>${c.reset}` : ' ';
                const txt = idx === nameIdx ? `${c.bold}${name}${c.reset}` : name;
                console.log(`${sel} ${txt}`);
            });
            console.log('');
            console.log(`${c.dim}j/k:move  enter:select  backspace:reroll  q:cancel${c.reset}`);

        } else if (step === 1) {
            // STEP 2: Pick preset
            console.log(`${c.cyan}${c.bold}New Character - Personality${c.reset}`);
            console.log(`${c.dim}Name: ${names[nameIdx]}${c.reset}`);
            console.log(`${c.dim}${'─'.repeat(40)}${c.reset}`);
            console.log('');
            PRESETS.forEach((p, idx) => {
                const sel = idx === presetIdx ? `${c.cyan}>${c.reset}` : ' ';
                const txt = idx === presetIdx ? `${c.bold}${p.name}${c.reset}` : p.name;
                console.log(`${sel} ${txt}`);
            });
            console.log('');
            console.log(`${c.dim}j/k:move  enter:select  backspace:back  q:cancel${c.reset}`);

        } else if (step === 2) {
            // STEP 3: Confirm + hardcore toggle
            console.log(`${c.cyan}${c.bold}New Character - Confirm${c.reset}`);
            console.log(`${c.dim}${'─'.repeat(40)}${c.reset}`);
            console.log('');
            console.log(`  Name:        ${c.bold}${names[nameIdx]}${c.reset}`);
            console.log(`  Personality: ${c.bold}${PRESETS[presetIdx].name}${c.reset}`);
            console.log('');
            const hcText = hardcore
                ? `${c.red}${c.bold}[X] HARDCORE${c.reset}`
                : `${c.dim}[ ] Hardcore${c.reset}`;
            console.log(`  ${hcText}`);
            if (hardcore) {
                console.log(`      ${c.dim}Death = permadeath${c.reset}`);
                console.log(`      ${c.dim}Items stay on ground forever${c.reset}`);
                console.log(`      ${c.dim}Burn items by lighting fires on them${c.reset}`);
            }
            console.log('');
            console.log(`${c.dim}space:toggle hardcore  enter:create  backspace:back  q:cancel${c.reset}`);
        }

        const key = await readKey();

        if (key === 'q' || key === 'ctrl-c') {
            return; // Cancel
        }

        if (step === 0) {
            if (key === 'j' || key === 'down') {
                nameIdx = Math.min(nameIdx + 1, names.length - 1);
            } else if (key === 'k' || key === 'up') {
                nameIdx = Math.max(nameIdx - 1, 0);
            } else if (key === 'enter' || key === 'l') {
                step = 1;
            } else if (key === '\x7f' || key === 'backspace') {
                // Reroll names
                names = Array.from({ length: 6 }, () => generateRandomName());
                nameIdx = 0;
            }
        } else if (step === 1) {
            if (key === 'j' || key === 'down') {
                presetIdx = Math.min(presetIdx + 1, PRESETS.length - 1);
            } else if (key === 'k' || key === 'up') {
                presetIdx = Math.max(presetIdx - 1, 0);
            } else if (key === 'enter' || key === 'l') {
                step = 2;
            } else if (key === '\x7f' || key === 'backspace') {
                step = 0;
            }
        } else if (step === 2) {
            if (key === ' ') {
                hardcore = !hardcore;
            } else if (key === 'enter' || key === 'l') {
                // Create!
                try {
                    const id = await createSheet({
                        name: names[nameIdx],
                        personality_preset: PRESETS[presetIdx].key,
                        hardcore_mode: hardcore,
                        playing_since: 2004 + Math.floor(Math.random() * 20),
                    });
                    console.clear();
                    console.log(`${c.green}Created: ${names[nameIdx]} (#${id})${c.reset}`);
                    if (hardcore) {
                        console.log(`${c.red}HARDCORE MODE${c.reset}`);
                    }
                    console.log('');
                    console.log(`${c.dim}Press any key...${c.reset}`);
                    await waitForKey();
                    return;
                } catch (err: any) {
                    console.clear();
                    console.log(`${c.red}${c.bold}Error creating character${c.reset}`);
                    console.log('');
                    console.log(`${c.red}${err.message}${c.reset}`);
                    if (err.code) {
                        console.log(`${c.dim}Code: ${err.code}${c.reset}`);
                    }
                    if (err.code === 'ER_NO_SUCH_TABLE') {
                        console.log('');
                        console.log(`${c.yellow}Run: bun run db:push${c.reset}`);
                    }
                    console.log('');
                    console.log(`${c.dim}Press any key...${c.reset}`);
                    await waitForKey();
                    return;
                }
            } else if (key === '\x7f' || key === 'backspace') {
                step = 1;
            }
        }
    }
}

// =============================================================================
// LAUNCH BOT
// =============================================================================

async function launchBot(s: Sheet): Promise<void> {
    console.clear();
    console.log(`${c.cyan}${c.bold}Launching: ${s.name}${c.reset}`);
    console.log('');
    console.log(`  Sheet ID:    ${s.id}`);
    console.log(`  Personality: ${s.personality_preset || 'custom'}`);
    console.log(`  Hardcore:    ${s.hardcore_mode ? 'Yes' : 'No'}`);
    console.log('');

    // Restore terminal to normal mode before handing off to subprocess
    process.stdin.setRawMode!(false);

    const proc = Bun.spawn(['bun', 'run', 'tools/bot-launcher.ts', String(s.id)], {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
    });

    await proc.exited;

    // Re-enter raw mode for TUI
    process.stdin.setRawMode!(true);
}

// =============================================================================
// INPUT HANDLING
// =============================================================================

function isTTY(): boolean {
    return process.stdin.isTTY === true;
}

function waitForKey(): Promise<string> {
    return new Promise(resolve => {
        if (!isTTY()) {
            // Non-interactive mode - just wait a bit and return
            setTimeout(() => resolve(''), 100);
            return;
        }
        process.stdin.setRawMode!(true);
        process.stdin.resume();
        process.stdin.once('data', data => {
            process.stdin.setRawMode!(false);
            resolve(data.toString());
        });
    });
}

async function readKey(): Promise<string> {
    return new Promise(resolve => {
        if (!isTTY()) {
            // Non-interactive mode - return quit
            resolve('q');
            return;
        }
        process.stdin.setRawMode!(true);
        process.stdin.resume();
        process.stdin.once('data', data => {
            process.stdin.setRawMode!(false);
            const key = data.toString();

            // Handle arrow keys
            if (key === '\x1b[A') resolve('up');
            else if (key === '\x1b[B') resolve('down');
            else if (key === '\r' || key === '\n') resolve('enter');
            else if (key === '\x03') resolve('ctrl-c'); // Ctrl+C
            else resolve(key);
        });
    });
}

// =============================================================================
// MAIN LOOP
// =============================================================================

async function main(): Promise<void> {
    // Check for interactive terminal
    if (!isTTY()) {
        console.log(`${c.red}Error: bot-manager requires an interactive terminal${c.reset}`);
        console.log('');
        console.log('Run this from a terminal, not piped or in a script.');
        process.exit(1);
    }

    // Create tables if they don't exist (no external migration needed)
    try {
        await ensureTables();
    } catch (error: any) {
        console.log(`${c.red}Database setup failed: ${error.message}${c.reset}`);
        process.exit(1);
    }

    let running = true;
    let selected = 0;
    let sheets: Sheet[] = [];

    // Initial load
    try {
        sheets = await listSheets();
    } catch (error: any) {
        console.log(`${c.red}Database query failed: ${error.message}${c.reset}`);
        process.exit(1);
    }

    while (running) {
        printHeader();

        if (sheets.length === 0) {
            console.log(`${c.yellow}No characters found.${c.reset}`);
            console.log(`Press ${c.bold}n${c.reset} to create one.`);
        } else {
            printCharacterList(sheets, selected);
        }

        printCommands();

        const key = await readKey();

        switch (key) {
            case 'q':
            case 'ctrl-c':
                running = false;
                break;

            case 'j':
            case 'down':
                if (selected < sheets.length - 1) selected++;
                break;

            case 'k':
            case 'up':
                if (selected > 0) selected--;
                break;

            case 'enter':
            case 'l':
                if (sheets[selected]) {
                    await launchBot(sheets[selected]);
                }
                break;

            case 'd':
                if (sheets[selected]) {
                    await showDetails(sheets[selected]);
                    await waitForKey();
                }
                break;

            case 'n':
                await createCharacterWizard();
                sheets = await listSheets();
                break;

            case 'r':
                sheets = await listSheets();
                if (selected >= sheets.length) {
                    selected = Math.max(0, sheets.length - 1);
                }
                break;
        }
    }

    console.clear();
    console.log(`${c.cyan}Goodbye!${c.reset}`);
    await db.destroy();
    process.exit(0);
}

// Run
main().catch(err => {
    console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
    process.exit(1);
});
