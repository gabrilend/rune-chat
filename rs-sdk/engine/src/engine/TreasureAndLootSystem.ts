import { CollisionFlag } from '@2004scape/rsmod-pathfinder';

import InvType from '#/cache/config/InvType.js';
import LocType from '#/cache/config/LocType.js';
import ObjType from '#/cache/config/ObjType.js';
import { EntityLifeCycle } from '#/engine/entity/EntityLifeCycle.js';
import { Interaction } from '#/engine/entity/Interaction.js';
import Loc from '#/engine/entity/Loc.js';
import Npc from '#/engine/entity/Npc.js';
import { NpcMode } from '#/engine/entity/NpcMode.js';
import Obj from '#/engine/entity/Obj.js';
import Player from '#/engine/entity/Player.js';
import { PlayerStat } from '#/engine/entity/PlayerStat.js';
import { isFlagged } from '#/engine/GameMap.js';
import World from '#/engine/World.js';
import { printInfo } from '#/util/Logger.js';

// --- Interfaces ---

interface SeededContainer {
    x: number;
    z: number;
    level: number;
    type: number;   // ObjType id
    count: number;
    locType: number; // LocType id for validation
    seedTick: number;
}

interface LootPoolEntry {
    type: number;  // ObjType id
    name: string;
    count: number;
    maxCount: number; // for random ranges
    weight: number;
}

interface BonusDrop {
    type: number;
    count: number;
}

interface StolenItem {
    type: number;
    count: number;
}

const enum LooterState {
    IDLE,
    DROPPING,
    WALKING,
    WANDERING,
    FIGHTING,
    HUNTING
}

interface WanderingLooter {
    nid: number;
    stolenItems: StolenItem[];
    state: LooterState;
    stateTicks: number;
    targetTicks: number;
    accumulatedGold: number;
    lastX: number;
    lastZ: number;
    lastLevel: number;
}

export default class TreasureAndLootSystem {
    active: boolean = false;

    // Treasure seeding
    private seedCooldown: number = 70;
    private containerLocTypeIds: Set<number> = new Set();
    private seededContainers: Map<string, SeededContainer> = new Map();
    private lootPool: LootPoolEntry[] = [];
    private lootPoolTotalWeight: number = 0;

    // NPC bonus drops (gem seeding fallback)
    private npcBonusDrops: Map<number, BonusDrop> = new Map();

    // Wandering looters
    private wanderingLooters: Map<number, WanderingLooter> = new Map();
    private npcAccumulatedGold: Map<number, number> = new Map();

    // Gravestones
    private gravestoneCoords: Set<string> = new Set();
    private processedDeaths: Set<bigint> = new Set();
    private npcLootCooldowns: Map<number, number> = new Map();

    // Fire destruction
    private fireTickCounter: number = 0;

    // --- Lifecycle ---

    activate(): void {
        if (this.active) return;

        printInfo('[TreasureAndLoot] Activating — building container index and loot pool');

        this.buildContainerIndex();
        this.buildLootPool();

        this.active = true;
        this.seedCooldown = 70;
        this.fireTickCounter = 0;

        printInfo(`[TreasureAndLoot] Found ${this.containerLocTypeIds.size} container loc types, ${this.lootPool.length} loot pool entries (total weight: ${this.lootPoolTotalWeight})`);
    }

    deactivate(): void {
        if (!this.active) return;

        printInfo('[TreasureAndLoot] Deactivating — cleaning up');

        // Dump all looter items at their current positions
        for (const [_nid, looter] of this.wanderingLooters) {
            const npc = World.npcs.get(looter.nid);
            const x = npc && npc.isActive ? npc.x : looter.lastX;
            const z = npc && npc.isActive ? npc.z : looter.lastZ;
            const level = npc && npc.isActive ? npc.level : looter.lastLevel;
            this.dumpLooterItems(looter, x, z, level);
        }

        this.containerLocTypeIds.clear();
        this.seededContainers.clear();
        this.lootPool = [];
        this.lootPoolTotalWeight = 0;
        this.npcBonusDrops.clear();
        this.wanderingLooters.clear();
        this.npcAccumulatedGold.clear();
        this.gravestoneCoords.clear();
        this.processedDeaths.clear();
        this.npcLootCooldowns.clear();

        this.active = false;
        printInfo('[TreasureAndLoot] Deactivated');
    }

