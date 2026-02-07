// personality-presets.ts - Predefined personality configurations
//
// Personalities affect:
// - Conversation topic selection
// - Response style and word choice
// - Decision making (what to do next)
// - Movement patterns
// - Social behavior

import type { PersonalityTraits } from './task-manager';

/**
 * Extended personality with behavior modifiers.
 */
export interface FullPersonality extends PersonalityTraits {
    // Basic traits (from PersonalityTraits)
    // sociability, independence, helpfulness, diligence,
    // adventurousness, verbosity, formality

    // Extended traits
    playfulness: number;      // Silly/fun behavior
    rudeness: number;         // Aggressive/mean
    childishness: number;     // Toddler-like behavior
    mysticism: number;        // Wizard/poetic speech
    curiosity: number;        // Ask questions
    mischievousness: number;  // Scams, pranks

    // Behavior modifiers
    movementDelay?: number;   // Extra delay between movements (ms)
    randomMovementChance?: number;  // Chance to move randomly
    vocabularyLimit?: number; // Max words they know (for childish)
    speakInRhyme?: boolean;   // Mystical speech
    parallelResponseGen?: boolean;  // Generate poem + normal, choose
}

/**
 * Response generation mode for mystical personalities.
 */
export type ResponseMode = 'normal' | 'poetic' | 'choose_wisely';

/**
 * Context for choosing between response modes.
 */
export interface ResponseContext {
    isJourney: boolean;       // Traveling long distance
    isCelebration: boolean;   // Level up, quest complete
    isTragedy: boolean;       // Death, lost items
    isTrialAhead: boolean;    // Boss fight, challenge coming
    isRoutine: boolean;       // Normal activity
}

// ============================================================================
// PRESET PERSONALITIES
// ============================================================================

/**
 * Friendly Helper - Default helpful personality.
 */
export const FRIENDLY_HELPER: FullPersonality = {
    sociability: 0.7,
    independence: 0.4,
    helpfulness: 0.9,
    diligence: 0.6,
    adventurousness: 0.5,
    verbosity: 0.6,
    formality: 0.3,
    playfulness: 0.4,
    rudeness: 0.0,
    childishness: 0.0,
    mysticism: 0.0,
    curiosity: 0.6,
    mischievousness: 0.05,
};

/**
 * Independent Explorer - Curious and self-directed.
 */
export const INDEPENDENT_EXPLORER: FullPersonality = {
    sociability: 0.4,
    independence: 0.9,
    helpfulness: 0.5,
    diligence: 0.5,
    adventurousness: 0.95,
    verbosity: 0.4,
    formality: 0.2,
    playfulness: 0.3,
    rudeness: 0.0,
    childishness: 0.0,
    mysticism: 0.1,
    curiosity: 0.9,
    mischievousness: 0.1,
};

/**
 * Quiet Worker - Focused and efficient.
 */
export const QUIET_WORKER: FullPersonality = {
    sociability: 0.2,
    independence: 0.7,
    helpfulness: 0.6,
    diligence: 0.95,
    adventurousness: 0.2,
    verbosity: 0.1,
    formality: 0.5,
    playfulness: 0.1,
    rudeness: 0.0,
    childishness: 0.0,
    mysticism: 0.0,
    curiosity: 0.3,
    mischievousness: 0.0,
};

/**
 * Social Butterfly - Loves chatting and making friends.
 */
export const SOCIAL_BUTTERFLY: FullPersonality = {
    sociability: 0.95,
    independence: 0.2,
    helpfulness: 0.8,
    diligence: 0.3,
    adventurousness: 0.6,
    verbosity: 0.9,
    formality: 0.1,
    playfulness: 0.7,
    rudeness: 0.0,
    childishness: 0.1,
    mysticism: 0.0,
    curiosity: 0.7,
    mischievousness: 0.1,
};

/**
 * Rude PvP Challenger - Aggressive, challenges everyone to fight.
 * Will fight at higher risk to themselves.
 */
export const RUDE_PVP_CHALLENGER: FullPersonality = {
    sociability: 0.6,  // Talks to people, just rudely
    independence: 0.8,
    helpfulness: 0.1,
    diligence: 0.4,
    adventurousness: 0.9,
    verbosity: 0.7,
    formality: 0.0,
    playfulness: 0.2,
    rudeness: 0.95,
    childishness: 0.2,
    mysticism: 0.0,
    curiosity: 0.2,
    mischievousness: 0.4,
};

