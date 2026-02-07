/**
 * sovereign-memory.ts - Isolated RAM/ROM Memory Architecture for Bot Sovereignty
 *
 * Each bot has a completely isolated "mind" with:
 * - ROM: Read-only persistent knowledge (loaded at startup)
 * - RAM: Ephemeral working memory (lost on shutdown unless persisted)
 * - VM: Sandboxed execution environment that can only affect this bot's mind
 *
 * PERSISTENCE RULES:
 * - RAM is ONLY written to disk at:
 *   1. Clean shutdown
 *   2. Every 30 minutes (auto-checkpoint)
 *   3. Level-up events
 * - All other times, RAM changes are ephemeral
 *
 * ISOLATION RULES:
 * - Tools can ONLY read/write to this bot's RAM
 * - No filesystem access outside the bot's memory slice
 * - No access to other bots' memories
 * - Network calls go through a bytecode VM layer
 *
 * BYTECODE VM:
 * - Scripts are encoded as JSON bytecode
 * - VM interprets bytecode and executes against RAM only
 * - No direct code execution - all operations are declarative
 */

export interface SovereignMemoryConfig {
    /** Directory for this bot's persistent storage (ROM source) */
    botId: string;
    accountDir: string;

    /** Auto-checkpoint interval in milliseconds (default: 30 minutes) */
    checkpointIntervalMs?: number;

    /** Enable debug logging */
    debug?: boolean;
}

/** ROM structure - read-only after load */
export interface ROMData {
    // Identity (immutable)
    identity: {
        name: string;
        personality: string;
        personalityPreset: string | null;
        backstory: string | null;
        birthday: string | null;
        playingSince: number | null;
        createdAt: string;
    };

    // Learned knowledge (loaded from persistent storage)
    knowledge: {
        itemMemory: any;      // Ground spawns, drops, recipes
        locationMemory: any;  // Places visited, directions
        socialMemory: any;    // Players met, relationships
    };

    // Skills/stats at last checkpoint
    stats: {
        levels: Record<string, number>;
        totalLevel: number;
        combatLevel: number;
    };
}

/** RAM structure - ephemeral working memory */
export interface RAMData {
    // Current session state
    session: {
        startedAt: string;
        lastCheckpoint: string | null;
        uptimeSeconds: number;
    };

    // Working memory (lost on crash, saved on checkpoint)
    working: {
        currentTask: any | null;
        taskQueue: any[];
        recentEvents: any[];
        conversationContext: any[];
        shortTermMemory: Map<string, any>;
    };

    // Pending knowledge updates (merged to ROM on checkpoint)
    pendingKnowledge: {
        newItemDiscoveries: any[];
        newLocationVisits: any[];
        newSocialInteractions: any[];
    };

    // Delta from ROM (changes since last checkpoint)
    delta: {
        statsChanged: boolean;
        knowledgeChanged: boolean;
        dirty: boolean;
    };
}

/** Bytecode operation types for the VM */
export type BytecodeOp =
    | { op: 'read'; path: string[] }
    | { op: 'write'; path: string[]; value: any }
    | { op: 'append'; path: string[]; value: any }
    | { op: 'delete'; path: string[] }
    | { op: 'query'; path: string[]; filter: any }
    | { op: 'call'; method: string; args: any[] };

/** Bytecode program - JSON-serializable */
export interface BytecodeProgram {
    version: 1;
    botId: string;
    operations: BytecodeOp[];
    timestamp: string;
    signature?: string; // Optional HMAC for verification
}

export class SovereignMemory {
    private rom: ROMData;
    private ram: RAMData;
    private config: Required<SovereignMemoryConfig>;
    private checkpointTimer: ReturnType<typeof setInterval> | null = null;
    private shutdownHandlerRegistered = false;

