// bot-core - Task-based bot execution framework
//
// This module provides the infrastructure for running bots with:
// - Task-based execution with priorities
// - Interrupt handling (DMs, combat, etc.)
// - Behavior registration and execution
// - LLM integration for decisions
//
// Key principle: The bot drives the LLM, not the other way around.

export {
    // Task management
    TaskManager,
    createTaskManager,
    INTERRUPT_PRIORITIES,
    TASK_PRIORITIES,
    // Timer & personality
    DEFAULT_PERSONALITY,
} from './task-manager';

export type {
    Task,
    TaskStatus,
    TaskType,
    TaskTimer,
    Interrupt,
    PersonalityTraits,
} from './task-manager';

export {
    // Behavior execution
    BehaviorExecutor,
    BehaviorRegistry,
    BehaviorFunction,
    BehaviorContext,
    BehaviorDefinition,
    createBehaviorExecutor,
    // Built-in behaviors
    idleBehavior,
    wanderBehavior,
} from './behavior-executor';

export {
    // Main runner
    BotRunner,
    BotRunnerConfig,
    createBotRunner,
} from './bot-runner';

export {
    // Item memory
    ItemMemory,
    createItemMemory,
} from './item-memory';

export type {
    ItemMemoryData,
    GroundSpawnEntry,
    MonsterDropEntry,
    CraftingRecipeEntry,
    ActiveSearch,
} from './item-memory';

export {
    // Location memory
    LocationMemory,
    createLocationMemory,
} from './location-memory';

export type {
    KnownLocation,
    UnknownDestination,
    LocationMemoryData,
} from './location-memory';

export {
    // Conversation system
    generateConversationTopics,
    shouldStartConversation,
    processDirectionsResponse,
    // Text effects & birthday
    TEXT_EFFECTS,
    randomTextEffect,
    birthdayMatchReaction,
    birthdaysMatch,
} from './conversation-topics';

export type {
    ConversationTopic,
    ConversationContext,
    ActivityType,
    TopicType,
} from './conversation-topics';

export {
    // Personality presets
    PERSONALITY_PRESETS,
    getPersonalityPreset,
    listPersonalityPresets,
    toddlerSpeak,
    rudeChallenge,
    catReaction,
    shouldUsePoeticResponse,
    analyzeResponseContext,
    generatePoemPrompt,
    // Seniority system
    calculateYearsPlaying,
    calculateRespectMultiplier,
    compareSeniority,
    respondToSeniorityQuestion,
    askSeniorityQuestion,
    isBirthdayToday,
    // Preset constants
    FRIENDLY_HELPER,
    INDEPENDENT_EXPLORER,
    QUIET_WORKER,
    SOCIAL_BUTTERFLY,
    RUDE_PVP_CHALLENGER,
    TODDLER,
    MAD_MAGE,
    WISE_SAGE,
    CAT_FOLLOWER,
    HARDCORE_JANITOR,
    TODDLER_VOCABULARY,
    CAT_ACTIONS,
} from './personality-presets';

export type {
    FullPersonality,
    ResponseMode,
    ResponseContext,
} from './personality-presets';