/**
 * Toddler - Very young, limited vocabulary, slow and random movements.
 * 50% chance to pause 2 seconds between decisions.
 * Knows about 12 words.
 */
export const TODDLER: FullPersonality = {
    sociability: 0.8,
    independence: 0.1,
    helpfulness: 0.3,  // Wants to help but can't really
    diligence: 0.1,
    adventurousness: 0.6,  // Curious but easily distracted
    verbosity: 0.3,
    formality: 0.0,
    playfulness: 0.9,
    rudeness: 0.0,
    childishness: 0.99,
    mysticism: 0.0,
    curiosity: 0.9,
    mischievousness: 0.3,
    // Behavior modifiers
    movementDelay: 2000,      // 2 second pauses
    randomMovementChance: 0.5, // 50% chance to move randomly
    vocabularyLimit: 12,       // Only knows ~12 words
};

/**
 * Mad Mage - Speaks in rhyme, unpredictable.
 * Randomly chooses between poetic and normal speech.
 */
export const MAD_MAGE: FullPersonality = {
    sociability: 0.5,
    independence: 0.8,
    helpfulness: 0.4,
    diligence: 0.3,
    adventurousness: 0.7,
    verbosity: 0.8,
    formality: 0.6,
    playfulness: 0.5,
    rudeness: 0.2,
    childishness: 0.1,
    mysticism: 0.95,
    curiosity: 0.6,
    mischievousness: 0.4,
    // Behavior modifiers
    speakInRhyme: true,
    parallelResponseGen: true,  // Generate both, pick randomly
};

/**
 * Wise Sage - Mystical but chooses words carefully.
 * Saves poems for special moments (journeys, celebrations, tragedies, trials).
 */
export const WISE_SAGE: FullPersonality = {
    sociability: 0.6,
    independence: 0.7,
    helpfulness: 0.8,
    diligence: 0.7,
    adventurousness: 0.5,
    verbosity: 0.6,
    formality: 0.8,
    playfulness: 0.2,
    rudeness: 0.0,
    childishness: 0.0,
    mysticism: 0.9,
    curiosity: 0.7,
    mischievousness: 0.0,
    // Behavior modifiers
    speakInRhyme: true,
    parallelResponseGen: true,  // Generate both, LLM chooses based on context
};

/**
 * Cat Follower - Follows people around, meows at things.
 */
export const CAT_FOLLOWER: FullPersonality = {
    sociability: 0.9,
    independence: 0.1,  // Wants to follow
    helpfulness: 0.3,
    diligence: 0.2,
    adventurousness: 0.4,
    verbosity: 0.4,
    formality: 0.0,
    playfulness: 0.95,
    rudeness: 0.0,
    childishness: 0.5,
    mysticism: 0.1,
    curiosity: 0.8,
    mischievousness: 0.3,
};

// =============================================================================
// HARDCORE MODE EXCLUSIVE PERSONALITIES
// =============================================================================

/**
 * Hardcore Janitor - Cleans up death piles in cities and towns.
 *
 * ONLY available in HARDCORE_MODE. This personality exists because in hardcore
 * mode, items stay on the ground FOREVER until someone lights a fire on them.
 * The janitor fills an important role: cleaning up cities and preventing item
 * buildup, while earning firewood XP.
 *
 * BEHAVIOR (NOT YET IMPLEMENTED - DOCUMENTATION ONLY):
 *
 * 1. CITY WANDERING:
 *    - Spawns in their "home city" (configurable)
 *    - Wanders around the city looking for items on the ground
 *    - Prioritizes high-traffic areas (banks, spawn points, town squares)
 *    - Avoids dangerous areas (monsters, wilderness border)
 *
 * 2. ITEM COLLECTION:
 *    - Picks up any items found on the ground
 *    - Has limited inventory (28 slots like normal)
 *    - When inventory is full, heads to the "burn pile"
 *    - Does NOT equip or use items (they're meant for burning)
 *
 * 3. BURN PILE BEHAVIOR:
 *    - Each janitor has a designated "burn pile" location
 *    - Typically near the town fire pit or furnace area
 *    - When at burn pile with items:
 *      - Drops all collected items
 *      - Lights a fire
 *      - Waits for items to burn (2 seconds per item)
 *      - Gains firewood XP for each item burned
 *    - Community burn piles may exist where multiple janitors contribute
 *
 * 4. OUTSIDE BEHAVIOR (Following Only):
 *    - Will NOT wander outside city limits on their own
 *    - EXCEPTION: If following another character, will go anywhere
 *    - When outside following someone:
 *      - Still picks up items seen on ground
 *      - Accumulates them until returning home
 *    - If they lose their follow target outside:
 *      - Immediately heads home
 *      - Does not wander or explore
 *
 * 5. SOCIAL INTERACTIONS:
 *    - Talks about their cleaning work
 *    - Complains about messy areas
 *    - Proud of their firewood XP
 *    - Will accept "follow requests" from other players
 *    - May ask "Want me to come clean up somewhere?"
 *
 * 6. PRIORITY SYSTEM:
 *    - Highest: Return home if lost outside
 *    - High: Follow current follow target
 *    - Medium: Burn items when inventory full
 *    - Low: Collect items
 *    - Lowest: Wander looking for items
 *
 * CONFIGURATION (in account.env):
 *   HOME_CITY=Lumbridge      # Where they spawn and return to
 *   BURN_PILE_X=3222         # X coordinate of burn pile
 *   BURN_PILE_Z=3218         # Z coordinate of burn pile
 *   COLLECTION_RADIUS=50     # How far from city center to wander
 *
 * REQUIRES: HARDCORE_MODE=true in account.env
 * If used without hardcore mode, bot will function but items will despawn
 * normally and the burn mechanic won't work.
 */
