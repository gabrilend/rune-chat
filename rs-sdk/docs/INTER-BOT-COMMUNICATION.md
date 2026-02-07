# Inter-Bot Communication

This guide explains how RS-SDK bots can communicate with each other and share information through the new task-based architecture.

## Overview

The new architecture separates:
- **Accounts** (`rs-sdk/accounts/`) - Bot credentials only
- **Behaviors** (`rs-sdk/behaviors/`) - Reusable action modules
- **Task System** (`rs-sdk/bot-core/`) - Priority-based execution with interrupts

Bots communicate in three ways:

1. **Gateway Queries** - Query bot status via HTTP tools
2. **AI Tool Calling** - LLM-driven information gathering and task management
3. **In-Game Chat** - Direct messages through the game client

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                    Bot Runner (bot-core)                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Task Manager                                                 │  │
│  │  - Priority queue of tasks                                    │  │
│  │  - Interrupt handling (DMs, combat)                          │  │
│  │  - Pause/resume behaviors                                     │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
│                               │                                     │
│  ┌────────────────────────────▼─────────────────────────────────┐  │
│  │  Behavior Executor                                            │  │
│  │  - Runs behavior modules from behaviors/                      │  │
│  │  - Checks for interrupts                                      │  │
│  │  - Saves state for resume                                     │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
│                               │                                     │
│  ┌────────────────────────────▼─────────────────────────────────┐  │
│  │  OllamaContext.sendWithTools()                                │  │
│  │  - Consulted for decisions (not driving)                      │  │
│  │  - Uses tools for information and actions                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Tools (rs-sdk/tools/)                         │
│  External:                                                         │
│    query_bot_status, query_all_bots, get_bot_location             │
│    get_nearby_players, get_distance_between                        │
│    list_available_behaviors                                        │
│                                                                     │
│  Built-in (task management):                                       │
│    select_task, start_behavior, send_reply, set_task_priority     │
│                                │                                    │
│                                ▼                                    │
│   Gateway HTTP API: GET /status, GET /status/:username            │
└────────────────────────────────────────────────────────────────────┘
```

## Key Principle: Bot Drives LLM

The task system drives execution, not the LLM:

```typescript
// ❌ Old way: LLM drives everything
while (true) {
    const action = await llm.decide("What should I do?");
    await execute(action);  // LLM in control
}

// ✅ New way: Task system drives, LLM advises
while (running) {
    // 1. Check for interrupts (DM received? Combat started?)
    const interrupt = checkInterrupts();
    if (interrupt) taskManager.handleInterrupt(interrupt);

    // 2. Get highest priority task
    const task = taskManager.getHighestPriority();

    // 3. Execute task (may consult LLM for decisions)
    if (task.type === 'respond') {
        // LLM generates response
        await handleRespondTask(task);
    } else if (task.type === 'behavior') {
        // Behavior runs to completion
        await behaviorExecutor.execute(task);
    }

    // 4. On completion, LLM selects next task
    if (task.completed) {
        await llm.sendWithTools("Task completed. What next?");
        // LLM uses select_task or start_behavior tools
    }
}
```

## Available Tools

### External Tools (query information)

#### query_bot_status
Query a specific bot's status from the gateway.

```bash
echo '{"username":"idle"}' | ./rs-sdk/tools/query_bot_status
```

#### query_all_bots
List all bots known to the gateway.

```bash
echo '{}' | ./rs-sdk/tools/query_all_bots
```

#### get_bot_location
Get precise coordinates for a bot.

```bash
echo '{"username":"chatty"}' | ./rs-sdk/tools/get_bot_location
```

#### get_distance_between
Calculate distance between two bots or a bot and a location.

```bash
echo '{"bot1":"idle","bot2":"chatty"}' | ./rs-sdk/tools/get_distance_between
# or with coordinates
echo '{"bot1":"idle","x":3200,"z":3200}' | ./rs-sdk/tools/get_distance_between
```

#### get_nearby_players
Get players near a specific bot.

```bash
echo '{"username":"idle"}' | ./rs-sdk/tools/get_nearby_players
```

#### list_available_behaviors
List all behaviors available to bots.

```bash
echo '{}' | ./rs-sdk/tools/list_available_behaviors
```

### Built-in Tools (task management)

These are handled internally by the bot-runner, not as external executables:

#### select_task
Select a task from the pending task list to work on.

```json
{"task_id": "task_123_0"}
```

#### start_behavior
Start a new behavior as a task.

```json
{"behavior": "follower", "priority": 50}
```

#### send_reply
Send a chat message in the game.

```json
{"message": "Hello there!"}
```

#### set_task_priority
Change a task's priority.

```json
{"task_id": "task_123_0", "priority": 80}
```

## Interrupt System

The task manager handles interrupts that can pause running behaviors:

| Interrupt Type | Priority | Trigger |
|----------------|----------|---------|
| `low_health`   | 100      | Health below 30% |
| `combat`       | 90       | Being attacked |
| `dm`           | 80       | Direct message received |
| `player_interaction` | 60 | Player trades/challenges |
| `nearby_chat`  | 30       | Public chat (optional) |

When interrupted:
1. Current behavior is paused with state saved
2. A "resume" task is created at the paused task's priority
3. A response task is created for the interrupt
4. LLM is consulted for how to handle the interrupt

## Using the New Architecture

### Creating a Bot Runner

```typescript
import { createBotRunner } from '../bot-core';
import { allBehaviors } from '../behaviors';

