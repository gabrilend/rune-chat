// item-memory.ts - Persistent item knowledge system
//
// Bots learn about items through experience:
// - Seeing items on the ground (ground spawns)
// - Looting items from monsters (drops)
// - Crafting items (recipes)
// - Being told by other players
//
// Memory is stored per-bot in their account directory.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * A known ground spawn location for an item.
 */
export interface GroundSpawnEntry {
    location: { x: number; z: number };
    regionName: string;           // Natural language location
    lastSeen: number;             // Timestamp when last confirmed
    verified: boolean;            // True if we've seen it respawn
    verificationAttempts: number; // Times we've checked and it wasn't there
    source: 'observed' | 'told';  // How we learned this
    toldBy?: string;              // Who told us (if source is 'told')
}

/**
 * A known monster that drops an item.
 */
export interface MonsterDropEntry {
    monsterName: string;
    regionName?: string;          // Where we killed it (general area)
    lastLooted: number;           // Timestamp
    dropCount: number;            // How many times we've looted this
    source: 'looted' | 'told';
    toldBy?: string;
}

/**
 * A known crafting recipe.
 */
export interface CraftingRecipeEntry {
    ingredients: Array<{ item: string; quantity: number }>;
    skill: string;                // e.g., "smithing", "crafting"
    skillLevel?: number;          // Required level if known
    tool?: string;                // e.g., "hammer"
    location?: string;            // e.g., "any anvil", "furnace"
    learnedAt: number;
    craftCount: number;           // How many times we've made this
    source: 'crafted' | 'told';
    toldBy?: string;
}

/**
 * An active search for an item requested by someone.
 */
export interface ActiveSearch {
    requestedBy: string;
    requestedAt: number;
    quantity: number;
    triedLocations: Array<{
        x: number;
        z: number;
        regionName: string;
        checkedAt: number;
        waitedMs: number;         // How long we waited for respawn
        result: 'found' | 'not_found' | 'partial';
    }>;
}

/**
 * The complete item memory for a bot.
 */
export interface ItemMemoryData {
    // Version for future migrations
    version: number;

    // Ground spawns by item name (lowercase)
    groundSpawns: Record<string, GroundSpawnEntry[]>;

    // Monster drops by item name (lowercase)
    monsterDrops: Record<string, MonsterDropEntry[]>;

    // Crafting recipes by item name (lowercase)
    craftingRecipes: Record<string, CraftingRecipeEntry>;

    // Active searches (items we're looking for)
    activeSearches: Record<string, ActiveSearch>;

    // General item notes (for misc info from conversations)
    itemNotes: Record<string, string[]>;
}

const CURRENT_VERSION = 1;
const MAX_VERIFICATION_ATTEMPTS = 3;  // Remove ground spawn after this many misses
const RESPAWN_WAIT_MS = 60000;        // Wait 1 min for respawn before giving up

/**
 * Item memory manager for a bot.
 *
 * Usage:
 *   const memory = new ItemMemory('/path/to/bot/memory.json');
 *   await memory.load();
 *
 *   // Learning
 *   memory.sawItemOnGround('bronze bar', { x: 3000, z: 3400 }, 'Barbarian Village');
 *   memory.lootedFromMonster('bones', 'Goblin', 'Lumbridge');
 *   memory.craftedItem('bronze dagger', [{ item: 'bronze bar', quantity: 1 }], 'smithing');
 *
 *   // Querying
 *   const sources = memory.whereToFind('bronze bar');
 *   const canMake = memory.canCraft('bronze dagger');
 */
