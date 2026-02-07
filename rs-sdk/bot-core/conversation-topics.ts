// conversation-topics.ts - Generate contextual conversation options
//
// When doing activities near other players, bots can have conversations.
// This system generates relevant topics based on:
// - Current activity (mining, woodcutting, etc.)
// - Unknown destinations we're looking for
// - Items we're searching for
// - General social chit-chat
//
// Conversations happen when:
// - Another player/bot is doing the same activity nearby
// - We've been doing the activity for a while (downtime)

import { LocationMemory, UnknownDestination } from './location-memory';
import { ItemMemory } from './item-memory';

/**
 * Conversation topic categories.
 */
export type TopicType =
    | 'directions'          // "where's the bank?"
    | 'item_location'       // "do you know where to find X?"
    | 'resource_discovery'  // "have you seen a place with mithril rocks?"
    | 'quest_hint'          // "someone told me to look for the eye of night..."
    | 'pvp_invitation'      // "wanna fight in the wildy?"
    | 'service_offer'       // "I'll carry your ore for pay"
    | 'trade_request'       // "do you have any rubies?"
    | 'item_need'           // "I lost my weapon, got an extra?"
    | 'discovery_share'     // "I found something cool in a place nobody goes"
    | 'charity_offer'       // "want a pie?"
    | 'charity_request'     // "got a law rune? need to teleport"
    | 'music_social'        // "what song should I listen to?"
    | 'companion_invite'    // "wanna follow me around?"
    | 'activity_proposal'   // "let's go thieve cakes in ardougne"
    | 'compliment'          // "nice cape"
    | 'flirt'               // "do you wanna be my gf"
    | 'scam_attempt'        // "can I trim your armor? only 600gp"
    | 'philosophy'          // "is it better to be charitable or kind?"
    | 'activity_chat'       // general skill chatter
    | 'greeting'
    | 'farewell'
    // New adventure/social topics
    | 'dungeon_invite'      // "wanna go down in that dungeon?"
    | 'exploration_propose' // "what if we moved off over here?"
    | 'shopping_trip'       // "wanna come with me to buy something?"
    | 'nostalgia'           // "have you played since 2004?"
    | 'skill_check'         // "what's your cooking level?"
    | 'progress_tracking'   // "how long until 30?"
    | 'personal_share'      // "it's my birthday"
    | 'pet_roleplay'        // "can I be your cat?"
    | 'improvised'          // freeform conversation
    | 'seniority_check';    // "how long have you played?"

/**
 * A conversation topic the bot can bring up.
 */
export interface ConversationTopic {
    id: string;
    type: TopicType;
    priority: number;           // Higher = more likely to pick
    opener: string;             // What to say to start
    context: string;            // Why this topic is relevant
    expectedResponse?: string;  // What kind of response we expect
    followUp?: string;          // What to say if they don't know

    // Topic-specific data
    destinationName?: string;   // For directions
    itemName?: string;          // For item topics
    questHint?: string;         // For quest mysteries
    activityProposal?: {        // For collaborative activities
        activity: string;
        location: string;
    };
}

/**
 * Activity types that can trigger social interactions.
 */
export type ActivityType =
    | 'mining'
    | 'woodcutting'
    | 'fishing'
    | 'smithing'
    | 'cooking'
    | 'crafting'
    | 'combat'
    | 'fletching'
    | 'firemaking'
    | 'runecrafting'
    | 'herblore'
    | 'thieving'
    | 'agility'
    | 'farming'
    | 'hunter'
    | 'construction'
    | 'idle'
    | 'wandering';

/**
 * Context for generating conversation topics.
 */
export interface ConversationContext {
    // What we're doing
    currentActivity: ActivityType;
    activityDurationMs: number;     // How long we've been at it

    // Who's nearby doing the same thing
    nearbyPlayers: Array<{
        name: string;
        activity?: ActivityType;
        distance: number;           // Tiles away
        combatLevel?: number;       // For PvP matching
        equipment?: string[];       // Visible gear
    }>;

    // Our state
    locationMemory: LocationMemory;
    itemMemory: ItemMemory;
    currentRegion: string;
    combatLevel?: number;
    equipment?: string[];           // What we're wearing
    inventory?: string[];           // What we're carrying (for charity offers)
    bankLow?: string[];             // Resources we're running low on
    skills?: Record<string, number>; // Our skill levels

    // Active needs
    activeItemSearches?: string[];  // Items we're looking for
    questHints?: string[];          // Cryptic clues we're trying to solve

    // Recent discoveries to share
    recentDiscoveries?: Array<{
        type: 'location' | 'item' | 'monster' | 'secret';
        description: string;
        region: string;
    }>;

    // Nearby points of interest
    nearbyDungeons?: string[];      // Dungeon entrances nearby
    nearbyShops?: string[];         // Shops in the area

    // Waiting for someone
    waitingForPlayer?: {
        name: string;
        targetSkill: string;
        targetLevel: number;
    };

    // Personal state
    isBirthday?: boolean;
    playingSince?: number;          // Year started playing (for nostalgia)