    constructor(config: SovereignMemoryConfig) {
        this.config = {
            checkpointIntervalMs: 30 * 60 * 1000, // 30 minutes
            debug: false,
            ...config,
        };

        this.rom = this.createEmptyROM();
        this.ram = this.createEmptyRAM();
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    /** Initialize: Load ROM from disk, start checkpoint timer */
    async initialize(): Promise<void> {
        this.log('Initializing sovereign memory...');

        // Load ROM from persistent storage
        await this.loadROM();

        // Initialize RAM
        this.ram = this.createEmptyRAM();
        this.ram.session.startedAt = new Date().toISOString();

        // Start auto-checkpoint timer
        this.startCheckpointTimer();

        // Register shutdown handler
        this.registerShutdownHandler();

        this.log('Sovereign memory initialized');
    }

    /** Shutdown: Persist RAM to ROM, cleanup */
    async shutdown(): Promise<void> {
        this.log('Shutting down sovereign memory...');

        // Stop checkpoint timer
        this.stopCheckpointTimer();

        // Final checkpoint
        await this.checkpoint('shutdown');

        this.log('Sovereign memory shutdown complete');
    }

    /** Checkpoint: Persist RAM changes to disk */
    async checkpoint(reason: 'auto' | 'shutdown' | 'level_up'): Promise<void> {
        if (!this.ram.delta.dirty) {
            this.log(`Checkpoint (${reason}): No changes to persist`);
            return;
        }

        this.log(`Checkpoint (${reason}): Persisting RAM to disk...`);

        // Merge pending knowledge into ROM
        await this.mergeKnowledgeToROM();

        // Save ROM to disk
        await this.saveROM();

        // Update checkpoint timestamp
        this.ram.session.lastCheckpoint = new Date().toISOString();
        this.ram.delta.dirty = false;

        this.log(`Checkpoint (${reason}): Complete`);
    }

    /** Trigger checkpoint on level-up */
    async onLevelUp(skill: string, newLevel: number): Promise<void> {
        this.log(`Level up: ${skill} -> ${newLevel}`);
        this.ram.delta.statsChanged = true;
        this.ram.delta.dirty = true;
        await this.checkpoint('level_up');
    }

    // =========================================================================
    // BYTECODE VM - Sandboxed execution
    // =========================================================================

    /** Execute a bytecode program against RAM only */
    executeProgram(program: BytecodeProgram): any[] {
        // Verify program is for this bot
        if (program.botId !== this.config.botId) {
            throw new Error(`Program botId mismatch: expected ${this.config.botId}, got ${program.botId}`);
        }

        const results: any[] = [];

        for (const op of program.operations) {
            try {
                const result = this.executeOp(op);
                results.push({ success: true, result });
            } catch (error: any) {
                results.push({ success: false, error: error.message });
            }
        }

        return results;
    }

    /** Execute a single bytecode operation */
    private executeOp(op: BytecodeOp): any {
        switch (op.op) {
            case 'read':
                return this.readPath(op.path);
            case 'write':
                this.writePath(op.path, op.value);
                return true;
            case 'append':
                this.appendPath(op.path, op.value);
                return true;
            case 'delete':
                this.deletePath(op.path);
                return true;
            case 'query':
                return this.queryPath(op.path, op.filter);
            case 'call':
                return this.callMethod(op.method, op.args);
            default:
                throw new Error(`Unknown operation: ${(op as any).op}`);
        }
    }

    // =========================================================================
    // TOOL INTERFACE - For LLM tools (sandboxed)
    // =========================================================================

    /**
     * Get the virtual filesystem root for this bot's tools.
     * All tool read/write operations are relative to this path.
     * Actually operates on RAM, not the real filesystem.
     */
    getVirtualRoot(): string {
        return `/bot/${this.config.botId}/`;
    }

    /** Read a "file" from the virtual filesystem (actually reads from RAM) */
    readVirtualFile(path: string): string | null {
        const normalized = this.normalizePath(path);
        const data = this.ram.working.shortTermMemory.get(`file:${normalized}`);
        return data ?? null;
    }

    /** Write a "file" to the virtual filesystem (actually writes to RAM) */
    writeVirtualFile(path: string, content: string): void {
        const normalized = this.normalizePath(path);
        this.ram.working.shortTermMemory.set(`file:${normalized}`, content);
        this.ram.delta.dirty = true;
    }

    /** List "files" in the virtual filesystem */
    listVirtualFiles(prefix: string = ''): string[] {
        const normalized = this.normalizePath(prefix);
        const files: string[] = [];

        for (const key of this.ram.working.shortTermMemory.keys()) {
            if (key.startsWith('file:') && key.includes(normalized)) {
                files.push(key.slice(5)); // Remove 'file:' prefix
            }
        }

        return files;
    }

    /** Delete a "file" from the virtual filesystem */
    deleteVirtualFile(path: string): boolean {
        const normalized = this.normalizePath(path);
        const existed = this.ram.working.shortTermMemory.has(`file:${normalized}`);
        this.ram.working.shortTermMemory.delete(`file:${normalized}`);
        if (existed) this.ram.delta.dirty = true;
        return existed;
    }

    // =========================================================================
    // KNOWLEDGE ACCESS (read from ROM, write to pending)
    // =========================================================================

    /** Get item knowledge (read-only from ROM) */
    getItemKnowledge(): any {
        return structuredClone(this.rom.knowledge.itemMemory);
    }

    /** Get location knowledge (read-only from ROM) */
    getLocationKnowledge(): any {
        return structuredClone(this.rom.knowledge.locationMemory);
    }

    /** Get social knowledge (read-only from ROM) */
    getSocialKnowledge(): any {
        return structuredClone(this.rom.knowledge.socialMemory);
    }

    /** Record new item discovery (queued for next checkpoint) */
    recordItemDiscovery(discovery: any): void {
        this.ram.pendingKnowledge.newItemDiscoveries.push({
            ...discovery,
            timestamp: new Date().toISOString(),
        });
        this.ram.delta.knowledgeChanged = true;
        this.ram.delta.dirty = true;
    }

    /** Record new location visit (queued for next checkpoint) */
    recordLocationVisit(visit: any): void {
        this.ram.pendingKnowledge.newLocationVisits.push({
            ...visit,
            timestamp: new Date().toISOString(),
        });
        this.ram.delta.knowledgeChanged = true;
        this.ram.delta.dirty = true;
    }

    /** Record social interaction (queued for next checkpoint) */
    recordSocialInteraction(interaction: any): void {
        this.ram.pendingKnowledge.newSocialInteractions.push({
            ...interaction,
            timestamp: new Date().toISOString(),
        });
        this.ram.delta.knowledgeChanged = true;
        this.ram.delta.dirty = true;
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private createEmptyROM(): ROMData {
        return {
            identity: {
                name: '',
                personality: '',
                personalityPreset: null,
                backstory: null,
                birthday: null,
                playingSince: null,
                createdAt: new Date().toISOString(),
            },
            knowledge: {
                itemMemory: {},
                locationMemory: {},
                socialMemory: {},
            },
            stats: {
                levels: {},
                totalLevel: 32,
                combatLevel: 3,
            },
        };
    }

    private createEmptyRAM(): RAMData {
        return {
            session: {
                startedAt: new Date().toISOString(),
                lastCheckpoint: null,
                uptimeSeconds: 0,
            },
            working: {
                currentTask: null,
                taskQueue: [],
                recentEvents: [],
                conversationContext: [],
                shortTermMemory: new Map(),
            },
            pendingKnowledge: {
                newItemDiscoveries: [],
                newLocationVisits: [],
                newSocialInteractions: [],
            },
            delta: {
                statsChanged: false,
                knowledgeChanged: false,
                dirty: false,
            },
        };
    }

    private async loadROM(): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');

        const romPath = path.join(this.config.accountDir, 'rom.json');

        try {
            const data = await fs.readFile(romPath, 'utf-8');
            this.rom = JSON.parse(data);
            this.log('ROM loaded from disk');
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                this.log('No ROM found, using empty ROM');
            } else {
                throw error;
            }
        }
    }