export const HARDCORE_JANITOR: FullPersonality = {
    sociability: 0.5,         // Talks to people but focused on work
    independence: 0.3,        // Prefers to follow when outside
    helpfulness: 0.7,         // Happy to clean up for others
    diligence: 0.95,          // Very focused on the job
    adventurousness: 0.1,     // Stays in cities, doesn't explore
    verbosity: 0.4,           // Not too chatty
    formality: 0.3,           // Casual
    playfulness: 0.2,         // Serious about their job
    rudeness: 0.1,            // Might grumble about messes
    childishness: 0.0,
    mysticism: 0.0,
    curiosity: 0.3,           // Notices items but not much else
    mischievousness: 0.0,     // Very straightforward
    // Behavior flags (used by behavior implementations)
    // janitorMode: true,     // Flag for janitor-specific behaviors
    // hardcoreOnly: true,    // Only makes sense in hardcore mode
};

// ============================================================================
// VOCABULARY FOR LIMITED SPEAKERS
// ============================================================================

/**
 * Toddler vocabulary - the ~12 words they know.
 */
export const TODDLER_VOCABULARY = [
    'come', 'here', 'give', 'me', 'want', 'banana',
    'no', 'yes', 'help', 'look', 'go', 'mine',
    'please', 'thank', 'you', 'hi', 'bye',
];

/**
 * Generate toddler-speak from a concept.
 */
export function toddlerSpeak(concept: string): string {
    const templates: Record<string, string[]> = {
        'follow': ['come... here...', 'follow me...', 'come...'],
        'give_item': ['give me...', 'me want...', 'give... please...'],
        'help': ['help... me...', 'help...', 'me help...'],
        'greeting': ['hi...', 'hi hi...', 'hello...'],
        'farewell': ['bye...', 'bye bye...'],
        'want': ['me want...', 'want...', 'give me...'],
        'yes': ['yes...', 'yes yes...', 'ok...'],
        'no': ['no...', 'no no...', 'no want...'],
        'look': ['look...', 'look look...', 'see...'],
        'go': ['go...', 'go go...', 'come...'],
        'excited': ['yay...', 'yes yes...', 'me happy...'],
        'sad': ['no...', 'sad...', 'me sad...'],
        'hungry': ['banana...', 'give banana...', 'me hungry...'],
        'confused': ['huh...', 'what...', '...'],
        'thanks': ['thank you...', 'thank...', 'yay...'],
    };

    const options = templates[concept] || templates['confused'];
    return options[Math.floor(Math.random() * options.length)];
}

// ============================================================================
// RUDE PVP CHALLENGER SPEECH
// ============================================================================

/**
 * Generate rude challenger speech.
 */
