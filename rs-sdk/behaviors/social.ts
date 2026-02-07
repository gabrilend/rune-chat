// social.ts - Social chat behavior
//
// This behavior handles responding to chat messages using an LLM.
// It integrates with the existing game-integration module for chat handling.

import type { BehaviorDefinition, BehaviorContext } from '../bot-core';
import type { OllamaContext } from '../bot-chat';

interface SocialState {
    ticksActive: number;
    maxTicks: number;
    messagesResponded: number;
}

/**
 * Social behavior - respond to chat messages.
 *
 * This behavior keeps the bot socially active, responding to
 * nearby chat and direct messages. It uses the OllamaContext
 * from the bot runner for generating responses.
 *
 * Note: The actual chat listening is handled by the bot runner's
 * interrupt system. This behavior is for proactive social actions
 * like periodically saying something or checking for missed messages.
 *
 * @param maxTicks - How long to stay in social mode (default 500 = ~3.5 minutes)
 */
export function createSocialBehavior(maxTicks: number = 500): BehaviorDefinition {
    return {
        name: 'social',
        description: `Be social and chat with nearby players for ${Math.round(maxTicks * 0.42 / 60)} minutes`,
        fn: async (ctx: BehaviorContext) => {
            const state: SocialState = ctx.getResumeState() ?? {
                ticksActive: 0,
                maxTicks,
                messagesResponded: 0,
            };

            ctx.log(`[social] Entering social mode`);

            // Random greetings for when entering social mode
            const greetings = [
                "Hey everyone!",
                "Anyone around?",
                "Good to see some friendly faces!",
                "*waves*",
            ];

            // Say hello when starting fresh
            if (state.ticksActive === 0) {
                const greeting = greetings[Math.floor(Math.random() * greetings.length)];
                try {
                    await ctx.sdk.sendSay(greeting);
                } catch (e) {
                    ctx.log(`[social] Failed to send greeting: ${e}`);
                }
            }

            while (state.ticksActive < state.maxTicks) {
                // Check for interrupts
                const interrupt = ctx.checkInterrupt();
                if (interrupt) {
                    ctx.log(`[social] Interrupted by ${interrupt.type}`);
                    ctx.pauseWithState(state);
                    return;
                }

                // Wait a while
                const continued = await ctx.waitTicks(10);
                if (!continued) {
                    ctx.pauseWithState(state);
                    return;
                }

                state.ticksActive += 10;

                // Periodically (every ~2 minutes) say something contextual
                if (state.ticksActive % 300 === 0) {
                    const gameState = ctx.sdk.getState();
                    if (gameState?.player) {
                        // Check if there are nearby players to talk to
                        const nearbyPlayers = gameState.nearbyPlayers;
                        if (nearbyPlayers.length > 0) {
                            const idleComments = [
                                "Nice weather today, isn't it?",
                                "So, what brings you here?",
                                "Any interesting adventures lately?",
                                "This is a nice spot.",
                            ];
                            const comment = idleComments[Math.floor(Math.random() * idleComments.length)];
                            try {
                                await ctx.sdk.sendSay(comment);
                            } catch (e) {
                                ctx.log(`[social] Failed to send comment: ${e}`);
                            }
                        }
                    }
                }
            }

            ctx.log(`[social] Exiting social mode (responded to ${state.messagesResponded} messages)`);
        }
    };
}

// Default export
export const socialBehavior = createSocialBehavior(500);

export default socialBehavior;
