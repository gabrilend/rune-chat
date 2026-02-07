// behaviors - Reusable behavior modules for bots
//
// Behaviors are async functions that perform game actions.
// They run to completion unless interrupted, and can be paused/resumed.
//
// Each behavior is exported as both a default instance and a factory function
// for customization.

export {
    idleBehavior,
    createIdleBehavior,
} from './idle';

export {
    followerBehavior,
    createFollowerBehavior,
} from './follower';

export {
    wanderBehavior,
    createWanderBehavior,
} from './wander';

export {
    socialBehavior,
    createSocialBehavior,
} from './social';

export {
    wowChatBehavior,
    createWowChatBehavior,
} from './wow-chat';

// Re-export types from bot-core for convenience
export type { BehaviorDefinition, BehaviorContext } from '../bot-core';

// Convenience function to get all default behaviors
import { idleBehavior } from './idle';
import { followerBehavior } from './follower';
import { wanderBehavior } from './wander';
import { socialBehavior } from './social';
import { wowChatBehavior } from './wow-chat';

export const allBehaviors = [
    idleBehavior,
    followerBehavior,
    wanderBehavior,
    socialBehavior,
    wowChatBehavior,
];