    private async saveROM(): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');

        const romPath = path.join(this.config.accountDir, 'rom.json');

        await fs.mkdir(this.config.accountDir, { recursive: true });
        await fs.writeFile(romPath, JSON.stringify(this.rom, null, 2));

        this.log('ROM saved to disk');
    }

    private async mergeKnowledgeToROM(): Promise<void> {
        // Merge item discoveries
        for (const discovery of this.ram.pendingKnowledge.newItemDiscoveries) {
            // Merge logic here
        }

        // Merge location visits
        for (const visit of this.ram.pendingKnowledge.newLocationVisits) {
            // Merge logic here
        }

        // Merge social interactions
        for (const interaction of this.ram.pendingKnowledge.newSocialInteractions) {
            // Merge logic here
        }

        // Clear pending
        this.ram.pendingKnowledge = {
            newItemDiscoveries: [],
            newLocationVisits: [],
            newSocialInteractions: [],
        };
    }

    private startCheckpointTimer(): void {
        this.checkpointTimer = setInterval(async () => {
            await this.checkpoint('auto');
        }, this.config.checkpointIntervalMs);
    }

    private stopCheckpointTimer(): void {
        if (this.checkpointTimer) {
            clearInterval(this.checkpointTimer);
            this.checkpointTimer = null;
        }
    }

    private registerShutdownHandler(): void {
        if (this.shutdownHandlerRegistered) return;

        const handler = async () => {
            await this.shutdown();
        };

        process.on('SIGINT', handler);
        process.on('SIGTERM', handler);
        process.on('beforeExit', handler);

        this.shutdownHandlerRegistered = true;
    }

    private normalizePath(path: string): string {
        // Ensure path is within bot's virtual root
        const root = this.getVirtualRoot();
        if (!path.startsWith(root)) {
            path = root + path.replace(/^\/+/, '');
        }
        return path;
    }

    private readPath(pathParts: string[]): any {
        let current: any = this.ram;
        for (const part of pathParts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return structuredClone(current);
    }

    private writePath(pathParts: string[], value: any): void {
        let current: any = this.ram;
        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            if (!(part in current)) {
                current[part] = {};
            }
            current = current[part];
        }
        current[pathParts[pathParts.length - 1]] = value;
        this.ram.delta.dirty = true;
    }

    private appendPath(pathParts: string[], value: any): void {
        const existing = this.readPath(pathParts);
        if (Array.isArray(existing)) {
            existing.push(value);
            this.writePath(pathParts, existing);
        } else {
            this.writePath(pathParts, [value]);
        }
    }

    private deletePath(pathParts: string[]): void {
        let current: any = this.ram;
        for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            if (!(part in current)) return;
            current = current[part];
        }
        delete current[pathParts[pathParts.length - 1]];
        this.ram.delta.dirty = true;
    }

    private queryPath(pathParts: string[], filter: any): any[] {
        const data = this.readPath(pathParts);
        if (!Array.isArray(data)) return [];

        return data.filter(item => {
            for (const [key, value] of Object.entries(filter)) {
                if (item[key] !== value) return false;
            }
            return true;
        });
    }

    private callMethod(method: string, args: any[]): any {
        // Only allow safe methods
        const safeMethods: Record<string, (...args: any[]) => any> = {
            'getTime': () => Date.now(),
            'getRandom': () => Math.random(),
            'getUptime': () => this.ram.session.uptimeSeconds,
        };

        if (!(method in safeMethods)) {
            throw new Error(`Method not allowed: ${method}`);
        }

        return safeMethods[method](...args);
    }

    private log(message: string): void {
        if (this.config.debug) {
            console.log(`[SovereignMemory:${this.config.botId}] ${message}`);
        }
    }
}

