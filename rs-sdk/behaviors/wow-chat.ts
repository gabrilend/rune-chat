// wow-chat.ts - WoW-Chat mode behavior
//
// Handles bot-side logic for the periodic NPC encounter system.
// Watches for spawned NPCs, fights hostiles, and chats with friendly travellers.

import type { BehaviorDefinition, BehaviorContext } from '../bot-core';
import type { NearbyNpc, GameMessage } from '../sdk/types';
import type { GameChatIntegration } from '../bot-chat/game-integration';
import fs from 'fs';
import path from 'path';

interface NpcDialogue {
    lines: string[];
    choices: string[];
}

type DialogueMap = Record<string, NpcDialogue>;

interface WowChatOptions {
    dialogueDataPath?: string;
    respondToHostiles?: boolean;
    chat?: GameChatIntegration;
}

interface EncounterRecord {
    npcIndex: number;
    npcName: string;
    firstSeen: number;
    handled: boolean;
}

interface WowChatState {
    knownNpcIndices: Set<number>;
    encounters: EncounterRecord[];
}

// Parse NPC overhead say messages for encounter metadata
function parseEncounterMessage(messages: GameMessage[]): Map<string, { type: string; pairedName: string }> {
    const parsed = new Map<string, { type: string; pairedName: string }>();

    for (const msg of messages) {
        // NPC say messages typically come as type 2 or type 109
        const text = msg.text;

        const travellerMatch = text.match(/^\*Wandering traveller who met (.+)\*$/);
        if (travellerMatch) {
            parsed.set(msg.sender, { type: 'traveller', pairedName: travellerMatch[1] });
            continue;
        }

        const sentByMatch = text.match(/^\*Sent by (.+)\*$/);
        if (sentByMatch) {
            parsed.set(msg.sender, { type: 'sent_by', pairedName: sentByMatch[1] });
            continue;
        }

        const huntingMatch = text.match(/^\*Hunting (.+)\*$/);
        if (huntingMatch) {
            parsed.set(msg.sender, { type: 'hunting', pairedName: huntingMatch[1] });
            continue;
        }
    }

    return parsed;
}

function loadDialogueData(dialoguePath: string): DialogueMap {
    try {
        const raw = fs.readFileSync(dialoguePath, 'utf-8');
        return JSON.parse(raw) as DialogueMap;
    } catch {
        return {};
    }
}

function getDialogueForNpc(dialogues: DialogueMap, npcName: string): string[] {
    // Try exact match first, then lowercase match
    if (dialogues[npcName]) return dialogues[npcName].lines;

    const lower = npcName.toLowerCase();
    for (const key of Object.keys(dialogues)) {
        if (key.toLowerCase() === lower) return dialogues[key].lines;
    }

    // Try partial match (NPC names in scripts use underscores, in-game use spaces)
    const normalized = npcName.toLowerCase().replace(/\s+/g, '_');
    for (const key of Object.keys(dialogues)) {
        if (key.toLowerCase().includes(normalized) || normalized.includes(key.toLowerCase())) {
            return dialogues[key].lines;
        }
    }

    return [];
}

/**
 * Create the wow-chat behavior for the periodic NPC encounter system.
 */
