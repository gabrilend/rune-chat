// wander.ts - Wander around randomly
//
// Simple behavior that walks to random nearby positions.
// Good for making a bot look more natural.

import type { BehaviorDefinition, BehaviorContext } from '../bot-core';

interface WanderState {
    movesCompleted: number;
    maxMoves: number;
    wanderRadius: number;
}

/**
 * Wander behavior - walk to random nearby spots.
 *
 * @param maxMoves - Number of random walks before completing (default 5)
 * @param wanderRadius - How far to wander in each direction (default 5 tiles)
 */
export function createWanderBehavior(maxMoves: number = 5, wanderRadius: number = 5): BehaviorDefinition {
    return {
        name: 'wander',
        description: `Walk around randomly (${maxMoves} moves, ${wanderRadius} tile radius)`,
        fn: async (ctx: BehaviorContext) => {
            const state: WanderState = ctx.getResumeState() ?? {
                movesCompleted: 0,
                maxMoves,
                wanderRadius,
            };

            ctx.log(`[wander] Starting to wander (${state.maxMoves - state.movesCompleted} moves remaining)`);

            while (state.movesCompleted < state.maxMoves) {
                // Check for interrupts
                const interrupt = ctx.checkInterrupt();
                if (interrupt) {
                    ctx.log(`[wander] Interrupted by ${interrupt.type}`);
                    ctx.pauseWithState(state);
                    return;
                }

                const gameState = ctx.sdk.getState();
                if (!gameState?.player) {
                    const continued = await ctx.waitTicks(1);
                    if (!continued) {
                        ctx.pauseWithState(state);
                        return;
                    }
                    continue;
                }

                // Pick a random nearby destination
                const { worldX, worldZ } = gameState.player;
                const dx = Math.floor(Math.random() * (state.wanderRadius * 2 + 1)) - state.wanderRadius;
                const dz = Math.floor(Math.random() * (state.wanderRadius * 2 + 1)) - state.wanderRadius;

                // Don't walk to current position
                if (dx === 0 && dz === 0) continue;

                const destX = worldX + dx;
                const destZ = worldZ + dz;

                ctx.log(`[wander] Walking to (${destX}, ${destZ})`);
                await ctx.sdk.sendWalk(destX, destZ);

                // Wait for movement (variable time based on distance)
                const waitTicks = Math.max(5, Math.abs(dx) + Math.abs(dz));
                const continued = await ctx.waitTicks(waitTicks);
                if (!continued) {
                    ctx.pauseWithState(state);
                    return;
                }

                state.movesCompleted++;
            }

            ctx.log('[wander] Finished wandering');
        }
    };
}

// Default export with standard settings
export const wanderBehavior = createWanderBehavior(5, 5);

export default wanderBehavior;
