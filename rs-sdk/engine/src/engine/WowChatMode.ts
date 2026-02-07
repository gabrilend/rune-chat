import { CollisionFlag } from '@2004scape/rsmod-pathfinder';

import NpcType from '#/cache/config/NpcType.js';
import { BlockWalk } from '#/engine/entity/BlockWalk.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import { Interaction } from '#/engine/entity/Interaction.js';
import { MoveRestrict } from '#/engine/entity/MoveRestrict.js';
import Npc from '#/engine/entity/Npc.js';
import { NpcMode } from '#/engine/entity/NpcMode.js';
import { NpcStat } from '#/engine/entity/NpcStat.js';
import Player from '#/engine/entity/Player.js';
import { isFlagged } from '#/engine/GameMap.js';
import World from '#/engine/World.js';
import { printInfo } from '#/util/Logger.js';

interface RemovedNpcInfo {
    type: number;
    x: number;
    z: number;
    level: number;
}

// Narrative context stored per encounter NPC
interface EncounterMeta {
    isHostile: boolean;
    isMartial: boolean;
    pairedNpcName: string | null;
    narrative: 'sent_by' | 'hunting' | 'lone' | 'traveller';
}

export default class WowChatMode {
    active: boolean = false;

    // Stashed NPCs for restore on deactivate
    private removedNpcs: Map<number, RemovedNpcInfo> = new Map();

    // Ticks until next spawn event
    private spawnCooldown: number = 0;

    // Default spawn rate in ticks (~50 seconds at 420ms/tick)
    readonly baseSpawnRate: number = 120;

    // nids of NPCs spawned by this system
    private activeEncounters: Set<number> = new Set();

    // Metadata per encounter NPC (keyed by nid)
    private encounterMeta: Map<number, EncounterMeta> = new Map();

    // NPC type indices, built once on activate
    private hostileTypes: NpcType[] = [];
    private friendlyTypes: NpcType[] = [];
    private martialFriendlyTypes: NpcType[] = [];

    activate(): void {
        if (this.active) return;

        printInfo('[WowChatMode] Activating — removing leveled NPCs and building type index');

        // Build NPC type indices
        this.buildTypeIndex();

        // Remove all leveled NPCs from the world
        for (const npc of World.npcs) {
            if (!npc) continue;
            const npcType = NpcType.get(npc.type);
            if (npcType.vislevel > 0) {
                this.removedNpcs.set(npc.nid, {
                    type: npc.type,
                    x: npc.startX,
                    z: npc.startZ,
                    level: npc.startLevel,
                });
                World.removeNpc(npc, -1);
            }
        }

        this.active = true;
        this.spawnCooldown = this.baseSpawnRate;

        printInfo(`[WowChatMode] Removed ${this.removedNpcs.size} leveled NPCs`);
        printInfo(`[WowChatMode] Type index: ${this.hostileTypes.length} hostile, ${this.friendlyTypes.length} friendly (${this.martialFriendlyTypes.length} martial)`);
    }

    deactivate(): void {
        if (!this.active) return;

        printInfo('[WowChatMode] Deactivating — removing encounters and restoring NPCs');

        // Remove all active encounter NPCs
        for (const nid of this.activeEncounters) {
            const npc = World.npcs.get(nid);
            if (npc) {
                World.removeNpc(npc, -1);
            }
        }
        this.activeEncounters.clear();
        this.encounterMeta.clear();

        // Respawn all stashed NPCs
        for (const [_nid, info] of this.removedNpcs) {
            const npcType = NpcType.get(info.type);
            const nid = World.getNextNid();
            const npc = new Npc(
                info.level,
                info.x,
                info.z,
                npcType.size,
                npcType.size,
                EntityLifeCycle.RESPAWN,
                nid,
                info.type,
                npcType.moverestrict,
                npcType.blockwalk
            );
            World.addNpc(npc, -1);
        }
        this.removedNpcs.clear();

        this.active = false;
        printInfo('[WowChatMode] Deactivated');
    }