export class ItemMemory {
    private filePath: string;
    private data: ItemMemoryData;
    private dirty: boolean = false;
    private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.data = this.createEmpty();
    }

    private createEmpty(): ItemMemoryData {
        return {
            version: CURRENT_VERSION,
            groundSpawns: {},
            monsterDrops: {},
            craftingRecipes: {},
            activeSearches: {},
            itemNotes: {},
        };
    }

    /**
     * Load memory from disk.
     */
    load(): void {
        if (!existsSync(this.filePath)) {
            this.data = this.createEmpty();
            return;
        }

        try {
            const raw = readFileSync(this.filePath, 'utf-8');
            this.data = JSON.parse(raw);

            // Migrate if needed
            if (this.data.version < CURRENT_VERSION) {
                this.migrate();
            }
        } catch (err) {
            console.error(`[ItemMemory] Failed to load ${this.filePath}: ${err}`);
            this.data = this.createEmpty();
        }
    }

    /**
     * Save memory to disk.
     */
    save(): void {
        try {
            const dir = dirname(this.filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            this.dirty = false;
        } catch (err) {
            console.error(`[ItemMemory] Failed to save ${this.filePath}: ${err}`);
        }
    }

    /**
     * Start auto-saving every N seconds.
     */
    startAutoSave(intervalMs: number = 30000): void {
        if (this.autoSaveInterval) return;
        this.autoSaveInterval = setInterval(() => {
            if (this.dirty) {
                this.save();
            }
        }, intervalMs);
    }

    /**
     * Stop auto-saving.
     */
    stopAutoSave(): void {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        // Final save
        if (this.dirty) {
            this.save();
        }
    }

    private migrate(): void {
        // Future migration logic here
        this.data.version = CURRENT_VERSION;
        this.dirty = true;
    }

    private normalizeItemName(name: string): string {
        return name.toLowerCase().trim();
    }

    // ========== LEARNING METHODS ==========

    /**
     * Record seeing an item on the ground.
     */
    sawItemOnGround(
        itemName: string,
        location: { x: number; z: number },
        regionName: string
    ): void {
        const key = this.normalizeItemName(itemName);
        if (!this.data.groundSpawns[key]) {
            this.data.groundSpawns[key] = [];
        }

        // Check if we already know this location
        const existing = this.data.groundSpawns[key].find(
            e => Math.abs(e.location.x - location.x) < 5 &&
                 Math.abs(e.location.z - location.z) < 5
        );

        if (existing) {
            // Update existing entry
            existing.lastSeen = Date.now();
            existing.verified = true;  // We just saw it
            existing.verificationAttempts = 0;
        } else {
            // Add new entry
            this.data.groundSpawns[key].push({
                location,
                regionName,
                lastSeen: Date.now(),
                verified: false,  // Haven't confirmed respawn yet
                verificationAttempts: 0,
                source: 'observed',
            });
        }

        this.dirty = true;
    }

    /**
     * Record looting an item from a monster.
     */
    lootedFromMonster(
        itemName: string,
        monsterName: string,
        regionName?: string
    ): void {
        const key = this.normalizeItemName(itemName);
        if (!this.data.monsterDrops[key]) {
            this.data.monsterDrops[key] = [];
        }

        const normalizedMonster = monsterName.toLowerCase().trim();
        const existing = this.data.monsterDrops[key].find(
            e => e.monsterName.toLowerCase() === normalizedMonster
        );

        if (existing) {
            existing.lastLooted = Date.now();
            existing.dropCount++;
            if (regionName && !existing.regionName) {
                existing.regionName = regionName;
            }
        } else {
            this.data.monsterDrops[key].push({
                monsterName,
                regionName,
                lastLooted: Date.now(),
                dropCount: 1,
                source: 'looted',
            });
        }

        this.dirty = true;
    }

    /**
     * Record crafting an item.
     */
    craftedItem(
        itemName: string,
        ingredients: Array<{ item: string; quantity: number }>,
        skill: string,
        options?: {
            skillLevel?: number;
            tool?: string;
            location?: string;
        }
    ): void {
        const key = this.normalizeItemName(itemName);
        const existing = this.data.craftingRecipes[key];

        if (existing) {
            existing.craftCount++;
            // Update details if we learn more
            if (options?.skillLevel && !existing.skillLevel) {
                existing.skillLevel = options.skillLevel;
            }
        } else {
            this.data.craftingRecipes[key] = {
                ingredients,
                skill,
                skillLevel: options?.skillLevel,
                tool: options?.tool,
                location: options?.location,
                learnedAt: Date.now(),
                craftCount: 1,
                source: 'crafted',
            };
        }

        this.dirty = true;
    }

    /**
     * Record being told about an item source.
     */
    toldAboutGroundSpawn(
        itemName: string,
        location: { x: number; z: number },
        regionName: string,
        toldBy: string
    ): void {
        const key = this.normalizeItemName(itemName);
        if (!this.data.groundSpawns[key]) {
            this.data.groundSpawns[key] = [];
        }

        // Check if we already know this location
        const existing = this.data.groundSpawns[key].find(
            e => Math.abs(e.location.x - location.x) < 5 &&
                 Math.abs(e.location.z - location.z) < 5
        );

        if (!existing) {
            this.data.groundSpawns[key].push({
                location,
                regionName,
                lastSeen: 0,  // Haven't verified yet
                verified: false,
                verificationAttempts: 0,
                source: 'told',
                toldBy,
            });
            this.dirty = true;
        }
    }

    /**
     * Record being told about a monster drop.
     */
    toldAboutMonsterDrop(
        itemName: string,
        monsterName: string,
        toldBy: string,
        regionName?: string
    ): void {
        const key = this.normalizeItemName(itemName);
        if (!this.data.monsterDrops[key]) {
            this.data.monsterDrops[key] = [];
        }

        const normalizedMonster = monsterName.toLowerCase().trim();
        const existing = this.data.monsterDrops[key].find(
            e => e.monsterName.toLowerCase() === normalizedMonster
        );

        if (!existing) {
            this.data.monsterDrops[key].push({
                monsterName,
                regionName,
                lastLooted: 0,
                dropCount: 0,
                source: 'told',
                toldBy,
            });
            this.dirty = true;
        }
    }

    /**
     * Record being told about a crafting recipe.
     */
    toldAboutRecipe(
        itemName: string,
        ingredients: Array<{ item: string; quantity: number }>,
        skill: string,
        toldBy: string,
        options?: {
            skillLevel?: number;
            tool?: string;
            location?: string;
        }
    ): void {
        const key = this.normalizeItemName(itemName);
        if (!this.data.craftingRecipes[key]) {
            this.data.craftingRecipes[key] = {
                ingredients,
                skill,
                skillLevel: options?.skillLevel,
                tool: options?.tool,
                location: options?.location,
                learnedAt: Date.now(),
                craftCount: 0,
                source: 'told',
                toldBy,
            };
            this.dirty = true;
        }
    }

    /**
     * Record that we went to a location and the item wasn't there.
     */
    groundSpawnNotFound(
        itemName: string,
        location: { x: number; z: number },
        waitedMs: number
    ): { removed: boolean; remainingSources: number } {
        const key = this.normalizeItemName(itemName);
        const spawns = this.data.groundSpawns[key];
        if (!spawns) {
            return { removed: false, remainingSources: 0 };
        }

        const idx = spawns.findIndex(
            e => Math.abs(e.location.x - location.x) < 5 &&
                 Math.abs(e.location.z - location.z) < 5
        );

        if (idx === -1) {
            return { removed: false, remainingSources: spawns.length };
        }

        const entry = spawns[idx];
        entry.verificationAttempts++;

        // If waited long enough for respawn and still not there, it was probably player-dropped
        if (waitedMs >= RESPAWN_WAIT_MS || entry.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
            spawns.splice(idx, 1);
            this.dirty = true;
            return { removed: true, remainingSources: spawns.length };
        }

        this.dirty = true;
        return { removed: false, remainingSources: spawns.length };
    }

    // ========== QUERY METHODS ==========

    /**
     * Get all known sources for an item.
     * Returns sources sorted by reliability/convenience.
     */
    whereToFind(itemName: string): {
        groundSpawns: GroundSpawnEntry[];
        monsterDrops: MonsterDropEntry[];
        canCraft: CraftingRecipeEntry | null;
        hasAnySource: boolean;
    } {
        const key = this.normalizeItemName(itemName);

        const groundSpawns = (this.data.groundSpawns[key] || [])
            .slice()
            .sort((a, b) => {
                // Prefer verified spawns
                if (a.verified !== b.verified) return a.verified ? -1 : 1;
                // Then prefer observed over told
                if (a.source !== b.source) return a.source === 'observed' ? -1 : 1;
                // Then prefer recently seen
                return b.lastSeen - a.lastSeen;
            });

        const monsterDrops = (this.data.monsterDrops[key] || [])
            .slice()
            .sort((a, b) => {
                // Prefer looted over told
                if (a.source !== b.source) return a.source === 'looted' ? -1 : 1;
                // Then prefer higher drop count
                return b.dropCount - a.dropCount;
            });

        const canCraft = this.data.craftingRecipes[key] || null;

        return {
            groundSpawns,
            monsterDrops,
            canCraft,
            hasAnySource: groundSpawns.length > 0 || monsterDrops.length > 0 || canCraft !== null,
        };
    }

    /**
     * Check if we know how to craft an item.
     */
    canCraft(itemName: string): CraftingRecipeEntry | null {
        const key = this.normalizeItemName(itemName);
        return this.data.craftingRecipes[key] || null;
    }

    /**
     * Get the best ground spawn location for an item.
     */
    getBestGroundSpawn(itemName: string): GroundSpawnEntry | null {
        const sources = this.whereToFind(itemName);
        return sources.groundSpawns[0] || null;
    }

    /**
     * Get monsters that drop an item.
     */
    getMonstersThatDrop(itemName: string): MonsterDropEntry[] {
        const key = this.normalizeItemName(itemName);
        return this.data.monsterDrops[key] || [];
    }

    // ========== ACTIVE SEARCH MANAGEMENT ==========

    /**
     * Start tracking a search for an item.
     */
    startSearch(itemName: string, requestedBy: string, quantity: number = 1): void {
        const key = this.normalizeItemName(itemName);
        this.data.activeSearches[key] = {
            requestedBy,
            requestedAt: Date.now(),
            quantity,
            triedLocations: [],
        };
        this.dirty = true;
    }

    /**
     * Record trying a location during a search.
     */
    recordSearchAttempt(
        itemName: string,
        location: { x: number; z: number },
        regionName: string,
        waitedMs: number,
        result: 'found' | 'not_found' | 'partial'
    ): void {
        const key = this.normalizeItemName(itemName);
        const search = this.data.activeSearches[key];
        if (!search) return;

        search.triedLocations.push({
            x: location.x,
            z: location.z,
            regionName,
            checkedAt: Date.now(),
            waitedMs,
            result,
        });
        this.dirty = true;
    }

    /**
     * Get active search for an item.
     */
    getActiveSearch(itemName: string): ActiveSearch | null {
        const key = this.normalizeItemName(itemName);
        return this.data.activeSearches[key] || null;
    }

    /**
     * Complete/cancel a search.
     */
    endSearch(itemName: string): void {
        const key = this.normalizeItemName(itemName);
        delete this.data.activeSearches[key];
        this.dirty = true;
    }

    // ========== NOTES ==========

    /**
     * Add a general note about an item.
     */
    addNote(itemName: string, note: string): void {
        const key = this.normalizeItemName(itemName);
        if (!this.data.itemNotes[key]) {
            this.data.itemNotes[key] = [];
        }
        this.data.itemNotes[key].push(note);
        this.dirty = true;
    }

    /**
     * Get notes about an item.
     */
    getNotes(itemName: string): string[] {
        const key = this.normalizeItemName(itemName);
        return this.data.itemNotes[key] || [];
    }

    // ========== LLM FORMATTING ==========

    /**
     * Format item knowledge for LLM context.
     */
    formatForLLM(itemName: string): string {
        const sources = this.whereToFind(itemName);
        const lines: string[] = [`Knowledge about "${itemName}":`];

        if (!sources.hasAnySource) {
            lines.push('  I don\'t know where to find this item.');
            return lines.join('\n');
        }

        // Ground spawns
        if (sources.groundSpawns.length > 0) {
            lines.push('  Ground spawns:');
            for (const spawn of sources.groundSpawns.slice(0, 3)) {
                const verified = spawn.verified ? '(verified)' : '(unverified)';
                const source = spawn.source === 'told' ? ` - told by ${spawn.toldBy}` : '';
                lines.push(`    - ${spawn.regionName} ${verified}${source}`);
            }
        }

        // Monster drops
        if (sources.monsterDrops.length > 0) {
            lines.push('  Monster drops:');
            for (const drop of sources.monsterDrops.slice(0, 3)) {
                const region = drop.regionName ? ` (${drop.regionName})` : '';
                const source = drop.source === 'told' ? ` - told by ${drop.toldBy}` : ` (looted ${drop.dropCount}x)`;
                lines.push(`    - ${drop.monsterName}${region}${source}`);
            }
        }

        // Crafting
        if (sources.canCraft) {
            const recipe = sources.canCraft;
            const ingredients = recipe.ingredients.map(i => `${i.quantity}x ${i.item}`).join(', ');
            const location = recipe.location ? ` at ${recipe.location}` : '';
            lines.push(`  Crafting: ${recipe.skill}${location}`);
            lines.push(`    Ingredients: ${ingredients}`);
            if (recipe.source === 'told') {
                lines.push(`    (told by ${recipe.toldBy})`);
            }
        }

        // Notes
        const notes = this.getNotes(itemName);
        if (notes.length > 0) {
            lines.push('  Notes:');
            for (const note of notes.slice(0, 3)) {
                lines.push(`    - ${note}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Get a summary of what we know for the LLM.
     */
    getSummaryForLLM(): string {
        const groundCount = Object.keys(this.data.groundSpawns).length;
        const monsterCount = Object.keys(this.data.monsterDrops).length;
        const recipeCount = Object.keys(this.data.craftingRecipes).length;
        const searchCount = Object.keys(this.data.activeSearches).length;

        let summary = `Item knowledge: ${groundCount} ground spawns, ${monsterCount} monster drops, ${recipeCount} recipes known.`;

        if (searchCount > 0) {
            const searches = Object.entries(this.data.activeSearches)
                .map(([item, s]) => `${item} (for ${s.requestedBy})`)
                .join(', ');
            summary += `\nActive searches: ${searches}`;
        }

        return summary;
    }
}

/**
 * Create an item memory for a bot.
 * @param accountDir - Path to the bot's account directory (e.g., 'rs-sdk/accounts/chattybot')
 */
export function createItemMemory(accountDir: string): ItemMemory {
    const filePath = `${accountDir}/memory.json`;
    return new ItemMemory(filePath);
}