    tick(currentTick: number): void {
        if (!this.active) return;

        this.processedDeaths.clear();
        this.checkPlayerDeaths();
        this.tickTreasureSeeding();
        this.tickWanderingLooters();
        this.tickMonsterGravestoneLooting();
        this.tickFireDestruction();
    }

    // --- Container Identification ---

    private buildContainerIndex(): void {
        this.containerLocTypeIds.clear();
        for (let id = 0; id < LocType.count; id++) {
            const loc = LocType.get(id);
            if (!loc || !loc.op) continue;
            for (const op of loc.op) {
                if (op && (op.toLowerCase().includes('search') || op.toLowerCase().includes('open'))) {
                    this.containerLocTypeIds.add(id);
                    break;
                }
            }
        }
    }

    // --- Curated Loot Pool ---

    private buildLootPool(): void {
        this.lootPool = [];
        this.lootPoolTotalWeight = 0;

        const entries: { name: string; minCount: number; maxCount: number; weight: number }[] = [
            // Cut gems
            { name: 'sapphire', minCount: 1, maxCount: 1, weight: 15 },
            { name: 'emerald', minCount: 1, maxCount: 1, weight: 10 },
            { name: 'ruby', minCount: 1, maxCount: 1, weight: 6 },
            { name: 'diamond', minCount: 1, maxCount: 1, weight: 2 },
            // Uncut gems
            { name: 'uncut_sapphire', minCount: 1, maxCount: 1, weight: 20 },
            { name: 'uncut_emerald', minCount: 1, maxCount: 1, weight: 14 },
            { name: 'uncut_ruby', minCount: 1, maxCount: 1, weight: 8 },
            { name: 'uncut_diamond', minCount: 1, maxCount: 1, weight: 3 },
            // Coins
            { name: 'coins', minCount: 10, maxCount: 50, weight: 30 },
            { name: 'coins', minCount: 50, maxCount: 200, weight: 15 },
            { name: 'coins', minCount: 200, maxCount: 500, weight: 5 },
            // Runes
            { name: 'fire_rune', minCount: 5, maxCount: 20, weight: 12 },
            { name: 'water_rune', minCount: 5, maxCount: 20, weight: 12 },
            { name: 'air_rune', minCount: 5, maxCount: 20, weight: 12 },
            { name: 'earth_rune', minCount: 5, maxCount: 20, weight: 12 },
            { name: 'mind_rune', minCount: 5, maxCount: 15, weight: 10 },
            { name: 'chaos_rune', minCount: 3, maxCount: 10, weight: 6 },
            { name: 'nature_rune', minCount: 2, maxCount: 8, weight: 5 },
            { name: 'law_rune', minCount: 1, maxCount: 5, weight: 4 },
            { name: 'cosmic_rune', minCount: 2, maxCount: 8, weight: 5 },
            { name: 'death_rune', minCount: 1, maxCount: 5, weight: 3 },
            // Food
            { name: 'bread', minCount: 1, maxCount: 3, weight: 10 },
            { name: 'trout', minCount: 1, maxCount: 3, weight: 8 },
            { name: 'salmon', minCount: 1, maxCount: 2, weight: 6 },
            { name: 'lobster', minCount: 1, maxCount: 2, weight: 4 },
            { name: 'swordfish', minCount: 1, maxCount: 1, weight: 2 },
            // Arrows
            { name: 'bronze_arrow', minCount: 5, maxCount: 20, weight: 8 },
            { name: 'iron_arrow', minCount: 3, maxCount: 15, weight: 5 },
            // Tools
            { name: 'tinderbox', minCount: 1, maxCount: 1, weight: 8 },
            { name: 'hammer', minCount: 1, maxCount: 1, weight: 6 },
            { name: 'rope', minCount: 1, maxCount: 1, weight: 4 },
            { name: 'bones', minCount: 1, maxCount: 3, weight: 2 },
        ];

        for (const entry of entries) {
            const id = ObjType.getId(entry.name);
            if (id === -1) continue; // silently filter invalid names

            this.lootPool.push({
                type: id,
                name: entry.name,
                count: entry.minCount,
                maxCount: entry.maxCount,
                weight: entry.weight,
            });
            this.lootPoolTotalWeight += entry.weight;
        }
    }