const runner = await createBotRunner({
    username: 'mybot',
    password: 'pass123',
    gatewayUrl: 'ws://localhost:8245',
    botName: 'MyBot',
    personality: 'A helpful adventurer who loves making friends.',
    toolsDir: './rs-sdk/tools',
});

// Register behaviors
for (const behavior of allBehaviors) {
    runner.registerBehavior(behavior);
}

await runner.start();
```

### Creating Custom Behaviors

```typescript
import type { BehaviorDefinition, BehaviorContext } from '../bot-core';

export const myBehavior: BehaviorDefinition = {
    name: 'my_behavior',
    description: 'Does something cool',
    fn: async (ctx: BehaviorContext) => {
        const state = ctx.getResumeState() ?? { step: 0 };

        while (state.step < 10) {
            // Check for interrupts
            const interrupt = ctx.checkInterrupt();
            if (interrupt) {
                ctx.pauseWithState(state);
                return;
            }

            // Do work
            ctx.log(`Step ${state.step}`);
            await ctx.sdk.sendWalk(state.step * 10, state.step * 10);

            // Wait with interrupt checking
            const continued = await ctx.waitTicks(5);
            if (!continued) {
                ctx.pauseWithState(state);
                return;
            }

            state.step++;
        }

        ctx.log('Behavior complete!');
    }
};
```

## Communication Patterns

### Multi-Bot Coordination

```typescript
// Leader bot queries team status
const ctx = runner.getOllama();

const response = await ctx.sendWithTools(`
    Check where all our team members are.
    If any are far from the meeting point at (3200, 3200),
    tell them to come over.
`);

// AI uses:
// 1. query_all_bots to find online bots
// 2. get_distance_between to check distances
// 3. send_reply to issue commands
```

### Responding to Messages

Messages create interrupt tasks automatically:

```typescript
// When a DM is received:
// 1. Interrupt is detected from game state
// 2. Task manager creates 'respond' task with priority 80
// 3. Current behavior is paused
// 4. handleRespondTask() is called
// 5. LLM generates response using send_reply tool
// 6. Task completes, resume task runs to continue previous behavior
```

### Behavior Chaining

```typescript
// LLM can chain behaviors via tool calls
const response = await ctx.sendWithTools(`
    I need to:
    1. Go to the bank (follower behavior with bank as target)
    2. Deposit items
    3. Return to the meeting spot

    Start the first step.
`);

// AI uses start_behavior with appropriate parameters
```

## Gateway Status API

### GET /status/:username

```json
{
  "status": "active" | "stale" | "dead",
  "inGame": boolean,
  "stateAge": number | null,
  "controllers": ["sdk-client-id"],
  "observers": ["sdk-client-id"],
  "player": {
    "name": "display_name",
    "worldX": number,
    "worldZ": number,
    "hitpoints": number,
    "maxHitpoints": number
  } | null
}
```

### GET /status

```json
{
  "status": "running",
  "bots": {
    "username": {
      "status": "active" | "stale" | "dead",
      "inGame": boolean,
      "player": "name" | null
    }
  }
}
```

## Best Practices

1. **Let the bot drive** - Use LLM for decisions, not continuous control
2. **Handle interrupts gracefully** - Save state before pausing
3. **Use appropriate priorities** - Critical tasks should have higher numbers
4. **Cache gateway queries** - Don't query too frequently
5. **Test behaviors in isolation** - Each behavior should work standalone
6. **Log state changes** - Makes debugging easier