    // Personality traits (affects topic selection)
    personality?: {
        sociability: number;
        curiosity: number;
        helpfulness: number;
        mischievousness: number;    // For scam attempts (in good fun)
        romanticism: number;        // For flirting
        philosophy: number;         // For deep questions
        adventurousness: number;
        playfulness: number;        // For pet roleplay, silly stuff
        rudeness: number;           // For aggressive personalities
        childishness: number;       // For toddler-like behavior
        mysticism: number;          // For wizard/poetic speech
    };
}

/**
 * Generate conversation topics based on context.
 * Returns 3-5 topics sorted by priority.
 */
export function generateConversationTopics(ctx: ConversationContext): ConversationTopic[] {
    const topics: ConversationTopic[] = [];
    const personality = ctx.personality || {
        sociability: 0.5,
        curiosity: 0.5,
        helpfulness: 0.5,
        mischievousness: 0.1,
        romanticism: 0.2,
        philosophy: 0.3,
        adventurousness: 0.5,
    };

    // 1. Directions topics (if we're looking for somewhere)
    const unknownDestinations = ctx.locationMemory.getUnknownDestinations();
    for (const dest of unknownDestinations.slice(0, 2)) {
        topics.push(createDirectionsTopic(dest, ctx.currentActivity, personality.curiosity));
    }

    // 2. Item search topics
    if (ctx.activeItemSearches && ctx.activeItemSearches.length > 0) {
        topics.push(...createItemSearchTopics(ctx.activeItemSearches, ctx.currentActivity));
    }

    // 3. Resource discovery topics (skill-specific)
    if (['mining', 'woodcutting', 'fishing'].includes(ctx.currentActivity)) {
        topics.push(createResourceDiscoveryTopic(ctx.currentActivity, personality.curiosity));
    }

    // 4. Quest hint topics
    if (ctx.questHints && ctx.questHints.length > 0) {
        topics.push(createQuestHintTopic(ctx.questHints[0]));
    }

    // 5. PvP invitation (if similar combat level nearby)
    const pvpCandidates = ctx.nearbyPlayers.filter(p =>
        p.combatLevel && ctx.combatLevel &&
        Math.abs(p.combatLevel - ctx.combatLevel) <= 10
    );
    if (pvpCandidates.length > 0 && personality.adventurousness > 0.5) {
        topics.push(createPvPTopic(pvpCandidates[0], ctx.combatLevel!));
    }

    // 6. Service offers (if we can help with their activity)
    topics.push(...createServiceTopics(ctx));

    // 7. Trade/item requests (if we need something)
    if (ctx.bankLow && ctx.bankLow.length > 0) {
        topics.push(createTradeRequestTopic(ctx.bankLow[0]));
    }

    // 8. Discovery sharing
    if (ctx.recentDiscoveries && ctx.recentDiscoveries.length > 0) {
        topics.push(createDiscoverySharingTopic(ctx.recentDiscoveries[0]));
    }

    // 9. Charity offers (if we have spare food/items)
    if (ctx.inventory && personality.helpfulness > 0.6) {
        topics.push(...createCharityTopics(ctx.inventory, personality.helpfulness));
    }

    // 10. Music/social fun
    if (personality.sociability > 0.6) {
        topics.push(createMusicTopic());
    }

    // 11. Companion invitation
    if (personality.sociability > 0.5 && personality.adventurousness > 0.4) {
        topics.push(createCompanionTopic(ctx.nearbyPlayers[0]?.name));
    }

    // 12. Collaborative activity proposals
    topics.push(...createCollaborativeTopics(ctx));

    // 13. Compliments (based on nearby player equipment)
    const equippedPlayers = ctx.nearbyPlayers.filter(p => p.equipment && p.equipment.length > 0);
    if (equippedPlayers.length > 0 && personality.sociability > 0.4) {
        topics.push(createComplimentTopic(equippedPlayers[0]));
    }

    // 14. Flirting (low probability, personality dependent)
    if (Math.random() < personality.romanticism * 0.3) {
        topics.push(createFlirtTopic());
    }

    // 15. Scam attempts (very low probability, for humor/authenticity)
    if (Math.random() < personality.mischievousness * 0.1) {
        topics.push(createScamTopic());
    }

    // 16. Philosophy
    if (personality.philosophy > 0.5 && Math.random() < 0.3) {
        topics.push(createPhilosophyTopic());
    }

    // 17. Activity-specific chat
    topics.push(...createActivityTopics(ctx.currentActivity, ctx.currentRegion, ctx.activityDurationMs));

    // 18. Generic social topics
    topics.push(...createGenericTopics(personality.sociability));

    // 19. Nearby player specific (if same activity)
    const sameActivity = ctx.nearbyPlayers.filter(p => p.activity === ctx.currentActivity);
    if (sameActivity.length > 0) {
        topics.push(createSharedActivityTopic(ctx.currentActivity, sameActivity[0].name));
    }

    // 20. Dungeon invites
    if (ctx.nearbyDungeons && ctx.nearbyDungeons.length > 0 && personality.adventurousness > 0.4) {
        topics.push(createDungeonInviteTopic(ctx.nearbyDungeons[0]));
    }

    // 21. Exploration proposals
    if (personality.adventurousness > 0.3 || personality.curiosity > 0.4) {
        topics.push(createExplorationTopic());
    }

    // 22. Shopping trips
    if (ctx.nearbyShops && ctx.nearbyShops.length === 0) {
        // No shops nearby = good time to propose a trip
        topics.push(createShoppingTripTopic());
    }

    // 23. Nostalgia chat
    if (ctx.playingSince && ctx.playingSince <= 2004) {
        topics.push(createNostalgiaTopic(ctx.playingSince));
    } else if (Math.random() < 0.2) {
        topics.push(createNostalgiaTopic());
    }

    // 24. Skill level checks
    topics.push(createSkillCheckTopic(ctx.currentActivity));

    // 25. Progress tracking (if waiting for someone)
    if (ctx.waitingForPlayer) {
        topics.push(createProgressTrackingTopic(ctx.waitingForPlayer));
    }

    // 26. Birthday!
    if (ctx.isBirthday) {
        topics.push(createBirthdayTopic());
    }

    // 27. Pet roleplay (playful personalities)
    if (personality.playfulness > 0.7 && Math.random() < 0.3) {
        topics.push(createPetRoleplayTopic());
    }

    // 28. Improvised conversation
    if (personality.sociability > 0.5) {
        topics.push(createImprovisedTopic());
    }

    // 29. Seniority check (asking how long they've played)
    if (personality.curiosity > 0.3) {
        topics.push(createSeniorityCheckTopic());
    }

    // Sort by priority (with some randomization)
    topics.sort((a, b) => {
        const aScore = a.priority + Math.random() * 20;
        const bScore = b.priority + Math.random() * 20;
        return bScore - aScore;
    });

    // Return top 3-5
    return topics.slice(0, Math.min(5, Math.max(3, topics.length)));
}

