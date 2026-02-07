// bot-runner.ts - Main bot execution loop
//
// This is the core loop that:
// 1. Checks for interrupts (DMs, combat, etc.)
// 2. Runs the highest priority task
// 3. Calls LLM for decisions when needed
// 4. Executes behaviors
//
// KEY PRINCIPLE: The bot drives the LLM, not the other way around.
// The LLM is consulted for decisions, but the task system is in control.

import { BotSDK, BotWorldState } from '../sdk/index';
import { BotActions } from '../sdk/actions';
import { OllamaContext, ToolDefinition, discoverTools, createToolExecutor } from '../bot-chat';
import { TaskManager, Task, Interrupt, INTERRUPT_PRIORITIES, TASK_PRIORITIES, createTaskManager } from './task-manager';
import { BehaviorExecutor, BehaviorDefinition, createBehaviorExecutor } from './behavior-executor';
import { ItemMemory, createItemMemory } from './item-memory';
import { LocationMemory, createLocationMemory } from './location-memory';
import {
    generateConversationTopics,
    shouldStartConversation,
    processDirectionsResponse,
    type ActivityType,
    type ConversationContext,
} from './conversation-topics';
import { describeLocation, type LocationContext } from '../locations';

export interface BotRunnerConfig {
    // Account
    username: string;
    password: string;
    gatewayUrl?: string;
    accountDir?: string;  // Path to account directory for persistent memory

    // Personality for LLM
    botName: string;
    personality: string;

    // Ollama
    ollamaHost?: string;
    ollamaPort?: number;
    ollamaModel?: string;

    // Tools directory
    toolsDir?: string;

    // Behavior settings
    respondToNearbyChat?: boolean;  // Default: false - ignore nearby chat unless DM
    nearbyRespond?: (sender: string, message: string) => boolean;  // Filter function

    // Logging
    log?: (...args: any[]) => void;
}

export interface BotRunner {
    // Lifecycle
    start(): Promise<void>;
    stop(): Promise<void>;

    // Access
    getTaskManager(): TaskManager;
    getBehaviorExecutor(): BehaviorExecutor;
    getSDK(): BotSDK;
    getBot(): BotActions;
    getOllama(): OllamaContext;
    getItemMemory(): ItemMemory;
    getLocationMemory(): LocationMemory;

    // Activity tracking (for social interactions)
    setActivity(activity: ActivityType): void;
    getActivity(): ActivityType;

    // Registration
    registerBehavior(def: BehaviorDefinition): void;
}

/**
 * Create and start a bot runner.
 *
 * This is the main entry point for running a bot with the new architecture.
 *
 * @example
 * ```typescript
 * const runner = await createBotRunner({
 *     username: 'mybot',
 *     password: 'pass123',
 *     botName: 'FriendlyBot',
 *     personality: 'A helpful adventurer who loves making friends',
 * });
 *
 * runner.registerBehavior({
 *     name: 'fish',
 *     description: 'Fish at the nearest fishing spot',
 *     fn: async (ctx) => { ... }
 * });
 *
 * await runner.start();
 * ```
 */