    private rollLootItem(): { type: number; count: number } | null {
        if (this.lootPool.length === 0 || this.lootPoolTotalWeight === 0) return null;

        let roll = Math.random() * this.lootPoolTotalWeight;
        for (const entry of this.lootPool) {
            roll -= entry.weight;
            if (roll <= 0) {
                const count = entry.count === entry.maxCount
                    ? entry.count
                    : entry.count + Math.floor(Math.random() * (entry.maxCount - entry.count + 1));
                return { type: entry.type, count };
            }
        }

        // Fallback to last entry
        const last = this.lootPool[this.lootPool.length - 1];
        return { type: last.type, count: last.count };
    }

    // --- Treasure Seeding (every 70 ticks) ---

    private tickTreasureSeeding(): void {
        this.seedCooldown--;
        if (this.seedCooldown > 0) return;
        this.seedCooldown = 70;

        // Clean up expired seeds
        for (const [key, seed] of this.seededContainers) {
            // Remove seeds older than 500 ticks (~3.5 minutes)
            if (World.currentTick - seed.seedTick > 500) {
                this.seededContainers.delete(key);
            }
        }

        // Scan tracked zones for containers
        const candidates: { x: number; z: number; level: number; locType: number }[] = [];
        for (const zone of World.zonesTracking) {
            for (const loc of zone.getAllLocsSafe()) {
                if (!this.containerLocTypeIds.has(loc.type)) continue;
                const key = `${loc.x}_${loc.z}_${loc.level}`;
                if (this.seededContainers.has(key)) continue;
                candidates.push({ x: loc.x, z: loc.z, level: loc.level, locType: loc.type });
            }
        }

        if (candidates.length > 0) {
            // Pick random container, seed it
            const picked = candidates[Math.floor(Math.random() * candidates.length)];
            const item = this.rollLootItem();
            if (!item) return;

            const key = `${picked.x}_${picked.z}_${picked.level}`;
            this.seededContainers.set(key, {
                x: picked.x,
                z: picked.z,
                level: picked.level,
                type: item.type,
                count: item.count,
                locType: picked.locType,
                seedTick: World.currentTick,
            });
        } else {
            // No containers available — seed a random NPC with a gemstone
            this.seedNpcWithGemstone();
        }
    }

    private seedNpcWithGemstone(): void {
        const gemNames = ['uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond'];
        const gemWeights = [40, 25, 15, 5];
        const totalWeight = gemWeights.reduce((a, b) => a + b, 0);

        // Roll gemstone
        let gemId = -1;
        let roll = Math.random() * totalWeight;
        for (let i = 0; i < gemNames.length; i++) {
            roll -= gemWeights[i];
            if (roll <= 0) {
                gemId = ObjType.getId(gemNames[i]);
                break;
            }
        }
        if (gemId === -1) return;

        // Find a random NPC from tracked zones
        const npcCandidates: Npc[] = [];
        for (const zone of World.zonesTracking) {
            for (const npc of zone.getAllNpcsSafe()) {
                if (!this.npcBonusDrops.has(npc.nid)) {
                    npcCandidates.push(npc);
                }
            }
        }

        if (npcCandidates.length === 0) return;

        const picked = npcCandidates[Math.floor(Math.random() * npcCandidates.length)];
        this.npcBonusDrops.set(picked.nid, { type: gemId, count: 1 });
    }

    // --- Container Claim Hook ---

    onLocInteraction(player: Player, loc: Loc): void {
        if (!this.active) return;

        const key = `${loc.x}_${loc.z}_${loc.level}`;
        const seed = this.seededContainers.get(key);
        if (!seed) return;

        // Give the item to the player
        player.invAdd(InvType.INV, seed.type, seed.count);
        const objName = ObjType.get(seed.type).name ?? 'something';
        player.messageGame('You find something unexpected!');

        // Remove the seed
        this.seededContainers.delete(key);
    }

    // --- NPC Death Bonus Drop Hook ---