function createDirectionsTopic(
    dest: UnknownDestination,
    currentActivity: ActivityType,
    curiosity: number
): ConversationTopic {
    // Different openers based on activity context
    const openers: Record<ActivityType, string[]> = {
        mining: [
            `Hey, while we're mining... do you know how to get to ${dest.name}?`,
            `Say, you wouldn't happen to know where ${dest.name} is?`,
        ],
        woodcutting: [
            `Nice trees here. Hey, have you ever been to ${dest.name}?`,
            `While we're chopping... any idea where ${dest.name} is?`,
        ],
        fishing: [
            `Good fishing spot. Speaking of places, you know how to get to ${dest.name}?`,
            `Peaceful here. Hey, ever heard of ${dest.name}?`,
        ],
        combat: [
            `Good fight! Hey, do you know the way to ${dest.name}?`,
            `Between kills - any idea where ${dest.name} is?`,
        ],
        idle: [
            `Hey, do you know how to get to ${dest.name}?`,
            `I'm looking for ${dest.name}, any idea where that is?`,
        ],
        wandering: [
            `I'm a bit lost actually. Do you know where ${dest.name} is?`,
            `Exploring around... have you been to ${dest.name}?`,
        ],
        smithing: [`Hammering away here. Know anything about getting to ${dest.name}?`],
        cooking: [`While the food's cooking... ever been to ${dest.name}?`],
        crafting: [`Crafting is meditative. Say, do you know ${dest.name}?`],
        fletching: [`Making some arrows. Hey, you know the way to ${dest.name}?`],
        firemaking: [`Nice fire. Speaking of travels, know how to reach ${dest.name}?`],
        runecrafting: [`Mysterious stuff, runecrafting. Ever heard of ${dest.name}?`],
        herblore: [`Mixing potions. Hey, where's ${dest.name} again?`],
        thieving: [`Shh... know anywhere called ${dest.name}?`],
        agility: [`Good workout! Know where ${dest.name} is?`],
        farming: [`Plants growing well. Say, where's ${dest.name}?`],
        hunter: [`Tracking's tough. You know ${dest.name}?`],
        construction: [`Building stuff. Know how to get to ${dest.name}?`],
    };

    const activityOpeners = openers[currentActivity] || openers.idle;
    const opener = activityOpeners[Math.floor(Math.random() * activityOpeners.length)];

    return {
        id: `directions_${dest.name}`,
        type: 'directions',
        priority: 60 + curiosity * 20,  // Higher curiosity = more likely to ask
        opener,
        context: `Looking for ${dest.name}: ${dest.reason}`,
        expectedResponse: 'directions or "I don\'t know"',
        followUp: `No worries, I'll keep looking. Thanks anyway!`,
        destinationName: dest.name,
    };
}

