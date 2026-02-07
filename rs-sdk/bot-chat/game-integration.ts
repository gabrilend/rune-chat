// game-integration.ts - Bridge between AI chat and the RS-SDK game loop
// Allows bots to speak in-game and respond to other players/bots

import type { BotSDK } from '../sdk/index';
import type { BotActions } from '../sdk/actions';
import { OllamaContext, OllamaConfig } from './ollama-client';

export interface GameChatConfig {
    ollama?: OllamaConfig;
    botName: string;
    personality?: string;
    /** Filter function to decide which messages to respond to */
    shouldRespond?: (sender: string, message: string) => boolean;
    /** Max characters per in-game message (game limit) */
    maxMessageLength?: number;
    /** Delay between sending multi-part messages (in ticks) */
    messageSplitDelay?: number;
    /** Whether to speak responses in-game via sendSay */
    speakInGame?: boolean;
}

interface PendingResponse {
    sender: string;
    message: string;
    timestamp: number;
}

/**
 * Integrates AI chat with the in-game chat system.
 * Listens for game messages and responds using Ollama.
 */
export class GameChatIntegration {
    private ctx: OllamaContext;
    private sdk: BotSDK;
    private bot: BotActions;
    private config: Required<GameChatConfig>;
    private pendingResponses: PendingResponse[] = [];
    private processing = false;
    private unsubscribe: (() => void) | null = null;

    constructor(sdk: BotSDK, bot: BotActions, config: GameChatConfig) {
        this.sdk = sdk;
        this.bot = bot;

        this.config = {
            ollama: config.ollama ?? {},
            botName: config.botName,
            personality: config.personality ?? '',
            shouldRespond: config.shouldRespond ?? (() => true),
            maxMessageLength: config.maxMessageLength ?? 80,
            messageSplitDelay: config.messageSplitDelay ?? 2,
            speakInGame: config.speakInGame ?? true,
        };

        // Build system prompt
        const systemPrompt = this.buildSystemPrompt();

        this.ctx = new OllamaContext({
            ...this.config.ollama,
            systemPrompt,
        });
    }

    private buildSystemPrompt(): string {
        let prompt = `You are ${this.config.botName}, a player in a fantasy MMORPG called RuneScape.`;

        if (this.config.personality) {
            prompt += ` ${this.config.personality}`;
        }

        prompt += `

You are chatting with other players in the game. Keep your responses:
- SHORT: Max 1-2 sentences. Players don't read walls of text.
- IN CHARACTER: You're a player, not an AI. Act like you're playing the game.
- NATURAL: Use casual game chat style. Abbreviations are fine (lol, brb, gg, etc).
- RELEVANT: Respond to what they said. Ask questions. Be social.

Do NOT:
- Mention being an AI or language model
- Give long explanations
- Use formal language
- Break character`;

        return prompt;
    }

    /**
     * Start listening for game messages and responding.
     */
    start(): void {
        // Subscribe to state updates to watch for new messages
        this.unsubscribe = this.sdk.onStateUpdate((state) => {
            // Look for new public chat messages (type 2)
            const chatMessages = state.gameMessages?.filter(m => m.type === 2) ?? [];

            for (const msg of chatMessages) {
                // Skip our own messages
                if (msg.sender === this.config.botName) continue;

                // Check if we should respond
                if (!this.config.shouldRespond(msg.sender, msg.message)) continue;

                // Queue the response
                this.queueResponse(msg.sender, msg.message);
            }
        });
    }

    /**
     * Stop listening for messages.
     */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.ctx.abort();
    }

    /**
     * Queue a message for response.
     */
    private queueResponse(sender: string, message: string): void {
        // Avoid duplicate processing
        const isDuplicate = this.pendingResponses.some(
            p => p.sender === sender && p.message === message
        );
        if (isDuplicate) return;

        this.pendingResponses.push({
            sender,
            message,
            timestamp: Date.now(),
        });

        // Start processing if not already
        if (!this.processing) {
            this.processQueue();
        }
    }

    /**
     * Process the response queue.
     */
    private async processQueue(): Promise<void> {
        this.processing = true;

        while (this.pendingResponses.length > 0) {
            const pending = this.pendingResponses.shift();
            if (!pending) break;

            try {
                await this.respondTo(pending.sender, pending.message);
            } catch (error) {
                console.error(`[GameChat] Error responding to ${pending.sender}:`, error);
            }
        }

        this.processing = false;
    }

    /**
     * Generate and send a response to a message.
     */
    private async respondTo(sender: string, message: string): Promise<string> {
        // Get AI response
        const response = await this.ctx.send(`${sender}: ${message}`);

        // Send in game if enabled
        if (this.config.speakInGame) {
            await this.sayInGame(response);
        }

        return response;
    }

    /**
     * Send a message in-game, splitting if necessary.
     */
    async sayInGame(message: string): Promise<void> {
        // Clean up the message
        let cleaned = message.trim();

        // Remove quotes if the model wrapped the response
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.slice(1, -1);
        }

        // Split into chunks if too long
        const chunks = this.splitMessage(cleaned);

        for (let i = 0; i < chunks.length; i++) {
            await this.sdk.sendSay(chunks[i]);

            // Wait between chunks
            if (i < chunks.length - 1) {
                await this.sdk.waitForTicks(this.config.messageSplitDelay);
            }
        }
    }

    /**
     * Split a message into chunks that fit the game's character limit.
     */
    private splitMessage(message: string): string[] {
        const maxLen = this.config.maxMessageLength;

        if (message.length <= maxLen) {
            return [message];
        }

        const chunks: string[] = [];
        let remaining = message;

        while (remaining.length > 0) {
            if (remaining.length <= maxLen) {
                chunks.push(remaining);
                break;
            }

            // Find a good break point
            let breakPoint = remaining.lastIndexOf(' ', maxLen);
            if (breakPoint === -1 || breakPoint < maxLen / 2) {
                breakPoint = maxLen;
            }

            chunks.push(remaining.slice(0, breakPoint).trim());
            remaining = remaining.slice(breakPoint).trim();
        }

        return chunks;
    }

    /**
     * Manually send a message (not in response to anyone).
     */
    async say(message: string): Promise<void> {
        // Add to context as if we said it
        this.ctx.addMessage('assistant', message);

        if (this.config.speakInGame) {
            await this.sayInGame(message);
        }
    }

    /**
     * Ask the AI to generate a response to a custom prompt.
     * Useful for scripted interactions.
     */
    async think(prompt: string): Promise<string> {
        return this.ctx.send(prompt);
    }

    /**
     * Respond to a specific message (manual trigger).
     */
    async respondToMessage(sender: string, message: string): Promise<string> {
        return this.respondTo(sender, message);
    }

    /**
     * Get the underlying Ollama context for advanced usage.
     */
    getContext(): OllamaContext {
        return this.ctx;
    }

    /**
     * Clear conversation history.
     */
    clearHistory(): void {
        this.ctx.clearHistory();
    }
}

/**
 * Create a game chat integration for a bot.
 */
export function createGameChat(
    sdk: BotSDK,
    bot: BotActions,
    config: GameChatConfig
): GameChatIntegration {
    return new GameChatIntegration(sdk, bot, config);
}