    onNpcDeath(npc: Npc): void {
        if (!this.active) return;

        // Check for gem seeding bonus drops
        const bonus = this.npcBonusDrops.get(npc.nid);
        if (bonus) {
            const obj = new Obj(npc.level, npc.x, npc.z, EntityLifeCycle.DESPAWN, bonus.type, bonus.count);
            World.addObj(obj, Obj.NO_RECEIVER, 200);
            this.npcBonusDrops.delete(npc.nid);
        }

        // Check for accumulated gold from low-alching
        const gold = this.npcAccumulatedGold.get(npc.nid);
        if (gold && gold > 0) {
            const coinsId = ObjType.getId('coins');
            if (coinsId !== -1) {
                const obj = new Obj(npc.level, npc.x, npc.z, EntityLifeCycle.DESPAWN, coinsId, gold);
                World.addObj(obj, Obj.NO_RECEIVER, 200);
            }
            this.npcAccumulatedGold.delete(npc.nid);
        }

        // If this was a wandering looter, dump remaining items
        const looter = this.wanderingLooters.get(npc.nid);
        if (looter) {
            this.dumpLooterItems(looter, npc.x, npc.z, npc.level);
            this.wanderingLooters.delete(npc.nid);
        }
    }

    // --- Player Death Detection ---

    private checkPlayerDeaths(): void {
        if (!World.wowChatMode.active) return;

        for (const zone of World.zonesTracking) {
            for (const npc of zone.getAllNpcsSafe()) {
                if (!World.wowChatMode.isEncounterNpc(npc.nid)) continue;
                const meta = World.wowChatMode.getEncounterMeta(npc.nid);
                if (!meta || !meta.isHostile) continue;

                if (npc.target instanceof Player) {
                    const player = npc.target;
                    if (player.levels[PlayerStat.HITPOINTS] === 0 && !this.processedDeaths.has(player.hash64)) {
                        this.processedDeaths.add(player.hash64);
                        this.onPlayerDeathByNpc(player, npc);
                    }
                }
            }
        }
    }

    // --- Player Death Handling ---

    private onPlayerDeathByNpc(player: Player, killerNpc: Npc): void {
        // 1. Read worn inventory and drop as gravestone
        const wornInv = player.getInventory(InvType.WORN);
        const wornItems: StolenItem[] = [];
        if (wornInv) {
            for (const item of wornInv.items) {
                if (item) {
                    wornItems.push({ type: item.id, count: item.count });
                }
            }
        }

        // Drop worn items at death site (permanent ground items)
        for (const item of wornItems) {
            const obj = new Obj(player.level, player.x, player.z, EntityLifeCycle.DESPAWN, item.type, item.count);
            World.addObj(obj, Obj.NO_RECEIVER, -1);
        }

        // 2. Read main inventory — these get stolen
        const mainInv = player.getInventory(InvType.INV);
        const stolenItems: StolenItem[] = [];
        if (mainInv) {
            for (const item of mainInv.items) {
                if (item) {
                    stolenItems.push({ type: item.id, count: item.count });
                }
            }
        }

        // 3. Clear both inventories (prevents death script double-drop)
        if (wornInv) wornInv.removeAll();
        if (mainInv) mainInv.removeAll();

        // 4. Track gravestone coordinate
        if (wornItems.length > 0) {
            const key = `${player.x}_${player.z}_${player.level}`;
            this.gravestoneCoords.add(key);
        }

        // 5. Initialize wandering looter if there are stolen items
        if (stolenItems.length > 0) {
            // Sort by weight descending (heaviest first)
            stolenItems.sort((a, b) => {
                const wa = ObjType.get(a.type).weight;
                const wb = ObjType.get(b.type).weight;
                return wb - wa;
            });

            this.wanderingLooters.set(killerNpc.nid, {
                nid: killerNpc.nid,
                stolenItems,
                state: LooterState.IDLE,
                stateTicks: 0,
                targetTicks: 10, // IDLE for 10 ticks
                accumulatedGold: 0,
                lastX: killerNpc.x,
                lastZ: killerNpc.z,
                lastLevel: killerNpc.level,
            });

            killerNpc.say('*rummages through belongings*');
        }
    }

    // --- Wandering Looter AI ---

