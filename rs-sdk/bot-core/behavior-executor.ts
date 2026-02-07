// behavior-executor.ts - Run behaviors with interrupt handling
//
// Behaviors are async functions that perform game actions.
// They run to completion unless interrupted, in which case they pause
// and can be resumed later with saved state.
//
// The key principle: behaviors are "dumb" - they just do their job.
// The task manager and LLM decide WHICH behavior to run.

import type { BotSDK, BotWorldState } from '../sdk/index';
import type { BotActions } from '../sdk/actions';
import type { TaskManager, Task, Interrupt } from './task-manager';

/**
 * Context passed to behaviors for accessing game state and actions.
 *
 * Lua port note: This would be a table with references to sdk, actions, etc.
 * The checkInterrupt function is key - behaviors should call it periodically.
 */
export interface BehaviorContext {
    // Game access
    sdk: BotSDK;
    bot: BotActions;
    log: (...args: any[]) => void;

    // Task management
    taskManager: TaskManager;
    currentTask: Task;

    // Interrupt handling - behaviors should call this periodically
    // Returns true if behavior should pause
    checkInterrupt: () => Interrupt | null;

    // Pause the behavior with state (creates resume task automatically)
    // Call this before returning if checkInterrupt returned an interrupt
    pauseWithState: (state: any) => void;

    // Get saved state from a resume (null if starting fresh)
    getResumeState: () => any | null;

    // Helper to wait with interrupt checking
    waitTicks: (ticks: number) => Promise<boolean>;  // Returns false if interrupted
}

/**
 * A behavior function.
 * Behaviors should:
 * 1. Call ctx.checkInterrupt() periodically
 * 2. If interrupted, call ctx.pauseWithState(state) and return
 * 3. Use ctx.getResumeState() to restore state if resuming
 *
 * Lua port note: This is a coroutine in Lua, yielding when interrupted.
 */
export type BehaviorFunction = (ctx: BehaviorContext) => Promise<void>;

/**
 * Behavior registration with metadata.
 */
export interface BehaviorDefinition {
    name: string;
    description: string;
    fn: BehaviorFunction;
}

/**
 * Registry of available behaviors.
 *
 * Lua port note: This is a simple table mapping names to functions.
 */
export class BehaviorRegistry {
    private behaviors: Map<string, BehaviorDefinition> = new Map();

    register(def: BehaviorDefinition): void {
        this.behaviors.set(def.name, def);
    }

    get(name: string): BehaviorDefinition | undefined {
        return this.behaviors.get(name);
    }

    getAll(): BehaviorDefinition[] {
        return Array.from(this.behaviors.values());
    }

    getNames(): string[] {
        return Array.from(this.behaviors.keys());
    }

    /**
     * Get behavior info for LLM context.
     */
    getForLLM(): string {
        const lines = ['Available behaviors:'];
        for (const def of this.behaviors.values()) {
            lines.push(`  - ${def.name}: ${def.description}`);
        }
        return lines.join('\n');
    }
}

/**
 * Executes behaviors within the task management framework.
 *
 * Lua port note: This class becomes a module with functions.
 * The interrupt handling uses a shared flag that's checked via checkInterrupt.
 */
export class BehaviorExecutor {
    private registry: BehaviorRegistry = new BehaviorRegistry();
    private pendingInterrupt: Interrupt | null = null;
    private currentContext: BehaviorContext | null = null;
    private paused: boolean = false;
    private pausedState: any = null;

    constructor(
        private sdk: BotSDK,
        private bot: BotActions,
        private taskManager: TaskManager,
        private log: (...args: any[]) => void = console.log
    ) {}

    /**
     * Get the behavior registry for adding behaviors.
     */
    getRegistry(): BehaviorRegistry {
        return this.registry;
    }

    /**
     * Register a behavior.
     */
    registerBehavior(def: BehaviorDefinition): void {
        this.registry.register(def);
    }

    /**
     * Signal an interrupt. The currently running behavior will see this
     * on its next checkInterrupt() call.
     */
    interrupt(int: Interrupt): void {
        this.pendingInterrupt = int;
    }

    /**
     * Check if there's a pending interrupt (for external use).
     */
    hasPendingInterrupt(): boolean {
        return this.pendingInterrupt !== null;
    }