export function createWowChatBehavior(options: WowChatOptions = {}): BehaviorDefinition {
    const respondToHostiles = options.respondToHostiles ?? true;
    const dialoguePath = options.dialogueDataPath ??
        path.resolve(__dirname, '../data/npc-dialogues.json');

    return {
        name: 'wow-chat',
        description: 'Handle periodic NPC encounters: fight hostiles, chat with travellers',
        fn: async (ctx: BehaviorContext) => {
            const { sdk, bot, log } = ctx;
            const chat = options.chat ?? null;

            // Load dialogue data
            const dialogues = loadDialogueData(dialoguePath);
            const dialogueCount = Object.keys(dialogues).length;
            log(`[wow-chat] Loaded dialogue data for ${dialogueCount} NPCs`);

            // Track known NPCs to detect new arrivals
            const knownNpcIndices = new Set<number>();
            // Track encounter metadata parsed from overhead messages
            const encounterMetadata = new Map<number, { type: string; pairedName: string }>();
            // Track which NPCs we've already interacted with
            const handledNpcs = new Set<number>();

            // Initialize known NPCs from current state
            const initialState = sdk.getState();
            if (initialState) {
                for (const npc of initialState.nearbyNpcs) {
                    knownNpcIndices.add(npc.index);
                }
            }

            log('[wow-chat] Behavior active — watching for encounters');

            while (true) {
                // Check for interrupts
                const interrupt = ctx.checkInterrupt();
                if (interrupt) {
                    log(`[wow-chat] Interrupted by ${interrupt.type}`);
                    return;
                }

                const state = sdk.getState();
                if (!state?.player) {
                    const continued = await ctx.waitTicks(1);
                    if (!continued) return;
                    continue;
                }

                const currentNpcs = state.nearbyNpcs;
                const currentIndices = new Set(currentNpcs.map(n => n.index));

                // Detect new NPCs (appeared this tick)
                const newNpcs: NearbyNpc[] = [];
                for (const npc of currentNpcs) {
                    if (!knownNpcIndices.has(npc.index)) {
                        newNpcs.push(npc);
                    }
                }

                // Clean up departed NPCs
                for (const idx of knownNpcIndices) {
                    if (!currentIndices.has(idx)) {
                        knownNpcIndices.delete(idx);
                        encounterMetadata.delete(idx);
                        handledNpcs.delete(idx);
                    }
                }

                // Update known set
                for (const npc of currentNpcs) {
                    knownNpcIndices.add(npc.index);
                }

                // Parse encounter messages from game messages
                const encounterMsgs = parseEncounterMessage(state.gameMessages);
                for (const [senderName, meta] of encounterMsgs) {
                    // Find matching NPC by name
                    const matchingNpc = currentNpcs.find(n => n.name === senderName);
                    if (matchingNpc) {
                        encounterMetadata.set(matchingNpc.index, meta);
                    }
                }

                // Process new NPCs
                for (const npc of newNpcs) {
                    if (handledNpcs.has(npc.index)) continue;

                    const isHostile = npc.options.some(
                        opt => opt.toLowerCase() === 'attack'
                    ) && npc.combatLevel > 0;

                    if (isHostile) {
                        // Hostile NPC approaching
                        log(`[wow-chat] Hostile encounter: ${npc.name} (lvl ${npc.combatLevel}) at distance ${npc.distance}`);

                        if (respondToHostiles && npc.distance <= 15) {
                            handledNpcs.add(npc.index);
                            try {
                                await bot.attackNpc(npc);
                            } catch (err) {
                                log(`[wow-chat] Failed to attack ${npc.name}: ${err}`);
                            }
                        }
                    } else {
                        // Friendly NPC approaching
                        const meta = encounterMetadata.get(npc.index);
                        log(`[wow-chat] Friendly encounter: ${npc.name}${meta ? ` (met ${meta.pairedName})` : ''}`);

                        if (chat && npc.distance <= 12) {
                            handledNpcs.add(npc.index);
                            await handleFriendlyEncounter(ctx, chat, dialogues, npc, meta ?? null);
                        }
                    }
                }

                // Check for hostile NPCs that are attacking us (even if not new)
                if (respondToHostiles && state.player.combat?.inCombat) {
                    const targetIdx = state.player.combat.targetIndex;
                    if (targetIdx >= 0 && !handledNpcs.has(targetIdx)) {
                        const attacker = currentNpcs.find(n => n.index === targetIdx);
                        if (attacker) {
                            log(`[wow-chat] Under attack by ${attacker.name} — retaliating`);
                            handledNpcs.add(attacker.index);
                            try {
                                await bot.attackNpc(attacker);
                            } catch (err) {
                                log(`[wow-chat] Failed to retaliate against ${attacker.name}: ${err}`);
                            }
                        }
                    }
                }

                // Wait before next check
                const continued = await ctx.waitTicks(2);
                if (!continued) return;
            }
        },
    };
}

async function handleFriendlyEncounter(
    ctx: BehaviorContext,
    chat: GameChatIntegration,
    dialogues: DialogueMap,
    npc: NearbyNpc,
    meta: { type: string; pairedName: string } | null,
): Promise<void> {
    const { sdk, log } = ctx;

    // Gather dialogue content for both this NPC and the paired NPC
    const npcDialogue = getDialogueForNpc(dialogues, npc.name);
    const pairedDialogue = meta ? getDialogueForNpc(dialogues, meta.pairedName) : [];

    // Build AI prompt
    const npcLines = npcDialogue.slice(0, 5).join(' ');
    const pairedLines = pairedDialogue.slice(0, 5).join(' ');

    let prompt: string;
    if (meta && meta.type === 'traveller') {
        prompt = `A wandering traveller named ${npc.name} approaches. They recently met ${meta.pairedName} and talked about: ${pairedLines || 'various things'}. ${npc.name}'s own knowledge includes: ${npcLines || 'general adventuring topics'}. Greet them and ask about their travels. Keep it to 1-2 short sentences.`;
    } else {
        prompt = `A friendly NPC named ${npc.name} approaches you. ${npcLines ? `They are known to talk about: ${npcLines}.` : ''} Greet them warmly. Keep it to 1-2 short sentences.`;
    }

    try {
        // Try to interact with the NPC
        await sdk.sendInteractNpc(npc.index, 1);
        await sdk.waitForTicks(3);

        // Generate and speak an AI response
        const response = await chat.think(prompt);
        await chat.say(response);
    } catch (err) {
        log(`[wow-chat] Error interacting with ${npc.name}: ${err}`);
    }
}

// Default export with standard settings
export const wowChatBehavior = createWowChatBehavior();

export default wowChatBehavior;