    private tickWanderingLooters(): void {
        for (const [nid, looter] of this.wanderingLooters) {
            const npc = World.npcs.get(nid);

            // NPC died or despawned — dump remaining items
            if (!npc || !npc.isActive) {
                const x = looter.lastX;
                const z = looter.lastZ;
                const level = looter.lastLevel;
                this.dumpLooterItems(looter, x, z, level);
                // Drop accumulated gold
                if (looter.accumulatedGold > 0) {
                    const coinsId = ObjType.getId('coins');
                    if (coinsId !== -1) {
                        const obj = new Obj(level, x, z, EntityLifeCycle.DESPAWN, coinsId, looter.accumulatedGold);
                        World.addObj(obj, Obj.NO_RECEIVER, -1);
                    }
                }
                this.wanderingLooters.delete(nid);
                continue;
            }

            // Update last known position
            looter.lastX = npc.x;
            looter.lastZ = npc.z;
            looter.lastLevel = npc.level;

            // Check for combat interruption
            if (npc.target && looter.state !== LooterState.FIGHTING && looter.state !== LooterState.HUNTING) {
                looter.state = LooterState.FIGHTING;
                looter.stateTicks = 0;
            }

            // Process state machine
            switch (looter.state) {
                case LooterState.IDLE:
                    this.tickLooterIdle(npc, looter);
                    break;
                case LooterState.DROPPING:
                    this.tickLooterDropping(npc, looter);
                    break;
                case LooterState.WALKING:
                    this.tickLooterWalking(npc, looter);
                    break;
                case LooterState.WANDERING:
                    this.tickLooterWandering(npc, looter);
                    break;
                case LooterState.FIGHTING:
                    this.tickLooterFighting(npc, looter);
                    break;
                case LooterState.HUNTING:
                    this.tickLooterHunting(npc, looter);
                    break;
            }
        }
    }

    private tickLooterIdle(_npc: Npc, looter: WanderingLooter): void {
        looter.stateTicks++;
        if (looter.stateTicks >= looter.targetTicks) {
            looter.state = LooterState.DROPPING;
            looter.stateTicks = 0;
        }
    }

    private tickLooterDropping(npc: Npc, looter: WanderingLooter): void {
        if (looter.stolenItems.length === 0) {
            // No more items — transition to HUNTING
            looter.state = LooterState.HUNTING;
            looter.stateTicks = 0;
            looter.targetTicks = 0;
            return;
        }

        const item = looter.stolenItems.shift()!;
        const objType = ObjType.get(item.type);
        const itemName = objType.name ?? 'something';

        // 50% chance to low-alch instead of dropping
        if (Math.random() < 0.5) {
            // Low-alch: 40% of base price
            const alchValue = Math.floor(objType.cost * 2 / 5);
            looter.accumulatedGold += alchValue;
            // Also store in npcAccumulatedGold for the NPC death case
            const prevGold = this.npcAccumulatedGold.get(npc.nid) ?? 0;
            this.npcAccumulatedGold.set(npc.nid, prevGold + alchValue);
            npc.say(`*examines ${itemName}*`);
        } else {
            // Drop the item as permanent ground item
            const obj = new Obj(npc.level, npc.x, npc.z, EntityLifeCycle.DESPAWN, item.type, item.count);
            World.addObj(obj, Obj.NO_RECEIVER, -1);
            npc.say(`*drops ${itemName}*`);
        }

        // Transition based on remaining items
        if (looter.stolenItems.length > 0) {
            looter.state = LooterState.WALKING;
            looter.stateTicks = 0;
            looter.targetTicks = 200; // max walk ticks before forced transition
            this.sendLooterWalking(npc, 156);
        } else {
            // Last item dropped — transition to HUNTING
            looter.state = LooterState.HUNTING;
            looter.stateTicks = 0;
            looter.targetTicks = 0;
        }
    }

    private tickLooterWalking(npc: Npc, looter: WanderingLooter): void {
        looter.stateTicks++;

        // Check for nearby hostile NPCs during walk (within 5 tiles)
        if (looter.stateTicks % 5 === 0) {
            this.checkLooterForNearbyHostiles(npc, looter);
        }

        // Arrived or max ticks elapsed
        if (!npc.hasWaypoints() || looter.stateTicks >= looter.targetTicks) {
            looter.state = LooterState.WANDERING;
            looter.stateTicks = 0;
            looter.targetTicks = 70 + Math.floor(Math.random() * 72); // 30-60 seconds (70-142 ticks)
        }
    }