// =============================================================================
// TOOL SANDBOX CONFIG
// =============================================================================

/**
 * Configuration to pass to fuzzy-computing chatbot that sandboxes all tool operations.
 * This replaces real filesystem access with virtual filesystem access.
 */
export function createSandboxedToolConfig(memory: SovereignMemory): Record<string, any> {
    return {
        // Override tools_dir to a non-existent path (tools loaded from library)
        tools_dir: '__sandboxed__',

        // Custom tool handlers that use virtual filesystem
        tool_overrides: {
            read_file: {
                execute: (args: { path: string }) => {
                    const content = memory.readVirtualFile(args.path);
                    if (content === null) {
                        return { success: false, error: 'File not found' };
                    }
                    return { success: true, content };
                },
            },
            write_code: {
                execute: (args: { path: string; content: string }) => {
                    memory.writeVirtualFile(args.path, args.content);
                    return { success: true, path: args.path };
                },
            },
            write_text: {
                execute: (args: { path: string; content: string }) => {
                    memory.writeVirtualFile(args.path, args.content);
                    return { success: true, path: args.path };
                },
            },
            write_json: {
                execute: (args: { path: string; data: any }) => {
                    const content = JSON.stringify(args.data, null, 2);
                    memory.writeVirtualFile(args.path, content);
                    return { success: true, path: args.path };
                },
            },
            text_update: {
                execute: (args: { path: string; old_text: string; new_text: string }) => {
                    const content = memory.readVirtualFile(args.path);
                    if (content === null) {
                        return { success: false, error: 'File not found' };
                    }
                    const updated = content.replace(args.old_text, args.new_text);
                    memory.writeVirtualFile(args.path, updated);
                    return { success: true, path: args.path };
                },
            },
        },
    };
}