export async function createBotRunner(config: BotRunnerConfig): Promise<BotRunner> {
    const log = config.log ?? console.log;
    let running = false;
    let loopPromise: Promise<void> | null = null;

    // Create SDK and connect
    const sdk = new BotSDK({
        botUsername: config.username,
        password: config.password,
        gatewayUrl: config.gatewayUrl ?? 'ws://localhost:7780',
        connectionMode: 'control',
        autoReconnect: true,
        showChat: true,  // Need to see chat for interrupts
    });

    const bot = new BotActions(sdk);
    const taskManager = createTaskManager();
    const behaviorExecutor = createBehaviorExecutor(sdk, bot, taskManager, log);

    // Create persistent memory systems
    const accountDir = config.accountDir ?? `./accounts/${config.username}`;

    const itemMemory = createItemMemory(accountDir);
    itemMemory.load();
    itemMemory.startAutoSave(30000);  // Auto-save every 30 seconds
    log(`[BotRunner] Loaded item memory from ${accountDir}/memory.json`);

    const locationMemory = createLocationMemory(accountDir);
    locationMemory.load();
    log(`[BotRunner] Loaded location memory from ${accountDir}/locations.json`);

    // Track current activity for social interactions
    let currentActivity: ActivityType = 'idle';
    let activityStartTime = Date.now();

    // Create Ollama context
    const ollama = new OllamaContext({
        host: config.ollamaHost ?? '192.168.0.61',
        port: config.ollamaPort ?? 16180,
        model: config.ollamaModel ?? 'llama3.2',
        systemPrompt: buildSystemPrompt(config, taskManager, behaviorExecutor),
    });

    // Discover and set up tools
    const toolsDir = config.toolsDir ?? './tools';
    try {
        const tools = await discoverTools(toolsDir);
        // Add built-in task tools, memory tools, and location tools
        const allTools = [
            ...tools,
            ...getTaskTools(taskManager, behaviorExecutor),
            ...getItemMemoryTools(itemMemory),
            ...getLocationMemoryTools(locationMemory),
        ];
        ollama.setTools(allTools);
        ollama.setToolExecutor(createTaskToolExecutor(
            taskManager,
            behaviorExecutor,
            itemMemory,
            locationMemory,
            () => ({ activity: currentActivity, startTime: activityStartTime }),
            createToolExecutor(toolsDir)
        ));
        log(`[BotRunner] Loaded ${allTools.length} tools`);
    } catch (err) {
        log(`[BotRunner] Warning: Could not discover tools from ${toolsDir}: ${err}`);
    }

    // Track recent messages for interrupt detection
    let lastSeenMessageTick = 0;

    // Check for interrupts from game state
    function checkForInterrupts(state: BotWorldState): Interrupt | null {
        // Check for new messages
        for (const msg of state.gameMessages) {
            if (msg.tick <= lastSeenMessageTick) continue;
            lastSeenMessageTick = msg.tick;

            // Type 3 = private message (DM) - always interrupt
            if (msg.type === 3) {
                return {
                    type: 'dm',
                    priority: INTERRUPT_PRIORITIES.dm,
                    data: { from: msg.sender, content: msg.content, tick: msg.tick }
                };
            }

            // Type 2 = public chat - only interrupt if configured
            if (msg.type === 2 && config.respondToNearbyChat) {
                const shouldRespond = config.nearbyRespond?.(msg.sender || '', msg.content) ?? true;
                if (shouldRespond) {
                    return {
                        type: 'nearby_chat',
                        priority: INTERRUPT_PRIORITIES.nearby_chat,
                        data: { from: msg.sender, content: msg.content, tick: msg.tick }
                    };
                }
            }
        }

        // Check for combat (being attacked)
        // Lua port note: Check player.inCombat or similar state flag
        if (state.player?.inCombat) {
            return {
                type: 'combat',
                priority: INTERRUPT_PRIORITIES.combat,
                data: { targetName: state.player.targetName }
            };
        }

        // Check for low health
        const healthPercent = state.player ? (state.player.hitpoints / state.player.maxHitpoints) * 100 : 100;
        if (healthPercent < 30) {
            return {
                type: 'low_health',
                priority: INTERRUPT_PRIORITIES.low_health,
                data: { health: state.player?.hitpoints, maxHealth: state.player?.maxHitpoints, percent: healthPercent }
            };
        }

        return null;
    }

    // Get current location description from state and task
    function getCurrentLocationDescription(): string {
        const state = sdk.getState();
        if (!state?.player) return 'unknown location';

        const currentTask = taskManager.getCurrentTask();

        // Build location context
        const locCtx: LocationContext = {
            x: state.player.worldX,
            z: state.player.worldZ,
        };

        // Add movement info from current task if it's a behavior with destination
        if (currentTask?.behaviorState?.destinationX !== undefined) {
            locCtx.isMoving = true;
            locCtx.isRunning = state.player.runEnergy > 0;  // Assume running if has energy
            locCtx.destinationX = currentTask.behaviorState.destinationX;
            locCtx.destinationZ = currentTask.behaviorState.destinationZ;

            // Get task description for purpose
            if (currentTask.behaviorName) {
                locCtx.currentTask = currentTask;
            }
        }

        return describeLocation(locCtx).description;
    }

    // Handle a respond task by calling LLM
    async function handleRespondTask(task: Task): Promise<void> {
        if (!task.messageFrom || !task.messageContent) return;

        const locationDesc = getCurrentLocationDescription();
        const context = `
You received a ${task.messageType === 'dm' ? 'direct message' : 'nearby chat message'} from ${task.messageFrom}:
"${task.messageContent}"

${taskManager.getTaskListForLLM()}

You are currently ${locationDesc}.

Respond to this message. You can:
1. Use the 'send_reply' tool to respond
2. Use 'start_behavior' to begin a new behavior
3. Use 'select_task' to switch to a different task

IMPORTANT: When describing locations, use region names (like "Lumbridge", "Falador") not coordinates.

What would you like to do?`;

        try {
            await ollama.sendWithTools(context);
        } catch (err) {
            log(`[BotRunner] LLM error handling respond: ${err}`);
        }
    }

    // Handle a decision task by calling LLM
    async function handleDecisionTask(task: Task): Promise<void> {
        const state = sdk.getState();
        const locationDesc = getCurrentLocationDescription();
        const context = `
A decision is needed: ${task.decisionContext}

${taskManager.getTaskListForLLM()}

${behaviorExecutor.getRegistry().getForLLM()}

You are currently ${locationDesc}.
Health: ${state?.player?.hitpoints}/${state?.player?.maxHitpoints}

IMPORTANT: When describing locations, use region names (like "Lumbridge", "Falador") not coordinates.

What should you do? Use the appropriate tool to take action.`;

        try {
            await ollama.sendWithTools(context);
        } catch (err) {
            log(`[BotRunner] LLM error handling decision: ${err}`);
        }
    }

    // Handle timer completion - notify requester and decide what to do next
    async function handleTimerCompleteTask(task: Task): Promise<void> {
        const locationDesc = getCurrentLocationDescription();
        const decision = taskManager.getPostTimerDecision(task, task.requestedBy);

        // Generate a notification message
        const durationMs = task.timerResults?.durationMs || 0;
        const message = taskManager.generateTimerCompleteMessage(
            task.completedBehavior,
            durationMs,
            task.timerResults,
            task.requestedBy
        );

        const context = `
A timed task has completed!
- Behavior: ${task.completedBehavior || 'unknown'}
- Requested by: ${task.requestedBy || 'self'}
- Results: ${JSON.stringify(task.timerResults || {})}

Suggested message: "${message}"
Suggested action: ${decision.action} - ${decision.message || ''}

You are currently ${locationDesc}.

${taskManager.getTaskListForLLM()}

${behaviorExecutor.getRegistry().getForLLM()}

What would you like to do?
1. Use 'send_reply' to notify ${task.requestedBy || 'nearby players'} about the completion
2. Use 'start_behavior' to begin something new
3. Use 'select_task' to pick from pending tasks

Consider your personality: Are you independent and want to go adventuring? Social and want to hang out? Diligent and want to keep working?

IMPORTANT: When describing locations, use region names not coordinates.`;

        try {
            await ollama.sendWithTools(context);
        } catch (err) {
            log(`[BotRunner] LLM error handling timer complete: ${err}`);
        }
    }

    // Handle task completion - ask LLM what to do next
    async function onTaskComplete(task: Task): Promise<void> {
        const locationDesc = getCurrentLocationDescription();
        const context = `
Task completed: ${task.type}${task.behaviorName ? ` (${task.behaviorName})` : ''}

${taskManager.getTaskListForLLM()}

${behaviorExecutor.getRegistry().getForLLM()}

You are currently ${locationDesc}.

IMPORTANT: When describing locations, use region names (like "Lumbridge", "Falador") not coordinates.

What should you do next? Use 'select_task' to pick from pending tasks, or 'start_behavior' to begin something new.`;

        try {
            await ollama.sendWithTools(context);
        } catch (err) {
            log(`[BotRunner] LLM error selecting next task: ${err}`);
        }
    }

    // Main loop
    async function mainLoop(): Promise<void> {
        // Add initial idle task
        taskManager.addTask({
            type: 'idle',
            priority: TASK_PRIORITIES.IDLE,
            behaviorName: 'idle',
        });

        while (running) {
            try {
                // Get current state
                const state = sdk.getState();
                if (!state) {
                    await new Promise(r => setTimeout(r, 100));
                    continue;
                }

                // 1. Check timers (fires timer_complete interrupts)
                const firedTimers = taskManager.tick((task) => {
                    // Collect results from timed task
                    // STUB: This should gather stats from the behavior
                    return task.behaviorState?.results ?? { summary: 'Task completed' };
                });
                for (const timerTask of firedTimers) {
                    log(`[BotRunner] Timer expired: ${timerTask.completedBehavior} -> created task ${timerTask.id}`);
                    behaviorExecutor.interrupt({
                        type: 'timer_complete',
                        priority: INTERRUPT_PRIORITIES.timer_complete,
                        data: { taskId: timerTask.completedTaskId }
                    });
                }

                // 2. Check for interrupts from game state
                const interrupt = checkForInterrupts(state);
                if (interrupt) {
                    const newTask = taskManager.handleInterrupt(interrupt);
                    if (newTask) {
                        log(`[BotRunner] Interrupt: ${interrupt.type} -> created task ${newTask.id}`);
                        // Also signal to behavior executor
                        behaviorExecutor.interrupt(interrupt);
                    }
                }

                // 3. Get highest priority task
                const task = taskManager.getHighestPriority();
                if (!task) {
                    // No tasks - add idle
                    taskManager.addTask({
                        type: 'behavior',
                        priority: TASK_PRIORITIES.IDLE,
                        behaviorName: 'idle',
                    });
                    await new Promise(r => setTimeout(r, 100));
                    continue;
                }

                // 4. Handle based on task type
                if (task.status === 'pending') {
                    taskManager.startTask(task.id);
                }

                switch (task.type) {
                    case 'respond':
                        await handleRespondTask(task);
                        taskManager.completeTask(task.id);
                        break;

                    case 'decision':
                        await handleDecisionTask(task);
                        taskManager.completeTask(task.id);
                        break;

                    case 'timer_complete':
                        await handleTimerCompleteTask(task);
                        taskManager.completeTask(task.id);
                        break;

                    case 'resume':
                        // Resume the paused task
                        if (task.resumeTaskId) {
                            const paused = taskManager.resumeTask(task.resumeTaskId);
                            if (paused) {
                                log(`[BotRunner] Resumed task ${paused.id} (${paused.behaviorName})`);
                            }
                        }
                        taskManager.completeTask(task.id);
                        break;

                    case 'behavior':
                    case 'idle':
                        // Execute the behavior
                        const completed = await behaviorExecutor.execute(task);
                        if (completed) {
                            taskManager.completeTask(task.id);
                            await onTaskComplete(task);
                        }
                        break;
                }

                // Small delay to prevent tight loop
                await new Promise(r => setTimeout(r, 50));

            } catch (err) {
                log(`[BotRunner] Main loop error: ${err}`);
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    // Return the runner interface
    const runner: BotRunner = {
        async start() {
            if (running) return;

            log(`[BotRunner] Connecting to ${config.username}...`);
            await sdk.connect();
            log(`[BotRunner] Connected`);

            running = true;
            loopPromise = mainLoop();
        },

        async stop() {
            running = false;
            if (loopPromise) {
                await loopPromise;
            }
            itemMemory.stopAutoSave();  // Final save and stop
            locationMemory.save();      // Final save for locations
            await sdk.disconnect();
            log(`[BotRunner] Stopped`);
        },

        getTaskManager() { return taskManager; },
        getBehaviorExecutor() { return behaviorExecutor; },
        getSDK() { return sdk; },
        getBot() { return bot; },
        getOllama() { return ollama; },
        getItemMemory() { return itemMemory; },
        getLocationMemory() { return locationMemory; },

        setActivity(activity: ActivityType) {
            if (activity !== currentActivity) {
                currentActivity = activity;
                activityStartTime = Date.now();
            }
        },
        getActivity() { return currentActivity; },

        registerBehavior(def: BehaviorDefinition) {
            behaviorExecutor.registerBehavior(def);
        }
    };

    return runner;
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildSystemPrompt(
    config: BotRunnerConfig,
    taskManager: TaskManager,
    executor: BehaviorExecutor
): string {
    return `You are ${config.botName}, a bot playing a game.

${config.personality}

You are controlled by a task system. When asked to make decisions, use the available tools:
- select_task: Choose a task from your task list to work on
- start_behavior: Begin a new behavior
- start_timed_behavior: Begin a behavior that runs for a set duration (e.g., "mine for 10 minutes")
- send_reply: Send a chat message in the game
- describe_location: Convert coordinates to natural location names
- get_timer_status: Check your active timers
- cancel_timer: Cancel a running timer

TIMED TASKS:
When someone asks you to do something "for X minutes" (e.g., "can you mine silver for 10 minutes?"):
1. Use start_timed_behavior with the behavior name and duration
2. Include who requested it so you can notify them when done
3. When the timer expires, you'll be prompted to notify them and decide what to do next

ITEM KNOWLEDGE:
You have memory of items you've encountered:
- When someone asks for an item, use 'lookup_item' to check if you know where to find it
- When you see items on the ground, use 'learn_ground_spawn' to remember the location
- When you loot items from monsters, use 'learn_monster_drop' to remember the drop
- When you craft something, use 'learn_crafting_recipe' to remember the recipe
- When someone tells you about an item source, use 'someone_told_me' to remember it
- If you go to a location and the item isn't there, use 'report_spawn_missing' - it might have been player-dropped

HANDLING ITEM REQUESTS:
When someone asks "can you get me X?":
1. Use 'lookup_item' to check what you know
2. If you know a source, tell them and go get it (use 'start_item_search' to track)
3. If you don't know, say so - they or others nearby might tell you where to find it
4. If a location doesn't work out, report it and try alternatives or ask for help

LOCATION KNOWLEDGE:
You only know locations you've visited or been told about:
- Use 'check_location_knowledge' to see if you know how to get somewhere
- If you don't know a place, use 'ask_for_directions' to mark it as unknown
- When someone gives you directions, use 'learned_directions' to remember them
- If directions were wrong, use 'directions_were_wrong' to mark them bad
- When you arrive somewhere new, use 'record_visit' to remember it

ASKING FOR DIRECTIONS:
When you need to go somewhere you don't know:
1. Wander around doing activities (mining, woodcutting, etc.)
2. When someone does the same activity nearby, use 'get_conversation_topics' for chat options
3. One option may be asking for directions - it's natural to ask while doing shared activities
4. If they know, they'll tell you. If not, 80% say "I dunno", 20% might give wrong info
5. If directions don't work, mark them wrong and keep asking

GIVING DIRECTIONS:
When someone asks YOU for directions:
1. Use 'give_directions' to check what you know
2. It returns a suggested response based on your knowledge
3. If you don't know, there's a 20% chance you'll give plausible-sounding wrong info
4. If you've been there, you can confidently give directions

SOCIAL INTERACTIONS:
- Chat happens naturally during shared activities (downtime while doing the same thing)
- Use 'get_conversation_topics' to get relevant things to talk about
- Topics include: asking for directions, item info, activity-specific chat, greetings

IMPORTANT RULES FOR LOCATIONS:
- NEVER respond with raw coordinates like "(3200, 3218)"
- ALWAYS use region names like "Lumbridge", "Falador", "Barbarian Village"
- When describing where you're going, include the purpose: "running north toward Barbarian Village to buy an axe"
- You can only know the exact location of things you can see. If someone is in a different region, you only know their general area.
- Use "walking" or "running" not speeds like "5mph"

Example location responses:
- "I'm in Lumbridge, near the castle"
- "I'm walking south toward Al Kharid to visit the furnace"
- "I'm in Falador, at the west bank"

You don't need to plan everything - just respond to the immediate situation and use tools to take action.

Remember: Be helpful to other players, but you can refuse requests that seem harmful or disruptive.`;
}

/**
 * Get tool definitions for task management.
 */
function getTaskTools(taskManager: TaskManager, executor: BehaviorExecutor): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: 'select_task',
                description: 'Select a task from the pending task list to work on next',
                parameters: {
                    type: 'object',
                    properties: {
                        task_id: { type: 'string', description: 'The ID of the task to select' }
                    },
                    required: ['task_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'start_behavior',
                description: 'Start a new behavior. Available: ' + executor.getRegistry().getNames().join(', '),
                parameters: {
                    type: 'object',
                    properties: {
                        behavior: { type: 'string', description: 'The name of the behavior to start' },
                        priority: { type: 'number', description: 'Priority (10=low, 50=normal, 80=high). Optional.' }
                    },
                    required: ['behavior']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'send_reply',
                description: 'Send a chat message in the game',
                parameters: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', description: 'The message to send' }
                    },
                    required: ['message']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'set_task_priority',
                description: 'Change the priority of a task',
                parameters: {
                    type: 'object',
                    properties: {
                        task_id: { type: 'string', description: 'The ID of the task' },
                        priority: { type: 'number', description: 'New priority (10=low, 50=normal, 80=high)' }
                    },
                    required: ['task_id', 'priority']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'start_timed_behavior',
                description: 'Start a behavior that runs for a specific duration. Use when asked to do something "for X minutes".',
                parameters: {
                    type: 'object',
                    properties: {
                        behavior: { type: 'string', description: 'The name of the behavior to start' },
                        duration_minutes: { type: 'number', description: 'How long to run the behavior (in minutes)' },
                        requested_by: { type: 'string', description: 'Who asked for this (for notification when done)' },
                        priority: { type: 'number', description: 'Priority (10=low, 50=normal, 80=high). Optional.' }
                    },
                    required: ['behavior', 'duration_minutes']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'cancel_timer',
                description: 'Cancel a running timer on a task',
                parameters: {
                    type: 'object',
                    properties: {
                        task_id: { type: 'string', description: 'The ID of the task with the timer' }
                    },
                    required: ['task_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_timer_status',
                description: 'Get the status of all active timers',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }
        }
    ];
}

/**
 * Get tool definitions for item memory.
 */
function getItemMemoryTools(memory: ItemMemory): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: 'lookup_item',
                description: 'Look up what you know about an item - where to find it, who drops it, how to craft it',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The name of the item to look up' }
                    },
                    required: ['item_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'learn_ground_spawn',
                description: 'Remember that you saw an item on the ground at a location (for respawning items)',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The name of the item' },
                        region_name: { type: 'string', description: 'The region/area name (e.g., "Barbarian Village")' },
                        x: { type: 'number', description: 'X coordinate' },
                        z: { type: 'number', description: 'Z coordinate' }
                    },
                    required: ['item_name', 'region_name', 'x', 'z']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'learn_monster_drop',
                description: 'Remember that a monster dropped an item when you looted it',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The name of the item' },
                        monster_name: { type: 'string', description: 'The monster that dropped it' },
                        region_name: { type: 'string', description: 'Where you killed it (optional)' }
                    },
                    required: ['item_name', 'monster_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'learn_crafting_recipe',
                description: 'Remember how to craft an item after successfully making it',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The item you crafted' },
                        ingredients: { type: 'string', description: 'Comma-separated list of ingredients (e.g., "1 bronze bar")' },
                        skill: { type: 'string', description: 'The skill used (e.g., "smithing")' },
                        location: { type: 'string', description: 'Where to craft it (e.g., "any anvil")' }
                    },
                    required: ['item_name', 'ingredients', 'skill']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'someone_told_me',
                description: 'Remember item info that another player told you',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The item name' },
                        info_type: { type: 'string', description: 'Type: "ground_spawn", "monster_drop", or "recipe"' },
                        told_by: { type: 'string', description: 'Who told you this' },
                        details: { type: 'string', description: 'The details (location/monster/recipe info)' }
                    },
                    required: ['item_name', 'info_type', 'told_by', 'details']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'report_spawn_missing',
                description: 'Report that you went to a ground spawn location but the item was not there',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The item you were looking for' },
                        x: { type: 'number', description: 'X coordinate' },
                        z: { type: 'number', description: 'Z coordinate' },
                        waited_minutes: { type: 'number', description: 'How long you waited for respawn' }
                    },
                    required: ['item_name', 'x', 'z', 'waited_minutes']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'start_item_search',
                description: 'Start tracking a search for an item requested by someone',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The item to search for' },
                        requested_by: { type: 'string', description: 'Who asked for it' },
                        quantity: { type: 'number', description: 'How many they need (default 1)' }
                    },
                    required: ['item_name', 'requested_by']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'end_item_search',
                description: 'Stop tracking a search (found it or gave up)',
                parameters: {
                    type: 'object',
                    properties: {
                        item_name: { type: 'string', description: 'The item you were searching for' }
                    },
                    required: ['item_name']
                }
            }
        }
    ];
}