    private tickLooterWandering(npc: Npc, looter: WanderingLooter): void {
        looter.stateTicks++;

        // Random small movements every ~20 ticks
        if (looter.stateTicks % 20 === 0 && !npc.hasWaypoints()) {
            const dx = Math.floor(Math.random() * 11) - 5;
            const dz = Math.floor(Math.random() * 11) - 5;
            const targetX = npc.x + dx;
            const targetZ = npc.z + dz;
            if (!isFlagged(targetX, targetZ, npc.level, CollisionFlag.WALK_BLOCKED)) {
                npc.queueWaypoint(targetX, targetZ);
            }
        }

        if (looter.stateTicks >= looter.targetTicks) {
            looter.state = LooterState.DROPPING;
            looter.stateTicks = 0;
        }
    }

    private tickLooterFighting(npc: Npc, looter: WanderingLooter): void {
        if (!npc.target) {
            // Combat ended — resume walking
            looter.state = LooterState.WALKING;
            looter.stateTicks = 0;
            looter.targetTicks = 200;
            this.sendLooterWalking(npc, 80);
        }
    }

    private tickLooterHunting(npc: Npc, looter: WanderingLooter): void {
        looter.stateTicks++;

        // If we have a target and are fighting, stay in HUNTING until combat ends
        if (npc.target) {
            return;
        }

        // Find nearest hostile character
        const target = this.findNearestHostile(npc);
        if (target) {
            npc.targetOp = NpcMode.APPLAYER1;
            npc.setInteraction(Interaction.SCRIPT, target, NpcMode.APPLAYER1);
            return;
        }

        // No targets found — remove from looter system after a grace period
        if (looter.stateTicks > 20) {
            // Drop accumulated gold if any
            if (looter.accumulatedGold > 0) {
                const coinsId = ObjType.getId('coins');
                if (coinsId !== -1) {
                    const obj = new Obj(npc.level, npc.x, npc.z, EntityLifeCycle.DESPAWN, coinsId, looter.accumulatedGold);
                    World.addObj(obj, Obj.NO_RECEIVER, -1);
                }
            }
            this.wanderingLooters.delete(npc.nid);
        }
    }

    private sendLooterWalking(npc: Npc, distance: number): void {
        // Walk ~distance tiles in a random direction
        const angle = Math.random() * Math.PI * 2;
        const targetX = Math.floor(npc.x + Math.cos(angle) * distance);
        const targetZ = Math.floor(npc.z + Math.sin(angle) * distance);

        npc.clearInteraction();
        npc.queueWaypoint(targetX, targetZ);
    }

    private checkLooterForNearbyHostiles(npc: Npc, looter: WanderingLooter): void {
        if (npc.target) return; // already fighting

        for (const zone of World.zonesTracking) {
            for (const otherNpc of zone.getAllNpcsSafe()) {
                if (otherNpc.nid === npc.nid) continue;
                if (!World.wowChatMode.isEncounterNpc(otherNpc.nid)) continue;
                const meta = World.wowChatMode.getEncounterMeta(otherNpc.nid);
                if (!meta || !meta.isHostile) continue;

                const dx = Math.abs(npc.x - otherNpc.x);
                const dz = Math.abs(npc.z - otherNpc.z);
                if (dx <= 5 && dz <= 5) {
                    npc.setInteraction(Interaction.SCRIPT, otherNpc, NpcMode.OPNPC1);
                    npc.targetOp = NpcMode.OPNPC1;
                    looter.state = LooterState.FIGHTING;
                    looter.stateTicks = 0;
                    return;
                }
            }
        }
    }

    private findNearestHostile(npc: Npc): Player | Npc | null {
        let bestTarget: Player | Npc | null = null;
        let bestDist = Infinity;

        // Check players
        for (const player of World.players) {
            if (!player || !player.isActive) continue;
            if (player.level !== npc.level) continue;

            const dx = Math.abs(npc.x - player.x);
            const dz = Math.abs(npc.z - player.z);
            const dist = dx + dz;
            if (dist < bestDist && dist < 30) {
                bestDist = dist;
                bestTarget = player;
            }
        }

        // Check other NPCs
        for (const zone of World.zonesTracking) {
            for (const otherNpc of zone.getAllNpcsSafe()) {
                if (otherNpc.nid === npc.nid) continue;
                if (otherNpc.level !== npc.level) continue;

                const dx = Math.abs(npc.x - otherNpc.x);
                const dz = Math.abs(npc.z - otherNpc.z);
                const dist = dx + dz;
                if (dist < bestDist && dist < 30) {
                    bestDist = dist;
                    bestTarget = otherNpc;
                }
            }
        }

        return bestTarget;
    }

