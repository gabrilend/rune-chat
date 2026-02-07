// extract-dialogues.ts - Parse .rs2 scripts and extract NPC dialogue into JSON
//
// Usage: bun rs-sdk/data/extract-dialogues.ts
// Output: rs-sdk/data/npc-dialogues.json

import fs from 'fs';
import path from 'path';

interface NpcDialogue {
    lines: string[];
    choices: string[];
}

type DialogueMap = Record<string, NpcDialogue>;

const SCRIPTS_DIR = path.resolve(__dirname, '../content/scripts');
const OUTPUT_PATH = path.resolve(__dirname, 'npc-dialogues.json');

// Strip formatting tags like <p,neutral>, <p,angry>, etc.
function stripFormatTags(text: string): string {
    return text.replace(/<p,\w+>/g, '').trim();
}

// Extract dialogue from a single .rs2 file
function extractFromFile(filePath: string, dialogues: DialogueMap): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let currentNpc: string | null = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // Match [opnpc1,npc_name] or [apnpc1,npc_name] headers
        const headerMatch = trimmed.match(/^\[(op|ap)npc\d+,(\w+)\]/);
        if (headerMatch) {
            currentNpc = headerMatch[2];
            if (!dialogues[currentNpc]) {
                dialogues[currentNpc] = { lines: [], choices: [] };
            }
            continue;
        }

        // Reset current NPC on non-NPC headers (labels are fine, other triggers are not)
        if (trimmed.startsWith('[') && !trimmed.startsWith('[label,')) {
            currentNpc = null;
            continue;
        }

        if (!currentNpc) continue;

        const entry = dialogues[currentNpc];

        // Match ~chatnpc("...") lines
        const chatnpcMatch = trimmed.match(/~chatnpc\("(.+?)"\)/);
        if (chatnpcMatch) {
            // Handle pipe-separated multiline text
            const rawText = chatnpcMatch[1];
            const segments = rawText.split('|');
            for (const seg of segments) {
                const cleaned = stripFormatTags(seg);
                if (cleaned && !entry.lines.includes(cleaned)) {
                    entry.lines.push(cleaned);
                }
            }
            continue;
        }

        // Match ~chatplayer("...") lines
        const chatplayerMatch = trimmed.match(/~chatplayer\("(.+?)"\)/);
        if (chatplayerMatch) {
            const rawText = chatplayerMatch[1];
            const segments = rawText.split('|');
            for (const seg of segments) {
                const cleaned = stripFormatTags(seg);
                if (cleaned && !entry.lines.includes(cleaned)) {
                    entry.lines.push(cleaned);
                }
            }
            continue;
        }

        // Match ~p_choice2/3/4/5 options
        const choiceMatch = trimmed.match(/~p_choice\d+\((.+)\)/);
        if (choiceMatch) {
            const args = choiceMatch[1];
            // Options are alternating: "text", value, "text", value, ...
            const optionTexts = args.match(/"([^"]+)"/g);
            if (optionTexts) {
                for (const opt of optionTexts) {
                    const cleaned = opt.replace(/"/g, '').trim();
                    if (cleaned && !entry.choices.includes(cleaned)) {
                        entry.choices.push(cleaned);
                    }
                }
            }
            continue;
        }

        // Match @multi2/3/4/5 options
        const multiMatch = trimmed.match(/@multi\d+\((.+)\)/);
        if (multiMatch) {
            const args = multiMatch[1];
            const optionTexts = args.match(/"([^"]+)"/g);
            if (optionTexts) {
                for (const opt of optionTexts) {
                    const cleaned = opt.replace(/"/g, '').trim();
                    if (cleaned && !entry.choices.includes(cleaned)) {
                        entry.choices.push(cleaned);
                    }
                }
            }
            continue;
        }
    }
}

// Recursively find all .rs2 files
function findRs2Files(dir: string): string[] {
    const results: string[] = [];

    if (!fs.existsSync(dir)) {
        console.error(`Scripts directory not found: ${dir}`);
        return results;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findRs2Files(fullPath));
        } else if (entry.name.endsWith('.rs2')) {
            results.push(fullPath);
        }
    }
    return results;
}

// Main
function main(): void {
    console.log(`Scanning for .rs2 files in: ${SCRIPTS_DIR}`);
    const files = findRs2Files(SCRIPTS_DIR);
    console.log(`Found ${files.length} .rs2 files`);

    const dialogues: DialogueMap = {};

    for (const file of files) {
        extractFromFile(file, dialogues);
    }

    // Remove empty entries
    for (const key of Object.keys(dialogues)) {
        const entry = dialogues[key];
        if (entry.lines.length === 0 && entry.choices.length === 0) {
            delete dialogues[key];
        }
    }

    const npcCount = Object.keys(dialogues).length;
    const totalLines = Object.values(dialogues).reduce((sum, d) => sum + d.lines.length, 0);
    const totalChoices = Object.values(dialogues).reduce((sum, d) => sum + d.choices.length, 0);

    console.log(`Extracted dialogue from ${npcCount} NPCs (${totalLines} lines, ${totalChoices} choices)`);

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dialogues, null, 2));
    console.log(`Written to: ${OUTPUT_PATH}`);
}

main();
