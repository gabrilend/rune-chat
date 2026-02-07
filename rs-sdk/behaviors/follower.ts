// follower.ts - Follow another player behavior
//
// Follows a target player using leash mechanics:
// - Start following when target is beyond leashRange
// - Stop when within comfortRange
// - Give up if target is beyond lostRange (probably teleported)

import type { BehaviorDefinition, BehaviorContext } from '../bot-core';
import type { NearbyPlayer, BotWorldState } from '../sdk/types';

interface FollowerConfig {
    leashRange: number;      // Start following when target is further than this
    comfortRange: number;    // Stop following when within this range
    lostRange: number;       // Give up if target is further than this
    maxTicksWithoutSight: number;  // How long to wait before giving up
}

interface FollowerState {
    targetName: string;
    config: FollowerConfig;
    followState: 'idle' | 'following' | 'lost';
    lastTargetPosition: { x: number; z: number } | null;
    ticksSinceLastSeen: number;
    totalTicks: number;
    maxTicks: number;
}

const DEFAULT_CONFIG: FollowerConfig = {
    leashRange: 8,
    comfortRange: 3,
    lostRange: 50,
    maxTicksWithoutSight: 20,
};

function findPlayer(state: BotWorldState, name: string): NearbyPlayer | null {
    return state.nearbyPlayers.find(p =>
        p.name.toLowerCase() === name.toLowerCase()
    ) || null;
}

/**
 * Follower behavior - follows another player.
 *
 * @param targetName - Name of the player to follow
 * @param options - Configuration options
 */
export function createFollowerBehavior(
    targetName: string,
    options: Partial<FollowerConfig & { maxTicks: number }> = {}
): BehaviorDefinition {
    const config: FollowerConfig = { ...DEFAULT_CONFIG, ...options };
    const maxTicks = options.maxTicks ?? 0;  // 0 = follow forever

    return {
        name: 'follower',
        description: `Follow ${targetName} (leash: ${config.leashRange}, comfort: ${config.comfortRange})`,
        fn: async (ctx: BehaviorContext) => {
            const state: FollowerState = ctx.getResumeState() ?? {
                targetName,
                config,
                followState: 'idle',
                lastTargetPosition: null,
                ticksSinceLastSeen: 0,
                totalTicks: 0,
                maxTicks,
            };

            ctx.log(`[follower] Starting to follow ${state.targetName}`);

            while (maxTicks === 0 || state.totalTicks < state.maxTicks) {
                // Check for interrupts
                const interrupt = ctx.checkInterrupt();
                if (interrupt) {
                    ctx.log(`[follower] Interrupted by ${interrupt.type}`);
                    ctx.pauseWithState(state);
                    return;
                }

                const gameState = ctx.sdk.getState();
                if (!gameState?.player) {
                    const continued = await ctx.waitTicks(2);
                    if (!continued) {
                        ctx.pauseWithState(state);
                        return;
                    }
                    state.totalTicks += 2;
                    continue;
                }

                const target = findPlayer(gameState, state.targetName);

                if (target) {
                    // Target found!
                    state.ticksSinceLastSeen = 0;
                    state.lastTargetPosition = { x: target.x, z: target.z };

                    const distance = target.distance;

                    if (distance > state.config.lostRange) {
                        // Too far - they probably teleported
                        if (state.followState !== 'lost') {
                            state.followState = 'lost';
                            ctx.log(`[follower] Lost ${state.targetName} (too far: ${distance} tiles)`);
                        }
                    } else if (distance > state.config.leashRange) {
                        // Need to follow
                        if (state.followState !== 'following') {
                            state.followState = 'following';
                            ctx.log(`[follower] Following ${state.targetName} (${Math.round(distance)} tiles away)`);
                        }

                        // Walk toward target
                        await ctx.sdk.sendWalk(target.x, target.z, true);

                    } else if (distance <= state.config.comfortRange) {
                        // Close enough, can idle
                        if (state.followState === 'following') {
                            state.followState = 'idle';
                            ctx.log(`[follower] Reached ${state.targetName}`);
                        }
                    }

                } else {
                    // Target not visible
                    state.ticksSinceLastSeen++;

                    if (state.ticksSinceLastSeen > state.config.maxTicksWithoutSight) {
                        if (state.followState !== 'lost' && state.followState !== 'idle') {
                            state.followState = 'lost';
                            ctx.log(`[follower] Can't see ${state.targetName}`);

                            // Try walking to last known position
                            if (state.lastTargetPosition) {
                                await ctx.sdk.sendWalk(
                                    state.lastTargetPosition.x,
                                    state.lastTargetPosition.z,
                                    true
                                );
                            }
                        }
                    }
                }

                // Wait before next check
                const continued = await ctx.waitTicks(2);
                if (!continued) {
                    ctx.pauseWithState(state);
                    return;
                }
                state.totalTicks += 2;
            }

            ctx.log(`[follower] Finished following ${state.targetName}`);
        }
    };
}

// Factory function that accepts target at runtime
export const followerBehavior: BehaviorDefinition = {
    name: 'follower',
    description: 'Follow another player (requires target name in state)',
    fn: async (ctx: BehaviorContext) => {
        const state = ctx.getResumeState();
        if (!state?.targetName) {
            ctx.log('[follower] Error: No target name provided in state');
            return;
        }

        const behavior = createFollowerBehavior(state.targetName, state.config);
        await behavior.fn(ctx);
    }
};

export default followerBehavior;