    // --- Monster Gravestone Looting ---

    private tickMonsterGravestoneLooting(): void {
        if (this.gravestoneCoords.size === 0) return;

        // Decrement cooldowns
        for (const [nid, cooldown] of this.npcLootCooldowns) {
            if (cooldown <= 1) {
                this.npcLootCooldowns.delete(nid);
            } else {
                this.npcLootCooldowns.set(nid, cooldown - 1);
            }
        }

        // For each gravestone coordinate, check for nearby hostile NPCs
        const toRemove: string[] = [];

        for (const coordKey of this.gravestoneCoords) {
            const parts = coordKey.split('_');
            const gx = parseInt(parts[0]);
            const gz = parseInt(parts[1]);
            const glevel = parseInt(parts[2]);

            // Check if there are still objs at this coordinate
            const zone = World.gameMap.getZone(gx, gz, glevel);
            let hasObjs = false;
            for (const obj of zone.getAllObjsSafe()) {
                if (obj.x === gx && obj.z === gz && obj.level === glevel) {
                    hasObjs = true;
                    break;
                }
            }

            if (!hasObjs) {
                toRemove.push(coordKey);
                continue;
            }

            // Find encounter NPCs within 1 tile
            for (const npc of zone.getAllNpcsSafe()) {
                if (!World.wowChatMode.isEncounterNpc(npc.nid)) continue;
                if (this.npcLootCooldowns.has(npc.nid)) continue;

                const dx = Math.abs(npc.x - gx);
                const dz = Math.abs(npc.z - gz);
                if (dx > 1 || dz > 1) continue;

                // Pick up one random obj from the gravestone tile
                const objs: Obj[] = [];
                for (const obj of zone.getAllObjsSafe()) {
                    if (obj.x === gx && obj.z === gz && obj.level === glevel) {
                        objs.push(obj);
                    }
                }

                if (objs.length === 0) break;

                const pickedObj = objs[Math.floor(Math.random() * objs.length)];
                const objType = ObjType.get(pickedObj.type);
                const itemName = objType.name ?? 'something';

                // Remove the obj from the world
                World.removeObj(pickedObj, 0);

                // Low-alch it
                const alchValue = Math.floor(objType.cost * 2 / 5);
                const prevGold = this.npcAccumulatedGold.get(npc.nid) ?? 0;
                this.npcAccumulatedGold.set(npc.nid, prevGold + alchValue);

                npc.say(`*pockets ${itemName}*`);

                // Set cooldown (10 ticks per NPC)
                this.npcLootCooldowns.set(npc.nid, 10);

                break; // One NPC loots one item per gravestone per tick
            }
        }

        for (const key of toRemove) {
            this.gravestoneCoords.delete(key);
        }
    }

    // --- Fire Destruction ---

    private tickFireDestruction(): void {
        this.fireTickCounter++;
        if (this.fireTickCounter < 5) return;
        this.fireTickCounter = 0;

        // Iterate tracked zones for fire locs
        for (const zone of World.zonesTracking) {
            for (const loc of zone.getAllLocsSafe()) {
                const locType = LocType.get(loc.type);
                if (!locType.name) continue;
                const name = locType.name.toLowerCase();
                if (!name.includes('fire') && !name.includes('campfire')) continue;

                // Find one obj at the fire's tile and destroy it
                for (const obj of zone.getAllObjsSafe()) {
                    if (obj.x === loc.x && obj.z === loc.z && obj.level === loc.level) {
                        World.removeObj(obj, 0);
                        break; // one item per fire per cycle
                    }
                }
            }
        }
    }

    // --- Helpers ---

    private dumpLooterItems(looter: WanderingLooter, x: number, z: number, level: number): void {
        for (const item of looter.stolenItems) {
            const obj = new Obj(level, x, z, EntityLifeCycle.DESPAWN, item.type, item.count);
            World.addObj(obj, Obj.NO_RECEIVER, -1);
        }
        looter.stolenItems = [];
    }
}