    /**
     * Execute a behavior task.
     * Runs the behavior to completion or until interrupted.
     *
     * @param task - The task containing the behavior to run
     * @returns true if completed, false if paused/interrupted
     */
    async execute(task: Task): Promise<boolean> {
        if (task.type !== 'behavior' || !task.behaviorName) {
            this.log(`[BehaviorExecutor] Task ${task.id} is not a behavior task`);
            return false;
        }

        const behavior = this.registry.get(task.behaviorName);
        if (!behavior) {
            this.log(`[BehaviorExecutor] Unknown behavior: ${task.behaviorName}`);
            return false;
        }

        // Reset interrupt state
        this.pendingInterrupt = null;
        this.paused = false;
        this.pausedState = null;

        // Create context for this execution
        const ctx: BehaviorContext = {
            sdk: this.sdk,
            bot: this.bot,
            log: this.log,
            taskManager: this.taskManager,
            currentTask: task,

            checkInterrupt: () => {
                return this.pendingInterrupt;
            },

            pauseWithState: (state: any) => {
                this.paused = true;
                this.pausedState = state;
            },

            getResumeState: () => {
                return task.behaviorState ?? null;
            },

            waitTicks: async (ticks: number): Promise<boolean> => {
                for (let i = 0; i < ticks; i++) {
                    // Check for interrupt before waiting
                    if (this.pendingInterrupt) {
                        return false;
                    }
                    await this.sdk.waitForTicks(1);
                }
                return true;
            }
        };

        this.currentContext = ctx;

        try {
            this.log(`[BehaviorExecutor] Starting behavior: ${task.behaviorName}`);
            await behavior.fn(ctx);

            // Check if we paused
            if (this.paused) {
                this.log(`[BehaviorExecutor] Behavior paused: ${task.behaviorName}`);
                this.taskManager.pauseTask(task.id, this.pausedState, 'behavior_pause');
                return false;
            }

            this.log(`[BehaviorExecutor] Behavior completed: ${task.behaviorName}`);
            return true;

        } catch (error) {
            this.log(`[BehaviorExecutor] Behavior error: ${error}`);
            return false;
        } finally {
            this.currentContext = null;
        }
    }

    /**
     * Execute a behavior by name (creates a temporary task).
     * Useful for testing or one-off behavior runs.
     */
    async runBehavior(name: string, state?: any): Promise<boolean> {
        const task = this.taskManager.addTask({
            type: 'behavior',
            priority: 50,
            behaviorName: name,
            behaviorState: state,
        });

        this.taskManager.startTask(task.id);
        const result = await this.execute(task);

        if (result) {
            this.taskManager.completeTask(task.id);
        }

        return result;
    }
}

// ============================================================================
// Built-in Behaviors
// These are simple behaviors that can be used as building blocks.
// ============================================================================

/**
 * Idle behavior - does nothing, just waits.
 * Useful as a fallback when no other tasks are available.
 */
export const idleBehavior: BehaviorDefinition = {
    name: 'idle',
    description: 'Do nothing, wait for something to happen',
    fn: async (ctx) => {
        const state = ctx.getResumeState() ?? { ticksWaited: 0 };
        const maxTicks = 100;  // Idle for ~42 seconds then complete

        while (state.ticksWaited < maxTicks) {
            // Check for interrupts
            const interrupt = ctx.checkInterrupt();
            if (interrupt) {
                ctx.pauseWithState(state);
                return;
            }

            // Wait a bit
            const continued = await ctx.waitTicks(5);
            if (!continued) {
                ctx.pauseWithState(state);
                return;
            }

            state.ticksWaited += 5;
        }

        ctx.log('[idle] Finished idling');
    }
};

/**
 * Wander behavior - walk to random nearby spots.
 */
export const wanderBehavior: BehaviorDefinition = {
    name: 'wander',
    description: 'Walk around randomly, exploring the area',
    fn: async (ctx) => {
        const state = ctx.getResumeState() ?? { moves: 0 };
        const maxMoves = 5;

        while (state.moves < maxMoves) {
            const interrupt = ctx.checkInterrupt();
            if (interrupt) {
                ctx.pauseWithState(state);
                return;
            }

            const gameState = ctx.sdk.getState();
            if (!gameState?.player) {
                await ctx.waitTicks(1);
                continue;
            }

            // Pick random nearby destination
            const { worldX, worldZ } = gameState.player;
            const dx = Math.floor(Math.random() * 10) - 5;
            const dz = Math.floor(Math.random() * 10) - 5;
            const destX = worldX + dx;
            const destZ = worldZ + dz;

            ctx.log(`[wander] Walking to (${destX}, ${destZ})`);
            await ctx.sdk.sendWalk(destX, destZ);

            // Wait for movement
            const continued = await ctx.waitTicks(10);
            if (!continued) {
                ctx.pauseWithState(state);
                return;
            }

            state.moves++;
        }

        ctx.log('[wander] Finished wandering');
    }
};

// Factory to create a behavior executor with built-in behaviors
export function createBehaviorExecutor(
    sdk: BotSDK,
    bot: BotActions,
    taskManager: TaskManager,
    log?: (...args: any[]) => void
): BehaviorExecutor {
    const executor = new BehaviorExecutor(sdk, bot, taskManager, log);

    // Register built-in behaviors
    executor.registerBehavior(idleBehavior);
    executor.registerBehavior(wanderBehavior);

    return executor;
}