    tick(currentTick: number): void {
        if (!this.active) return;

        // Clean up despawned encounters
        for (const nid of this.activeEncounters) {
            const npc = World.npcs.get(nid);
            if (!npc || !npc.isActive) {
                this.activeEncounters.delete(nid);
                this.encounterMeta.delete(nid);
            }
        }

        // Handle martial NPC combat assistance
        this.processMartialAssist();

        // Spawn cooldown
        this.spawnCooldown--;
        if (this.spawnCooldown > 0) return;

        // Find first active player
        let player: Player | null = null;
        for (const p of World.players) {
            if (p && p.isActive) {
                player = p;
                break;
            }
        }

        if (!player) {
            this.spawnCooldown = this.baseSpawnRate;
            return;
        }

        this.rollEncounter(player);
    }

    // ---

    private buildTypeIndex(): void {
        this.hostileTypes = [];
        this.friendlyTypes = [];
        this.martialFriendlyTypes = [];

        for (let id = 0; id < NpcType.count; id++) {
            const npcType = NpcType.get(id);
            if (!npcType || !npcType.name) continue;

            if (npcType.vislevel > 0) {
                this.hostileTypes.push(npcType);
            } else if (npcType.name !== 'null') {
                this.friendlyTypes.push(npcType);
                // Martial if has combat stats above 1
                if (npcType.stats[NpcStat.ATTACK] > 1 || npcType.stats[NpcStat.STRENGTH] > 1) {
                    this.martialFriendlyTypes.push(npcType);
                }
            }
        }
    }

    private rollEncounter(player: Player): void {
        if (this.hostileTypes.length === 0 && this.friendlyTypes.length === 0) {
            this.spawnCooldown = this.baseSpawnRate;
            return;
        }

        // Pick NPC Type A from all types (combined pool)
        const allTypes = [...this.hostileTypes, ...this.friendlyTypes];
        const typeA = allTypes[Math.floor(Math.random() * allTypes.length)];

        if (typeA.vislevel > 0) {
            this.rollHostileEncounter(player, typeA);
        } else {
            this.rollFriendlyEncounter(player, typeA);
        }
    }

    private rollHostileEncounter(player: Player, typeA: NpcType): void {
        // Pick Type B — a hostile NPC near the player's combat level
        const typeB = this.pickHostileNearLevel(player.combatLevel);
        if (!typeB) {
            this.spawnCooldown = this.baseSpawnRate;
            return;
        }

        // Calculate spawn rate adjustment based on level difference
        const levelDiff = typeB.vislevel - player.combatLevel;
        if (levelDiff > 0) {
            // B is stronger — slower spawns
            this.spawnCooldown = Math.floor(this.baseSpawnRate * (1 + levelDiff * 0.15));
        } else if (levelDiff < 0) {
            // B is weaker — faster spawns
            this.spawnCooldown = Math.floor(this.baseSpawnRate * Math.max(0.3, 1 - Math.abs(levelDiff) * 0.1));
        } else {
            this.spawnCooldown = this.baseSpawnRate;
        }

        // Spawn B near the player
        const npc = this.spawnAtRandomPoint(player, typeB.id, 15, 8);
        if (!npc) return;

        // Set hunt mode to attack the player
        npc.targetOp = NpcMode.APPLAYER1;
        npc.setInteraction(Interaction.SCRIPT, player, NpcMode.APPLAYER1);

        // Determine narrative
        let narrative: EncounterMeta['narrative'] = 'lone';
        let pairedNpcName: string | null = null;
        if (typeA.vislevel > typeB.vislevel) {
            narrative = 'sent_by';
            pairedNpcName = typeA.name;
        } else if (typeA.vislevel < typeB.vislevel) {
            narrative = 'hunting';
            pairedNpcName = typeA.name;
        }

        this.encounterMeta.set(npc.nid, {
            isHostile: true,
            isMartial: false,
            pairedNpcName,
            narrative,
        });

        // Say narrative context overhead
        if (narrative === 'sent_by' && pairedNpcName) {
            npc.say(`*Sent by ${pairedNpcName}*`);
        } else if (narrative === 'hunting' && pairedNpcName) {
            npc.say(`*Hunting ${pairedNpcName}*`);
        }
    }