export function rudeChallenge(targetName: string, context: string): string {
    const insults = [
        `Hey ${targetName}, you look weak. Fight me in the wildy.`,
        `${targetName} is scared. 1v1 me noob.`,
        `Lol ${targetName} is trash. Come wildy if ur not scared.`,
        `${targetName}! Yeah you! Wilderness. Now. Unless you're chicken.`,
        `I could beat ${targetName} with my eyes closed. Prove me wrong.`,
        `What's ${targetName} gonna do, run away? Fight me.`,
        `${targetName} probably uses safe spots. Real players fight.`,
        `Bet ${targetName} won't risk anything. Coward.`,
    ];

    const contextual: Record<string, string[]> = {
        'same_activity': [
            `You call that ${context}? I'm better AND I'll beat you in pvp.`,
            `Lol imagine being this bad at ${context}. Fight me instead.`,
        ],
        'greeting': [
            `Whatever. You wanna fight or just stand there?`,
            `Hi? That's it? Boring. Wilderness. Let's go.`,
        ],
        'help_request': [
            `Help? Lmao no. But I'll fight you for fun.`,
            `I don't help. I fight. Come to wildy.`,
        ],
    };

    if (context in contextual && Math.random() < 0.4) {
        return contextual[context][Math.floor(Math.random() * contextual[context].length)];
    }

    return insults[Math.floor(Math.random() * insults.length)];
}

// ============================================================================
// MYSTICAL SPEECH GENERATION
// ============================================================================

/**
 * Context analysis for choosing response mode.
 */
export function analyzeResponseContext(
    isMoving: boolean,
    distanceTraveled: number,
    recentEvents: string[]
): ResponseContext {
    return {
        isJourney: isMoving && distanceTraveled > 100,
        isCelebration: recentEvents.some(e =>
            e.includes('level') || e.includes('quest') || e.includes('complete')
        ),
        isTragedy: recentEvents.some(e =>
            e.includes('died') || e.includes('lost') || e.includes('death')
        ),
        isTrialAhead: recentEvents.some(e =>
            e.includes('boss') || e.includes('dungeon') || e.includes('challenge')
        ),
        isRoutine: true,  // Default
    };
}

/**
 * Should the wise sage use poetry for this moment?
 */
export function shouldUsePoeticResponse(ctx: ResponseContext): boolean {
    // Use poetry for special moments
    if (ctx.isJourney) return true;
    if (ctx.isCelebration) return true;
    if (ctx.isTragedy) return true;
    if (ctx.isTrialAhead) return true;
    // 10% chance for routine moments
    return Math.random() < 0.1;
}

/**
 * Generate rhyming couplet hint for mystical speech.
 * Returns a template the LLM should fill in.
 */
export function generatePoemPrompt(topic: string, hideInfo: boolean): string {
    const prompts = [
        `Respond about "${topic}" in a rhyming couplet (2 lines that rhyme).`,
        `Speak of "${topic}" as a mystical prophecy in verse.`,
        `Craft a short poem (2-4 lines) about "${topic}".`,
    ];

    let prompt = prompts[Math.floor(Math.random() * prompts.length)];

    if (hideInfo) {
        prompt += ` Be cryptic - hide or obscure 20% of the practical information in metaphor.`;
    }

    return prompt;
}

// ============================================================================
// CAT BEHAVIOR
// ============================================================================

/**
 * Cat sounds and actions.
 */
export const CAT_ACTIONS = {
    see_item: ['*meow*', '*stares at item*', '*paws at it*', 'mrow?'],
    see_player: ['*meow*', '*rubs against leg*', '*purrs*', '*stares*'],
    see_monster: ['*hiss*', '*arches back*', '*meow!*', '*runs behind you*'],
    following: ['*trots along*', '*meow*', '*follows happily*', '*purr*'],
    bored: ['*yawn*', '*stretches*', '*grooms self*', '*naps*'],
    happy: ['*purrs loudly*', '*happy meow*', '*rolls over*', '*kneads*'],
    hungry: ['*meow meow*', '*stares at food*', '*meow?*', '*looks hungry*'],
    wants_attention: ['*meow*', '*headbutts*', '*purr*', '*sits on keyboard*'],
};

export function catReaction(event: keyof typeof CAT_ACTIONS): string {
    const actions = CAT_ACTIONS[event];
    return actions[Math.floor(Math.random() * actions.length)];
}

// ============================================================================
// PRESET LOOKUP
// ============================================================================

export const PERSONALITY_PRESETS: Record<string, FullPersonality> = {
    'friendly_helper': FRIENDLY_HELPER,
    'independent_explorer': INDEPENDENT_EXPLORER,
    'quiet_worker': QUIET_WORKER,
    'social_butterfly': SOCIAL_BUTTERFLY,
    'rude_pvp': RUDE_PVP_CHALLENGER,
    'toddler': TODDLER,
    'mad_mage': MAD_MAGE,
    'wise_sage': WISE_SAGE,
    'cat_follower': CAT_FOLLOWER,
    'hardcore_janitor': HARDCORE_JANITOR,
};

