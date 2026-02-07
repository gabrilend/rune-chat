#!/usr/bin/env bun
// Standalone conversation example - runs without the game
// Usage: bun run bot-chat/examples/standalone-conversation.ts

import { BotConversation, quickChat } from '../index';

console.log('=== Bot-to-Bot Conversation Demo ===\n');

// Method 1: Quick chat helper (simplest)
// Uses default Ollama config: 192.168.0.61:16180 with natsumura-storytelling-rp model
console.log('--- Quick Chat ---');
const quickTranscript = await quickChat(
    { name: 'Alice', personality: 'A cheerful optimist who always sees the bright side.' },
    { name: 'Bob', personality: 'A practical realist who likes to keep things grounded.' },
    "I think today is going to be amazing! What do you think?",
    4  // 4 turns
);

console.log('\n--- Full Transcript ---');
for (const turn of quickTranscript) {
    console.log(`[${turn.bot}] ${turn.message}\n`);
}

// Method 2: Manual conversation control (more flexible)
console.log('\n--- Manual Conversation ---');

const conversation = new BotConversation({
    // Uses default Ollama config: 192.168.0.61:16180 with natsumura-storytelling-rp model
    onToken: (bot, token) => {
        process.stdout.write(token);  // Stream tokens as they arrive
    },
    onTurnComplete: (bot, message) => {
        console.log();  // Newline after streaming completes
    },
});

// Add bots
conversation.addBot({
    name: 'Chef',
    personality: 'A passionate Italian chef who loves talking about food and cooking.',
});

conversation.addBot({
    name: 'Critic',
    personality: 'A snooty food critic who has very high standards.',
});

// Manual back-and-forth
console.log('\n[Chef starting...]');
const response1 = await conversation.say('Chef', "I've prepared my signature dish: spaghetti carbonara with a twist!", 'Critic');
console.log(`[Critic] ${response1}`);

const response2 = await conversation.say('Critic', response1, 'Chef');
console.log(`[Chef] ${response2}`);

console.log('\n=== Demo Complete ===');