function createActivityTopics(activity: ActivityType, region: string, durationMs: number): ConversationTopic[] {
    const topics: ConversationTopic[] = [];
    const minutesActive = durationMs / 60000;

    // Activity-specific comments
    const activityComments: Record<ActivityType, string[]> = {
        mining: [
            'Finding any good ore today?',
            'The rocks seem pretty generous lately.',
            'My pickaxe is getting worn out!',
        ],
        woodcutting: [
            'These trees take forever to respawn.',
            'Getting much wood today?',
            'I love the sound of chopping.',
        ],
        fishing: [
            'Catch anything good?',
            'Fish are biting well today.',
            'This is relaxing, isn\'t it?',
        ],
        combat: [
            'Good loot from these guys?',
            'Watch out for that one!',
            'Nice combo there!',
        ],
        smithing: [
            'What are you making?',
            'Smithing is satisfying work.',
            'Need any bars?',
        ],
        cooking: [
            'Smells good!',
            'Burning much?',
            'I\'m getting hungry watching you.',
        ],
        idle: [
            'Just hanging out?',
            'Nice day, isn\'t it?',
            'What brings you here?',
        ],
        wandering: [
            'Exploring?',
            'Nice area around here.',
            'Seen anything interesting?',
        ],
        crafting: ['Making anything cool?'],
        fletching: ['How many arrows so far?'],
        firemaking: ['Warming up?'],
        runecrafting: ['Which runes?'],
        herblore: ['What potion?'],
        thieving: ['Shhh...'],
        agility: ['Good exercise!'],
        farming: ['What\'s growing?'],
        hunter: ['Track anything?'],
        construction: ['Building what?'],
    };

    const comments = activityComments[activity] || activityComments.idle;

    // Add a random activity comment
    topics.push({
        id: `activity_${activity}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'activity_chat',
        priority: 40,
        opener: comments[Math.floor(Math.random() * comments.length)],
        context: `Been ${activity} for ${Math.round(minutesActive)} minutes`,
    });

    // If we've been at it a while, add a "taking a break" comment
    if (minutesActive > 10) {
        topics.push({
            id: 'break_comment',
            type: 'activity_chat',
            priority: 30,
            opener: 'Been at this a while! Taking a short break.',
            context: `${activity} for ${Math.round(minutesActive)} minutes`,
        });
    }

    return topics;
}

function createGenericTopics(sociability: number): ConversationTopic[] {
    const topics: ConversationTopic[] = [];

    const greetings = [
        'Hey there!',
        'Hi! How\'s it going?',
        'Hello fellow adventurer!',
        '*waves*',
    ];

    const smallTalk = [
        'Nice weather in the game today.',
        'Been playing long?',
        'What are you working on these days?',
        'Seen any cool drops lately?',
    ];

    // Greeting (more likely if social)
    topics.push({
        id: 'greeting',
        type: 'greeting',
        priority: 30 + sociability * 30,
        opener: greetings[Math.floor(Math.random() * greetings.length)],
        context: 'Starting a conversation',
    });

    // Small talk
    topics.push({
        id: 'smalltalk',
        type: 'question',
        priority: 25 + sociability * 20,
        opener: smallTalk[Math.floor(Math.random() * smallTalk.length)],
        context: 'General chat',
    });

    return topics;
}

function createSharedActivityTopic(activity: ActivityType, playerName: string): ConversationTopic {
    const comments: Record<ActivityType, string> = {
        mining: `Mining buddies! How's your haul, ${playerName}?`,
        woodcutting: `Fellow lumberjack! Good trees here, right?`,
        fishing: `Another fisher! Peaceful spot.`,
        combat: `Good to have backup! Nice moves.`,
        smithing: `Smithing partners! What are you making?`,
        cooking: `Cooking together! Don't burn it!`,
        idle: `Just chilling too? Nice.`,
        wandering: `Fellow explorer! Find anything good?`,
        crafting: `Crafters unite!`,
        fletching: `Making arrows too?`,
        firemaking: `Fire party!`,
        runecrafting: `Mysterious, isn't it?`,
        herblore: `Potion pals!`,
        thieving: `Keep it quiet...`,
        agility: `Race you!`,
        farming: `Green thumbs!`,
        hunter: `On the hunt!`,
        construction: `Building crew!`,
    };

    return {
        id: `shared_activity_${playerName}`,
        type: 'activity_chat',
        priority: 50,
        opener: comments[activity] || `Hey ${playerName}!`,
        context: `Both doing ${activity}`,
    };
}

// ========== NEW TOPIC CREATORS ==========

function createItemSearchTopics(items: string[], activity: ActivityType): ConversationTopic[] {
    return items.slice(0, 2).map(item => ({
        id: `item_search_${item}`,
        type: 'item_location' as TopicType,
        priority: 55,
        opener: pickRandom([
            `Hey, do you know where I can find ${item}?`,
            `I'm looking for ${item}. Any idea where to get one?`,
            `You wouldn't happen to know how to get ${item}?`,
            `Been searching for ${item} forever. Know anything?`,
        ]),
        context: `Searching for ${item}`,
        itemName: item,
        followUp: `No worries, I'll keep looking. Thanks though!`,
    }));
}

function createResourceDiscoveryTopic(activity: ActivityType, curiosity: number): ConversationTopic {
    const resourceQuestions: Record<string, string[]> = {
        mining: [
            'Have you ever seen a place with mithril rocks around here?',
            'Know any good spots with coal? I need a ton.',
            'Seen any gold rocks nearby? Asking for a friend.',
            'Is there anywhere with runite that isn\'t always crowded?',
        ],
        woodcutting: [
            'Know where I can find yew trees that aren\'t packed?',
            'Seen any magic trees around? Need to level up.',
            'Is there a good spot for willows near water?',
        ],
        fishing: [
            'Know any quiet fishing spots? This one\'s getting busy.',
            'Where can I catch lobsters around here?',
            'Heard there\'s good shark fishing somewhere. Know where?',
        ],
    };

    const questions = resourceQuestions[activity] || ['Found any good resource spots lately?'];

    return {
        id: `resource_discovery_${activity}`,
        type: 'resource_discovery',
        priority: 40 + curiosity * 20,
        opener: pickRandom(questions),
        context: `Looking for better ${activity} spots`,
    };
}

function createQuestHintTopic(hint: string): ConversationTopic {
    return {
        id: `quest_hint_${hint.slice(0, 20)}`,
        type: 'quest_hint',
        priority: 65,
        opener: `Someone once told me "${hint}" - do you have any idea what that means?`,
        context: 'Trying to solve a cryptic hint',
        questHint: hint,
        followUp: `Hmm, guess I\'ll have to figure it out. Thanks anyway!`,
    };
}

function createPvPTopic(player: { name: string; combatLevel?: number }, myCombatLevel: number): ConversationTopic {
    const levelDiff = Math.abs((player.combatLevel || myCombatLevel) - myCombatLevel);
    const fairFight = levelDiff <= 5;

    return {
        id: `pvp_${player.name}`,
        type: 'pvp_invitation',
        priority: 35,
        opener: fairFight
            ? `Hey ${player.name}, we're about the same level. Wanna have a friendly fight in the wilderness?`
            : `Hey ${player.name}, fancy a duel? I promise I'll go easy on you.`,
        context: `Combat levels are close (±${levelDiff})`,
        followUp: `No worries, maybe another time!`,
    };
}

function createServiceTopics(ctx: ConversationContext): ConversationTopic[] {
    const topics: ConversationTopic[] = [];

    // Offer to carry/bank resources
    if (ctx.currentActivity === 'mining' || ctx.currentActivity === 'woodcutting') {
        topics.push({
            id: 'service_carry',
            type: 'service_offer',
            priority: 30,
            opener: pickRandom([
                'I can carry your ore to the bank if you pay me a bit.',
                'Need someone to do bank runs? I\'ll do it for a cut.',
                'I\'ll ferry your stuff to the bank. 10% of the load?',
            ]),
            context: 'Offering carrying service',
        });
    }

    // Offer runecrafting services
    if (ctx.skills?.runecrafting && ctx.skills.runecrafting > 50) {
        topics.push({
            id: 'service_lawrunning',
            type: 'service_offer',
            priority: 25,
            opener: 'Do you know how to do law running? I can teach you, or we could team up.',
            context: 'Offering runecrafting assistance',
        });
    }

    return topics;
}

function createTradeRequestTopic(item: string): ConversationTopic {
    const quantities: Record<string, number> = {
        ruby: 6, sapphire: 4, emerald: 5, diamond: 2,
        coal: 27, iron: 14, gold: 10,
        'law rune': 1, 'nature rune': 5,
    };

    const qty = quantities[item.toLowerCase()] || Math.floor(Math.random() * 5) + 1;

    return {
        id: `trade_request_${item}`,
        type: 'trade_request',
        priority: 45,
        opener: pickRandom([
            `Hey, do you have any ${item}? I need ${qty}.`,
            `I'm looking for ${qty} ${item}. Got any to spare?`,
            `Don't suppose you have ${qty} ${item} you'd sell?`,
        ]),
        context: `Running low on ${item}`,
        itemName: item,
    };
}

function createDiscoverySharingTopic(discovery: {
    type: string;
    description: string;
    region: string;
}): ConversationTopic {
    return {
        id: `discovery_${discovery.type}`,
        type: 'discovery_share',
        priority: 55,
        opener: pickRandom([
            `Hey, I found something cool! ${discovery.description} in ${discovery.region}.`,
            `You won't believe what I found in ${discovery.region}. ${discovery.description}!`,
            `I discovered a new thing in a place nobody ever goes - ${discovery.description}.`,
        ]),
        context: `Sharing recent discovery: ${discovery.description}`,
    };
}

function createCharityTopics(inventory: string[], helpfulness: number): ConversationTopic[] {
    const topics: ConversationTopic[] = [];

    // Food charity
    const foods = inventory.filter(i =>
        i.includes('pie') || i.includes('cake') || i.includes('fish') ||
        i.includes('lobster') || i.includes('shark')
    );
    if (foods.length > 0) {
        topics.push({
            id: 'charity_food',
            type: 'charity_offer',
            priority: 25 + helpfulness * 20,
            opener: pickRandom([
                `Hey, do you want a ${foods[0]}?`,
                `You look hungry. Want some ${foods[0]}?`,
                `I've got extra ${foods[0]} if you need healing.`,
            ]),
            context: 'Offering spare food',
        });
    }

    return topics;
}

function createMusicTopic(): ConversationTopic {
    return {
        id: 'music_social',
        type: 'music_social',
        priority: 20,
        opener: pickRandom([
            'What song should I listen to?',
            'Got any music recommendations?',
            'What\'s your favorite RuneScape track?',
            '*hums* Know any good tunes?',
        ]),
        context: 'Social music chat',
        expectedResponse: 'A song name or music recommendation',
    };
}

function createCompanionTopic(playerName?: string): ConversationTopic {
    return {
        id: 'companion_invite',
        type: 'companion_invite',
        priority: 40,
        opener: playerName
            ? `Hey ${playerName}, wanna follow me around for a bit? Or are you doing your own thing?`
            : `Anyone want to adventure together for a while?`,
        context: 'Looking for company',
        followUp: `No worries, happy adventuring!`,
    };
}

function createCollaborativeTopics(ctx: ConversationContext): ConversationTopic[] {
    const topics: ConversationTopic[] = [];

    // Thieving cakes proposal
    if (ctx.bankLow?.some(i => i.includes('food') || i.includes('cake'))) {
        topics.push({
            id: 'collab_thieving',
            type: 'activity_proposal',
            priority: 35,
            opener: `I'm low on food in my bank. Want to travel to Ardougne and thieve some cakes together?`,
            context: 'Low on food, proposing collaborative thieving',
            activityProposal: { activity: 'thieving', location: 'Ardougne' },
        });
    }

    // Generic adventure proposal
    topics.push({
        id: 'collab_adventure',
        type: 'activity_proposal',
        priority: 25,
        opener: pickRandom([
            'Wanna go exploring together?',
            'I\'m thinking of checking out the wilderness. Want to come?',
            'Feel like doing a dungeon run?',
        ]),
        context: 'Proposing collaborative adventure',
    });

    return topics;
}

function createComplimentTopic(player: { name: string; equipment?: string[] }): ConversationTopic {
    const gear = player.equipment?.[0] || 'gear';
    const compliments = [
        `Nice ${gear}!`,
        `Cool outfit, ${player.name}!`,
        `That ${gear} looks sick.`,
        `Where'd you get that ${gear}?`,
        `I like your style.`,
    ];

    return {
        id: `compliment_${player.name}`,
        type: 'compliment',
        priority: 30,
        opener: pickRandom(compliments),
        context: `Complimenting ${player.name}'s equipment`,
    };
}

function createFlirtTopic(): ConversationTopic {
    return {
        id: 'flirt',
        type: 'flirt',
        priority: 15,
        opener: pickRandom([
            'do u wanna be my gf',
            'hey ur cute',
            'buying gf 10k',
            '*waves* hey there ;)',
        ]),
        context: 'Classic MMO flirting',
    };
}

function createScamTopic(): ConversationTopic {
    return {
        id: 'scam',
        type: 'scam_attempt',
        priority: 5,  // Very low - rare and obvious
        opener: pickRandom([
            'Can I trim your armor? Only 600gp!',
            'Doubling money! Trade me!',
            'Free armor trimming!',
            'Drop your items and press alt+f4 to duplicate them!',
        ]),
        context: 'Classic scam attempt (for humor/authenticity)',
    };
}

function createPhilosophyTopic(): ConversationTopic {
    const questions = [
        'Is it better to be charitable or kind?',
        'Do you think the goblins know they\'re just respawning?',
        'If a tree falls in the wilderness and no one\'s around, does it give xp?',
        'What makes an adventurer truly successful?',
        'Do you ever wonder what\'s beyond the map edges?',
        'Is grinding actually meditation?',
        'Would you rather have max stats or infinite gold?',
    ];

    return {
        id: 'philosophy',
        type: 'philosophy',
        priority: 20,
        opener: pickRandom(questions),
        context: 'Deep thoughts while skilling',
    };
}

// Charity request (needs something small)
function createCharityRequestTopic(item: string): ConversationTopic {
    return {
        id: `charity_request_${item}`,
        type: 'charity_request',
        priority: 35,
        opener: pickRandom([
            `Hey, do you have a ${item}? I need to teleport and I'm short.`,
            `Sorry to ask, but got a spare ${item}?`,
            `I lost my ${item}. Do you have an extra I could have?`,
        ]),
        context: `Needs ${item}`,
        itemName: item,
        followUp: `No problem, thanks anyway!`,
    };
}

// Item need (lost weapon, etc.)
function createItemNeedTopic(itemType: string, maxTier: string): ConversationTopic {
    return {
        id: `item_need_${itemType}`,
        type: 'item_need',
        priority: 50,
        opener: `Hey, I lost my ${itemType}. Do you have an extra? I can use up to ${maxTier}.`,
        context: `Lost equipment, needs replacement`,
        followUp: `That's okay, I'll figure something out.`,
    };
}

// ========== ADVENTURE & SOCIAL TOPICS ==========

function createDungeonInviteTopic(dungeonName: string): ConversationTopic {
    return {
        id: `dungeon_${dungeonName}`,
        type: 'dungeon_invite',
        priority: 45,
        opener: pickRandom([
            `Hey, do you want to go down in ${dungeonName}?`,
            `Wanna check out ${dungeonName} together?`,
            `I'm thinking about exploring ${dungeonName}. Want to come?`,
            `That dungeon looks interesting. Want to go in?`,
        ]),
        context: `Near ${dungeonName}`,
        followUp: `No worries, maybe another time!`,
    };
}

function createExplorationTopic(): ConversationTopic {
    const directions = ['north', 'south', 'east', 'west', 'over that hill', 'past those trees', 'along the river'];
    const direction = pickRandom(directions);

    return {
        id: 'exploration_propose',
        type: 'exploration_propose',
        priority: 35,
        opener: pickRandom([
            `Hey, what if we moved off ${direction}? Might find something good.`,
            `I wonder what's ${direction}. Want to check it out?`,
            `Getting a bit bored here. Want to explore ${direction}?`,
            `Let's wander ${direction} and see what we find.`,
            `I have a feeling there's something interesting ${direction}.`,
        ]),
        context: 'Looking to explore together',
    };
}

function createShoppingTripTopic(): ConversationTopic {
    const towns = ['Varrock', 'Falador', 'Ardougne', 'Camelot', 'Yanille', 'Rellekka'];
    const items = ['a new weapon', 'some runes', 'food supplies', 'crafting materials', 'better armor'];

    return {
        id: 'shopping_trip',
        type: 'shopping_trip',
        priority: 30,
        opener: pickRandom([
            `I need to buy ${pickRandom(items)} from a shop in ${pickRandom(towns)}. Want to come with me?`,
            `Thinking of making a trip to ${pickRandom(towns)} for supplies. Want to tag along?`,
            `I'm running low on stuff. Want to go shopping in ${pickRandom(towns)}?`,
        ]),
        context: 'Proposing a shopping trip together',
        followUp: `Okay, I'll go by myself then!`,
    };
}

function createNostalgiaTopic(yearStarted?: number): ConversationTopic {
    const year = yearStarted || 2004;
    return {
        id: 'nostalgia',
        type: 'nostalgia',
        priority: 25,
        opener: pickRandom([
            `Hey, have you played this game since ${year} or before?`,
            `Remember when the wilderness was actually scary?`,
            `I've been playing since ${year}. You?`,
            `Things were so different back in the day. When did you start?`,
            `Do you remember when rune armor was the best?`,
            `I miss the old tutorial island.`,
        ]),
        context: `Nostalgia chat (playing since ${year})`,
    };
}

function createSkillCheckTopic(activity: ActivityType): ConversationTopic {
    const skillMap: Record<ActivityType, string> = {
        mining: 'mining', woodcutting: 'woodcutting', fishing: 'fishing',
        smithing: 'smithing', cooking: 'cooking', crafting: 'crafting',
        fletching: 'fletching', firemaking: 'firemaking', runecrafting: 'runecrafting',
        herblore: 'herblore', thieving: 'thieving', agility: 'agility',
        farming: 'farming', hunter: 'hunter', construction: 'construction',
        combat: 'combat', idle: 'total', wandering: 'total',
    };
    const skill = skillMap[activity] || 'total';

    return {
        id: `skill_check_${skill}`,
        type: 'skill_check',
        priority: 35,
        opener: pickRandom([
            `Hey, what's your ${skill} level?`,
            `What level ${skill} are you?`,
            `How far along are you in ${skill}?`,
            `${skill.charAt(0).toUpperCase() + skill.slice(1)} level?`,
        ]),
        context: `Asking about ${skill} level`,
    };
}

function createProgressTrackingTopic(waiting: { name: string; targetSkill: string; targetLevel: number }): ConversationTopic {
    return {
        id: `progress_${waiting.name}`,
        type: 'progress_tracking',
        priority: 55,
        opener: pickRandom([
            `Hey ${waiting.name}, how long until ${waiting.targetLevel}?`,
            `${waiting.name}, what's your ${waiting.targetSkill} at now?`,
            `Almost at ${waiting.targetLevel} yet?`,
            `How's the grind going? Close to ${waiting.targetLevel}?`,
        ]),
        context: `Waiting for ${waiting.name} to reach level ${waiting.targetLevel} ${waiting.targetSkill}`,
    };
}

function createBirthdayTopic(): ConversationTopic {
    return {
        id: 'birthday',
        type: 'personal_share',
        priority: 70,  // High priority - birthdays are special!
        opener: pickRandom([
            `It's my birthday today!`,
            `Hey guess what? It's my birthday!`,
            `Today's my birthday :)`,
            `Birthday today! Celebrating by playing.`,
        ]),
        context: 'Sharing birthday',
    };
}

function createPetRoleplayTopic(): ConversationTopic {
    return {
        id: 'pet_roleplay',
        type: 'pet_roleplay',
        priority: 20,
        opener: pickRandom([
            `Can I be your cat?`,
            `*meow* can I follow you around?`,
            `I want to be someone's pet. *sits*`,
            `Will you adopt me? I can meow at things.`,
        ]),
        context: 'Playful pet roleplay request',
        followUp: `*sad meow*`,
    };
}

function createImprovisedTopic(): ConversationTopic {
    const topics = [
        `What's the weirdest thing that's happened to you in game?`,
        `If you could add one thing to the game, what would it be?`,
        `What's your favorite place to just hang out?`,
        `Do you have any in-game goals right now?`,
        `What got you into this game?`,
        `If you were an NPC, what would you sell?`,
        `What's the longest you've played in one session?`,
        `Ever made any good friends in game?`,
        `What's your hot take about the game?`,
        `If you could live anywhere in the game world, where?`,
    ];

    return {
        id: 'improvised',
        type: 'improvised',
        priority: 25,
        opener: pickRandom(topics),
        context: 'Improvised conversation',
    };
}

function createSeniorityCheckTopic(): ConversationTopic {
    return {
        id: 'seniority_check',
        type: 'seniority_check',
        priority: 30,
        opener: pickRandom([
            `How long have you been playing?`,
            `When did you start playing?`,
            `Are you a veteran or newer player?`,
            `What year did you start?`,
            `How many years have you played?`,
        ]),
        context: 'Asking about seniority/experience',
        expectedResponse: 'A year or number of years',
    };
}

// ========== TEXT EFFECTS FOR SPECIAL MOMENTS ==========

/**
 * RuneScape-style chat effects.
 */
export const TEXT_EFFECTS = {
    colors: ['red:', 'green:', 'cyan:', 'purple:', 'white:', 'yellow:'],
    animations: ['wave:', 'wave2:', 'shake:', 'scroll:', 'slide:', 'glow1:', 'glow2:', 'glow3:'],
};

/**
 * Generate a random text effect combination.
 */
export function randomTextEffect(): string {
    const useColor = Math.random() < 0.7;
    const useAnim = Math.random() < 0.8;

    let effect = '';
    if (useColor) effect += pickRandom(TEXT_EFFECTS.colors);
    if (useAnim) effect += pickRandom(TEXT_EFFECTS.animations);

    return effect;
}

/**
 * Birthday match reaction - MUST BE EXCITED!
 */
export function birthdayMatchReaction(): string {
    const effects = [
        'glow2:wave:', 'glow1:shake:', 'cyan:wave2:', 'yellow:wave:',
        'red:glow3:', 'green:scroll:', 'purple:slide:',
    ];

    const exclamations = [
        'ME TOO!!',
        'OMG ME TOO!!!',
        'SAME!!!',
        'NO WAY ME TOO!!',
        'BIRTHDAY TWINS!!!',
        'THATS MY BIRTHDAY TOO!!!',
    ];

    const effect = pickRandom(effects);
    const exclamation = pickRandom(exclamations);

    return `${effect}${exclamation}`;
}

/**
 * Check if two birthdays match (MM-DD format).
 */
export function birthdaysMatch(birthday1: string, birthday2: string): boolean {
    return birthday1.toLowerCase() === birthday2.toLowerCase();
}

// Helper function
function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Check if it's a good time to start a conversation.
 */
export function shouldStartConversation(ctx: ConversationContext): {
    should: boolean;
    reason: string;
} {
    // Need at least one nearby player doing the same activity
    const sameActivity = ctx.nearbyPlayers.filter(
        p => p.activity === ctx.currentActivity && p.distance < 10
    );

    if (sameActivity.length === 0) {
        return { should: false, reason: 'No one nearby doing the same activity' };
    }

    // Should have been at the activity for at least 30 seconds (settled in)
    if (ctx.activityDurationMs < 30000) {
        return { should: false, reason: 'Just started this activity' };
    }

    // Higher chance if looking for directions
    const unknownDests = ctx.locationMemory.getUnknownDestinations();
    if (unknownDests.length > 0 && Math.random() < 0.7) {
        return { should: true, reason: 'Looking for directions to ' + unknownDests[0].name };
    }

    // Random chance based on sociability
    const sociability = ctx.personality?.sociability || 0.5;
    const chance = 0.1 + sociability * 0.3;  // 10-40% base chance

    if (Math.random() < chance) {
        return { should: true, reason: 'Feeling social' };
    }

    return { should: false, reason: 'Not feeling chatty right now' };
}

/**
 * Process a response to a directions question.
 */
export function processDirectionsResponse(
    response: string,
    destinationName: string,
    responderName: string,
    locationMemory: LocationMemory
): {
    gotDirections: boolean;
    message: string;
} {
    const lowerResponse = response.toLowerCase();

    // Check for "I don't know" type responses
    const dontKnowPatterns = [
        'don\'t know', 'dont know', 'dunno', 'no idea', 'not sure',
        'haven\'t been', 'never been', 'no clue', 'sorry'
    ];

    if (dontKnowPatterns.some(p => lowerResponse.includes(p))) {
        return {
            gotDirections: false,
            message: `No worries, thanks anyway! I'll keep looking.`,
        };
    }

    // Check for direction-giving patterns
    const directionPatterns = [
        /(?:go|head|walk|run)\s+(north|south|east|west)/i,
        /(?:it'?s?|that'?s?)\s+(?:in|at|near|by)\s+(\w+)/i,
        /(?:from here|from \w+).+(?:go|head|walk)/i,
    ];

    const hasDirections = directionPatterns.some(p => p.test(response));

    if (hasDirections) {
        // Extract the directions and store them
        locationMemory.toldAboutLocation(destinationName, responderName, {
            directions: {
                from: locationMemory.getCurrentLocation()?.name || 'here',
                directions: response,
            },
        });

        return {
            gotDirections: true,
            message: `Thanks! I'll try that way.`,
        };
    }

    // Ambiguous response - might be wrong info (the 20% case)
    // Store it tentatively
    locationMemory.toldAboutLocation(destinationName, responderName, {
        directions: {
            from: locationMemory.getCurrentLocation()?.name || 'here',
            directions: response,
        },
    });

    return {
        gotDirections: true,
        message: `I'll check it out, thanks!`,
    };
}