export function getPersonalityPreset(name: string): FullPersonality | null {
    return PERSONALITY_PRESETS[name.toLowerCase()] || null;
}

export function listPersonalityPresets(): string[] {
    return Object.keys(PERSONALITY_PRESETS);
}

// ============================================================================
// SENIORITY & RESPECT SYSTEM
// ============================================================================

/**
 * Calculate years of experience from start year.
 */
export function calculateYearsPlaying(startYear: number): number {
    const currentYear = new Date().getFullYear();
    return Math.max(0, currentYear - startYear);
}

/**
 * Calculate respect multiplier based on seniority.
 * Older players (more years) get more respect.
 * Base respect is 1.0, multiplied by years played.
 */
export function calculateRespectMultiplier(yearsPlaying: number): number {
    // Minimum 1x, then +0.5x per year, capped at 20x
    return Math.min(20, 1 + (yearsPlaying * 0.5));
}

/**
 * Compare seniority between two players.
 * Returns how much more the bot should respect them.
 */
export function compareSeniority(myYears: number, theirYears: number): {
    theyAreOlder: boolean;
    difference: number;
    respectMultiplier: number;
    attitude: 'reverent' | 'respectful' | 'equal' | 'mentoring' | 'patronizing';
} {
    const difference = theirYears - myYears;
    const respectMultiplier = calculateRespectMultiplier(theirYears);

    let attitude: 'reverent' | 'respectful' | 'equal' | 'mentoring' | 'patronizing';
    if (difference >= 5) {
        attitude = 'reverent';  // They're a veteran
    } else if (difference >= 2) {
        attitude = 'respectful';  // Clearly more experienced
    } else if (difference >= -1) {
        attitude = 'equal';  // About the same
    } else if (difference >= -4) {
        attitude = 'mentoring';  // I'm a bit older, helpful
    } else {
        attitude = 'patronizing';  // I'm way older (can be annoying)
    }

    return {
        theyAreOlder: difference > 0,
        difference,
        respectMultiplier,
        attitude,
    };
}

/**
 * Generate a seniority-aware response to "how long have you played?"
 */
export function respondToSeniorityQuestion(myYears: number, askerYears?: number): string {
    const responses = {
        veteran: [  // 10+ years
            `I've been playing since ${2024 - myYears}. ${myYears} years now.`,
            `Started back in ${2024 - myYears}. Seen a lot of changes.`,
            `${myYears} years. I remember when things were different.`,
        ],
        experienced: [  // 5-9 years
            `About ${myYears} years now. Started in ${2024 - myYears}.`,
            `${myYears} years. Still learning new things.`,
            `Since ${2024 - myYears}. Time flies.`,
        ],
        intermediate: [  // 2-4 years
            `${myYears} years. Still pretty new compared to some.`,
            `Only ${myYears} years. There's a lot I haven't seen.`,
            `Started in ${2024 - myYears}. ${myYears} years.`,
        ],
        newbie: [  // 0-1 years
            `Just started this year!`,
            `I'm pretty new, less than a year.`,
            `Brand new! Still figuring things out.`,
        ],
    };

    let category: keyof typeof responses;
    if (myYears >= 10) category = 'veteran';
    else if (myYears >= 5) category = 'experienced';
    else if (myYears >= 2) category = 'intermediate';
    else category = 'newbie';

    const baseResponse = responses[category][Math.floor(Math.random() * responses[category].length)];

    // If we know how long they've played, add a comparison
    if (askerYears !== undefined) {
        const comparison = compareSeniority(myYears, askerYears);
        if (comparison.attitude === 'reverent') {
            return `${baseResponse} Wow, ${askerYears} years? You're a legend!`;
        } else if (comparison.attitude === 'respectful') {
            return `${baseResponse} Nice, you've got a few years on me!`;
        } else if (comparison.attitude === 'mentoring') {
            return `${baseResponse} I've been around a bit longer - let me know if you need tips!`;
        }
    }

    return baseResponse;
}

/**
 * Ask about seniority (for conversation topics).
 */
export function askSeniorityQuestion(): string {
    const questions = [
        `How long have you been playing?`,
        `When did you start?`,
        `How many years have you played?`,
        `Are you a veteran or newer player?`,
        `What year did you start playing?`,
    ];
    return questions[Math.floor(Math.random() * questions.length)];
}

/**
 * Check if today is the bot's birthday.
 */
export function isBirthdayToday(birthdayMMDD: string): boolean {
    const today = new Date();
    const todayMMDD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return birthdayMMDD === todayMMDD;
}
