# Bot Chat - AI Communication for RS-SDK Bots

This module enables bots to communicate with each other and with players using AI (via Ollama).

## Quick Start

### 1. Basic Chat Context

```typescript
import { createContext } from '../bot-chat';

// Uses default config (192.168.0.61:16180, natsumura-storytelling-rp)
const ctx = createContext();

// Send a message and get a response
const response = await ctx.send('Hello, how are you?');
console.log(response);

// Streaming with callbacks
await ctx.send('Tell me a story', {
    onToken: (token) => process.stdout.write(token),
    onDone: (full) => console.log('\n---Done---'),
});
```

### 2. Game Chat Integration

```typescript
import { runScript } from '../../sdk/runner';
import { createGameChat } from '../../bot-chat';

await runScript(async (ctx) => {
    const { bot, sdk, log } = ctx;

    // Create chat that responds to in-game messages
    const chat = createGameChat(sdk, bot, {
        botName: 'MyBot',
        personality: 'A friendly adventurer',
        shouldRespond: (sender, msg) => msg.includes('hello'),
    });

    chat.start();  // Start listening

    // Manually say something
    await chat.say('Hey everyone!');
});
```

### 3. Bot-to-Bot Conversations

```typescript
import { BotConversation } from '../../bot-chat';

const conversation = new BotConversation({
    maxTurns: 6,
    onMessage: (bot, msg) => console.log(`[${bot}] ${msg}`),
});

conversation.addBot({
    name: 'Warrior',
    personality: 'Loves combat and glory',
});

conversation.addBot({
    name: 'Mage',
    personality: 'Prefers magic and wisdom',
});

// Run automated conversation
await conversation.runConversation(
    'Warrior',
    "Let's go fight that dragon!"
);
```

## API Reference

### OllamaContext

Low-level chat context for a single conversation.

- `send(message, callbacks?)` - Send message, returns response
- `sendBlocking(message)` - Send without streaming
- `abort()` - Cancel current request
- `getHistory()` - Get message history
- `clearHistory()` - Reset conversation
- `addMessage(role, content)` - Inject context

### GameChatIntegration

Bridges AI chat with in-game chat system.

- `start()` - Begin listening for messages
- `stop()` - Stop listening
- `say(message)` - Say something in-game
- `think(prompt)` - Generate response without speaking
- `respondToMessage(sender, message)` - Manual response trigger

### BotConversation

Manages multi-bot conversations.

- `addBot(identity)` - Add a bot with name/personality
- `say(from, message, to?)` - Have bot speak to another
- `respond(botName)` - Have bot respond to recent messages
- `runConversation(starter, initialMsg, order?)` - Run automated chat
- `stop()` - Stop conversation
- `getTranscript()` - Get full conversation history

## Example Bots

- `bots/chatty/` - Single bot that responds to players
- `bots/duo-chat/` - Two bots having a conversation

## Configuration

Default Ollama settings:
- **Host:** `192.168.0.61`
- **Port:** `16180`
- **Model:** `Tohur/natsumura-storytelling-rp-llama-3.1:latest`

Override defaults by passing config:
```typescript
const ctx = createContext({
    host: 'localhost',
    port: 11434,
    model: 'llama3.2',
});
```

## Requirements

- Ollama server accessible at the configured host/port
- The storytelling-rp model (or your chosen model) installed