    private rollFriendlyEncounter(player: Player, typeA: NpcType): void {
        if (this.friendlyTypes.length === 0) {
            this.spawnCooldown = this.baseSpawnRate;
            return;
        }

        // Pick Type B from all friendly NPC types
        const typeB = this.friendlyTypes[Math.floor(Math.random() * this.friendlyTypes.length)];
        this.spawnCooldown = this.baseSpawnRate;

        // Spawn B near the player
        const npc = this.spawnAtRandomPoint(player, typeB.id, 12, 8);
        if (!npc) return;

        // Walk toward the player
        npc.queueWaypoint(player.x, player.z);
        npc.targetOp = NpcMode.PLAYERFOLLOW;

        const isMartial = this.martialFriendlyTypes.some(t => t.id === typeB.id);

        this.encounterMeta.set(npc.nid, {
            isHostile: false,
            isMartial,
            pairedNpcName: typeA.name,
            narrative: 'traveller',
        });

        // Say context overhead for bot-side parsing
        npc.say(`*Wandering traveller who met ${typeA.name ?? 'a stranger'}*`);
    }

    private pickHostileNearLevel(playerLevel: number): NpcType | null {
        if (this.hostileTypes.length === 0) return null;

        // Try to find NPCs within ±5 of player level
        let range = 5;
        let candidates: NpcType[] = [];

        while (candidates.length === 0 && range <= 50) {
            candidates = this.hostileTypes.filter(
                t => Math.abs(t.vislevel - playerLevel) <= range
            );
            range += 5;
        }

        if (candidates.length === 0) {
            // Fallback to any hostile
            return this.hostileTypes[Math.floor(Math.random() * this.hostileTypes.length)];
        }

        // Weight toward closer level matches
        // Simple weighted random: inverse of level diff + 1
        const weights = candidates.map(t => 1 / (Math.abs(t.vislevel - playerLevel) + 1));
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let roll = Math.random() * totalWeight;

        for (let i = 0; i < candidates.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return candidates[i];
        }

        return candidates[candidates.length - 1];
    }

    private spawnAtRandomPoint(player: Player, npcTypeId: number, maxRadius: number, minRadius: number = 8): Npc | null {
        const npcType = NpcType.get(npcTypeId);

        for (let attempt = 0; attempt < 10; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = minRadius + Math.random() * (maxRadius - minRadius);
            const x = Math.floor(player.x + Math.cos(angle) * dist);
            const z = Math.floor(player.z + Math.sin(angle) * dist);

            // Validate the tile is walkable
            if (isFlagged(x, z, player.level, CollisionFlag.WALK_BLOCKED)) {
                continue;
            }

            const nid = World.getNextNid();
            const npc = new Npc(
                player.level,
                x,
                z,
                npcType.size,
                npcType.size,
                EntityLifeCycle.DESPAWN,
                nid,
                npcTypeId,
                npcType.moverestrict,
                npcType.blockwalk
            );

            // Auto-despawn after ~3.5 minutes (500 ticks) if no interaction
            World.addNpc(npc, 500);
            this.activeEncounters.add(npc.nid);

            return npc;
        }

        // All attempts failed — no walkable tile found
        return null;
    }

    private processMartialAssist(): void {
        // Find active hostile encounters
        const hostileNids: number[] = [];
        const friendlyMartialNids: number[] = [];

        for (const nid of this.activeEncounters) {
            const meta = this.encounterMeta.get(nid);
            if (!meta) continue;

            const npc = World.npcs.get(nid);
            if (!npc || !npc.isActive) continue;

            if (meta.isHostile) {
                hostileNids.push(nid);
            } else if (meta.isMartial) {
                friendlyMartialNids.push(nid);
            }
        }

        // For each hostile NPC, check if a martial friendly is nearby
        for (const hostileNid of hostileNids) {
            const hostile = World.npcs.get(hostileNid);
            if (!hostile || !hostile.isActive) continue;

            for (const friendlyNid of friendlyMartialNids) {
                const friendly = World.npcs.get(friendlyNid);
                if (!friendly || !friendly.isActive) continue;

                // Already has a target (fighting something)
                if (friendly.target) continue;

                const dx = Math.abs(friendly.x - hostile.x);
                const dz = Math.abs(friendly.z - hostile.z);

                // Within 10 tiles
                if (dx <= 10 && dz <= 10) {
                    friendly.setInteraction(Interaction.SCRIPT, hostile, NpcMode.OPNPC1);
                    friendly.targetOp = NpcMode.OPNPC1;
                }
            }
        }
    }

    // Public accessor for encounter metadata (used by bot-side or debugging)
    getEncounterMeta(nid: number): EncounterMeta | undefined {
        return this.encounterMeta.get(nid);
    }

    isEncounterNpc(nid: number): boolean {
        return this.activeEncounters.has(nid);
    }
}