/**
 * Get tool definitions for location memory and directions.
 */
function getLocationMemoryTools(memory: LocationMemory): ToolDefinition[] {
    return [
        {
            type: 'function',
            function: {
                name: 'check_location_knowledge',
                description: 'Check if you know how to get to a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location_name: { type: 'string', description: 'The location to check' }
                    },
                    required: ['location_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'record_visit',
                description: 'Record that you visited a location (auto-called when arriving somewhere)',
                parameters: {
                    type: 'object',
                    properties: {
                        location_name: { type: 'string', description: 'Name of the place' },
                        x: { type: 'number', description: 'X coordinate' },
                        z: { type: 'number', description: 'Z coordinate' },
                        features: { type: 'string', description: 'Comma-separated features (e.g., "bank, anvil")' }
                    },
                    required: ['location_name', 'x', 'z']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'ask_for_directions',
                description: 'Mark that you need directions to a place (triggers asking nearby players)',
                parameters: {
                    type: 'object',
                    properties: {
                        destination: { type: 'string', description: 'Where you want to go' },
                        reason: { type: 'string', description: 'Why you want to go there' },
                        requested_by: { type: 'string', description: 'Who asked you to go (if applicable)' }
                    },
                    required: ['destination', 'reason']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'give_directions',
                description: 'Give directions to someone asking (checks your knowledge first)',
                parameters: {
                    type: 'object',
                    properties: {
                        destination: { type: 'string', description: 'The place they\'re asking about' },
                        asking_player: { type: 'string', description: 'Who is asking' }
                    },
                    required: ['destination', 'asking_player']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'learned_directions',
                description: 'Record directions someone gave you',
                parameters: {
                    type: 'object',
                    properties: {
                        destination: { type: 'string', description: 'The place' },
                        directions: { type: 'string', description: 'The directions they gave' },
                        told_by: { type: 'string', description: 'Who told you' }
                    },
                    required: ['destination', 'directions', 'told_by']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'directions_were_wrong',
                description: 'Report that directions you received were incorrect',
                parameters: {
                    type: 'object',
                    properties: {
                        destination: { type: 'string', description: 'Where you were trying to go' },
                        given_by: { type: 'string', description: 'Who gave the wrong directions' }
                    },
                    required: ['destination', 'given_by']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_conversation_topics',
                description: 'Get suggested conversation topics for chatting with nearby players',
                parameters: {
                    type: 'object',
                    properties: {
                        nearby_player: { type: 'string', description: 'Name of nearby player' },
                        their_activity: { type: 'string', description: 'What they\'re doing (if known)' }
                    },
                    required: ['nearby_player']
                }
            }
        }
    ];
}

/**
 * Create a tool executor that handles task tools, memory tools, and external tools.
 */
function createTaskToolExecutor(
    taskManager: TaskManager,
    executor: BehaviorExecutor,
    itemMemory: ItemMemory,
    locationMemory: LocationMemory,
    currentActivityGetter: () => { activity: ActivityType; startTime: number },
    externalExecutor: (name: string, args: Record<string, any>) => Promise<{ success: boolean; data?: any; error?: string }>
) {
    return async (name: string, args: Record<string, any>) => {
        switch (name) {
            case 'select_task': {
                const task = taskManager.getTask(args.task_id);
                if (!task) {
                    return { success: false, error: `Task not found: ${args.task_id}` };
                }
                // Boost priority to make it run next
                taskManager.setPriority(args.task_id, TASK_PRIORITIES.HIGH);
                return { success: true, data: { message: `Selected task ${args.task_id}` } };
            }

            case 'start_behavior': {
                const behavior = executor.getRegistry().get(args.behavior);
                if (!behavior) {
                    return { success: false, error: `Unknown behavior: ${args.behavior}` };
                }
                const task = taskManager.addTask({
                    type: 'behavior',
                    priority: args.priority ?? TASK_PRIORITIES.NORMAL,
                    behaviorName: args.behavior,
                });
                return { success: true, data: { message: `Started behavior ${args.behavior}`, taskId: task.id } };
            }

            case 'send_reply': {
                // This needs SDK access - for now just return success
                // The actual sending will be handled by game-integration
                return { success: true, data: { message: args.message, note: 'Message queued for sending' } };
            }

            case 'set_task_priority': {
                taskManager.setPriority(args.task_id, args.priority);
                return { success: true, data: { message: `Set priority of ${args.task_id} to ${args.priority}` } };
            }

            case 'start_timed_behavior': {
                const behavior = executor.getRegistry().get(args.behavior);
                if (!behavior) {
                    return { success: false, error: `Unknown behavior: ${args.behavior}` };
                }
                const task = taskManager.addTask({
                    type: 'behavior',
                    priority: args.priority ?? TASK_PRIORITIES.NORMAL,
                    behaviorName: args.behavior,
                    requestedBy: args.requested_by,
                });
                // Add the timer
                const durationMs = args.duration_minutes * 60 * 1000;
                const timer = taskManager.addTimer(
                    task.id,
                    durationMs,
                    args.requested_by,
                    `${args.behavior} timer complete after ${args.duration_minutes} minutes`
                );
                return {
                    success: true,
                    data: {
                        message: `Started ${args.behavior} with ${args.duration_minutes} minute timer`,
                        taskId: task.id,
                        timerExpiresAt: timer ? new Date(timer.startedAt + timer.durationMs).toISOString() : null
                    }
                };
            }

            case 'cancel_timer': {
                const cancelled = taskManager.cancelTimer(args.task_id);
                if (!cancelled) {
                    return { success: false, error: `No timer found on task ${args.task_id}` };
                }
                return { success: true, data: { message: `Cancelled timer on ${args.task_id}` } };
            }

            case 'get_timer_status': {
                const status = taskManager.getTimerStatusForLLM();
                return {
                    success: true,
                    data: {
                        status: status || 'No active timers',
                        timers: taskManager.getActiveTimers().map(t => ({
                            taskId: t.task.id,
                            behavior: t.task.behaviorName,
                            remainingMs: t.remaining,
                            remainingMinutes: Math.round(t.remaining / 60000 * 10) / 10,
                            requestedBy: t.requestedBy
                        }))
                    }
                };
            }

            // ========== ITEM MEMORY TOOLS ==========

            case 'lookup_item': {
                const info = itemMemory.formatForLLM(args.item_name);
                const sources = itemMemory.whereToFind(args.item_name);
                return {
                    success: true,
                    data: {
                        info,
                        hasAnySource: sources.hasAnySource,
                        groundSpawnCount: sources.groundSpawns.length,
                        monsterDropCount: sources.monsterDrops.length,
                        canCraft: sources.canCraft !== null,
                    }
                };
            }

            case 'learn_ground_spawn': {
                itemMemory.sawItemOnGround(
                    args.item_name,
                    { x: args.x, z: args.z },
                    args.region_name
                );
                return {
                    success: true,
                    data: { message: `Remembered: ${args.item_name} spawns at ${args.region_name}` }
                };
            }

            case 'learn_monster_drop': {
                itemMemory.lootedFromMonster(
                    args.item_name,
                    args.monster_name,
                    args.region_name
                );
                return {
                    success: true,
                    data: { message: `Remembered: ${args.monster_name} drops ${args.item_name}` }
                };
            }

            case 'learn_crafting_recipe': {
                // Parse ingredients from comma-separated string
                const ingredients = args.ingredients.split(',').map((s: string) => {
                    const match = s.trim().match(/^(\d+)?\s*(.+)$/);
                    if (match) {
                        return { item: match[2].trim(), quantity: parseInt(match[1] || '1', 10) };
                    }
                    return { item: s.trim(), quantity: 1 };
                });
                itemMemory.craftedItem(args.item_name, ingredients, args.skill, {
                    location: args.location,
                });
                return {
                    success: true,
                    data: { message: `Learned how to craft ${args.item_name} with ${args.skill}` }
                };
            }

            case 'someone_told_me': {
                const { item_name, info_type, told_by, details } = args;
                if (info_type === 'ground_spawn') {
                    // Parse "at X, Z in RegionName" or just "in RegionName"
                    const coordMatch = details.match(/at\s*(\d+)\s*,\s*(\d+)/i);
                    const regionMatch = details.match(/in\s+(.+)/i);
                    if (coordMatch) {
                        itemMemory.toldAboutGroundSpawn(
                            item_name,
                            { x: parseInt(coordMatch[1]), z: parseInt(coordMatch[2]) },
                            regionMatch?.[1] || 'unknown',
                            told_by
                        );
                    }
                } else if (info_type === 'monster_drop') {
                    itemMemory.toldAboutMonsterDrop(item_name, details, told_by);
                } else if (info_type === 'recipe') {
                    // Parse "skill: ingredients"
                    const recipeMatch = details.match(/(\w+):\s*(.+)/);
                    if (recipeMatch) {
                        const skill = recipeMatch[1];
                        const ingredients = recipeMatch[2].split(',').map((s: string) => {
                            const match = s.trim().match(/^(\d+)?\s*(.+)$/);
                            return { item: match?.[2]?.trim() || s.trim(), quantity: parseInt(match?.[1] || '1', 10) };
                        });
                        itemMemory.toldAboutRecipe(item_name, ingredients, skill, told_by);
                    }
                }
                return {
                    success: true,
                    data: { message: `Noted info about ${item_name} from ${told_by}` }
                };
            }

            case 'report_spawn_missing': {
                const waitedMs = (args.waited_minutes || 0) * 60 * 1000;
                const result = itemMemory.groundSpawnNotFound(
                    args.item_name,
                    { x: args.x, z: args.z },
                    waitedMs
                );
                let message = result.removed
                    ? `Removed unreliable spawn location for ${args.item_name}`
                    : `Noted: ${args.item_name} wasn't at this location`;
                if (result.remainingSources > 0) {
                    message += `. Still know ${result.remainingSources} other location(s).`;
                } else {
                    message += `. Don't know any other locations.`;
                }
                return {
                    success: true,
                    data: { message, removed: result.removed, remainingSources: result.remainingSources }
                };
            }

            case 'start_item_search': {
                itemMemory.startSearch(args.item_name, args.requested_by, args.quantity ?? 1);
                const sources = itemMemory.whereToFind(args.item_name);
                return {
                    success: true,
                    data: {
                        message: `Started search for ${args.item_name} for ${args.requested_by}`,
                        knownSources: sources.hasAnySource,
                        info: itemMemory.formatForLLM(args.item_name)
                    }
                };
            }

            case 'end_item_search': {
                itemMemory.endSearch(args.item_name);
                return {
                    success: true,
                    data: { message: `Ended search for ${args.item_name}` }
                };
            }

            // ========== LOCATION MEMORY TOOLS ==========

            case 'check_location_knowledge': {
                const knowledge = locationMemory.knowsLocation(args.location_name);
                const directions = locationMemory.getDirectionsTo(args.location_name);
                return {
                    success: true,
                    data: {
                        ...knowledge,
                        directions: directions.hasDirections ? {
                            text: directions.directions,
                            from: directions.fromLocation,
                            givenBy: directions.givenBy,
                            verified: directions.verified,
                            hasCoordinates: !!directions.coordinates,
                        } : null,
                    }
                };
            }

            case 'record_visit': {
                const features = args.features?.split(',').map((f: string) => f.trim());
                locationMemory.visitLocation(
                    args.location_name,
                    { x: args.x, z: args.z },
                    features
                );
                locationMemory.save();
                return {
                    success: true,
                    data: { message: `Recorded visit to ${args.location_name}` }
                };
            }

            case 'ask_for_directions': {
                locationMemory.addUnknownDestination(
                    args.destination,
                    args.reason,
                    args.requested_by
                );
                const knowledge = locationMemory.knowsLocation(args.destination);
                return {
                    success: true,
                    data: {
                        message: `Looking for ${args.destination}`,
                        alreadyKnown: knowledge.confidence !== 'none',
                        confidence: knowledge.confidence,
                    }
                };
            }

            case 'give_directions': {
                const response = locationMemory.canGiveDirections(args.destination);
                return {
                    success: true,
                    data: {
                        knows: response.knows,
                        confidence: response.confidence,
                        suggestedResponse: response.response,
                        isWrongInfo: response.shouldGiveWrongInfo || false,
                    }
                };
            }

            case 'learned_directions': {
                const currentLoc = locationMemory.getCurrentLocation();
                locationMemory.toldAboutLocation(args.destination, args.told_by, {
                    directions: {
                        from: currentLoc?.name || 'here',
                        directions: args.directions,
                    }
                });
                locationMemory.save();
                return {
                    success: true,
                    data: { message: `Learned directions to ${args.destination} from ${args.told_by}` }
                };
            }

            case 'directions_were_wrong': {
                const currentLoc = locationMemory.getCurrentLocation();
                locationMemory.markDirectionsWrong(
                    args.destination,
                    currentLoc?.name || 'here',
                    args.given_by
                );
                locationMemory.save();
                return {
                    success: true,
                    data: { message: `Marked directions from ${args.given_by} to ${args.destination} as wrong` }
                };
            }

            case 'get_conversation_topics': {
                const { activity, startTime } = currentActivityGetter();
                const conversationCtx: ConversationContext = {
                    currentActivity: activity,
                    activityDurationMs: Date.now() - startTime,
                    nearbyPlayers: [{
                        name: args.nearby_player,
                        activity: args.their_activity as ActivityType | undefined,
                        distance: 5,  // Assume close enough to talk
                    }],
                    locationMemory,
                    itemMemory,
                    currentRegion: locationMemory.getCurrentLocation()?.name || 'unknown',
                };

                const topics = generateConversationTopics(conversationCtx);
                const shouldChat = shouldStartConversation(conversationCtx);

                return {
                    success: true,
                    data: {
                        shouldStartConversation: shouldChat.should,
                        reason: shouldChat.reason,
                        topics: topics.map(t => ({
                            type: t.type,
                            opener: t.opener,
                            context: t.context,
                            priority: t.priority,
                        })),
                    }
                };
            }

            default:
                // Delegate to external tool executor
                return externalExecutor(name, args);
        }
    };
}

// Export for convenience
export { TaskManager, Task, BehaviorExecutor, BehaviorDefinition, BehaviorContext, ItemMemory, LocationMemory };
