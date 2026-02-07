// idle.ts - Idle behavior that just waits
//
// This is the simplest behavior - it does nothing but wait.
// Useful as a fallback when no other tasks are available.
// Completes after idling for a set duration.

import type { BehaviorDefinition, BehaviorContext } from '../bot-core';

interface IdleState {
    ticksWaited: number;
    maxTicks: number;
}

/**
 * Idle behavior - wait and do nothing.
 *
 * @param maxTicks - How long to idle before completing (default 100 = ~42 seconds)
 */
export function createIdleBehavior(maxTicks: number = 100): BehaviorDefinition {
    return {
        name: 'idle',
        description: `Do nothing, wait for ${Math.round(maxTicks * 0.42)} seconds`,
        fn: async (ctx: BehaviorContext) => {
            const state: IdleState = ctx.getResumeState() ?? {
                ticksWaited: 0,
                maxTicks
            };

            ctx.log(`[idle] Starting idle (${state.maxTicks - state.ticksWaited} ticks remaining)`);

            while (state.ticksWaited < state.maxTicks) {
                // Check for interrupts
                const interrupt = ctx.checkInterrupt();
                if (interrupt) {
                    ctx.log(`[idle] Interrupted by ${interrupt.type}`);
                    ctx.pauseWithState(state);
                    return;
                }

                // Wait a bit
                const continued = await ctx.waitTicks(5);
                if (!continued) {
                    ctx.log(`[idle] Interrupted while waiting`);
                    ctx.pauseWithState(state);
                    return;
                }

                state.ticksWaited += 5;

                // Periodically log position
                if (state.ticksWaited % 50 === 0) {
                    const gameState = ctx.sdk.getState();
                    if (gameState?.player) {
                        ctx.log(`[idle] Still idling at (${gameState.player.worldX}, ${gameState.player.worldZ})`);
                    }
                }
            }

            ctx.log('[idle] Finished idling');
        }
    };
}

// Default export with standard duration
export const idleBehavior = createIdleBehavior(100);

export default idleBehavior;
