// conversation.ts - Multi-bot conversation manager
// Enables bots to talk to each other in real time

import { OllamaContext, OllamaConfig, ChatMessage } from './ollama-client';

export interface BotIdentity {
    name: string;
    personality?: string;  // System prompt describing the bot's personality
    model?: string;        // Override model for this bot
}

export interface ConversationConfig {
    ollama?: OllamaConfig;           // Base Ollama config (host, port, etc.)
    maxTurns?: number;               // Max conversation turns (0 = unlimited)
    onMessage?: (bot: string, message: string) => void;  // Called when a bot speaks
    onToken?: (bot: string, token: string) => void;      // Called for each token (streaming)
    onTurnComplete?: (bot: string, message: string) => void;  // Called after each turn
}

export interface ConversationTurn {
    bot: string;
    message: string;
    timestamp: number;
}

/**
 * Manages a conversation between multiple bots.
 * Each bot has its own OllamaContext with separate message history.
 */
export class BotConversation {
    private bots = new Map<string, OllamaContext>();
    private identities = new Map<string, BotIdentity>();
    private transcript: ConversationTurn[] = [];
    private config: ConversationConfig;
    private running = false;

    constructor(config: ConversationConfig = {}) {
        this.config = {
            maxTurns: config.maxTurns ?? 0,
            ...config,
        };
    }

    /**
     * Add a bot to the conversation.
     */
    addBot(identity: BotIdentity): void {
        const systemPrompt = this.buildSystemPrompt(identity);

        const ctx = new OllamaContext({
            ...this.config.ollama,
            model: identity.model ?? this.config.ollama?.model,
            systemPrompt,
        });

        this.bots.set(identity.name, ctx);
        this.identities.set(identity.name, identity);
    }

    /**
     * Build a system prompt for a bot based on its identity.
     */
    private buildSystemPrompt(identity: BotIdentity): string {
        let prompt = `You are ${identity.name}, a character in a multiplayer game.`;

        if (identity.personality) {
            prompt += ` ${identity.personality}`;
        }

        prompt += ` You are having a conversation with other players. Keep your responses concise and in-character. Respond naturally as if you're chatting in a game.`;

        return prompt;
    }

    /**
     * Get a bot's context by name.
     */
    getBot(name: string): OllamaContext | undefined {
        return this.bots.get(name);
    }

    /**
     * Get all bot names in the conversation.
     */
    getBotNames(): string[] {
        return Array.from(this.bots.keys());
    }

    /**
     * Have a bot say something to another bot (or all bots).
     * Returns the response from the target bot.
     */
    async say(fromBot: string, message: string, toBot?: string): Promise<string> {
        // Record the message
        this.transcript.push({
            bot: fromBot,
            message,
            timestamp: Date.now(),
        });

        this.config.onMessage?.(fromBot, message);

        // If no target, broadcast to all other bots (they all hear it)
        if (!toBot) {
            // Inject the message into all other bots' histories
            for (const [name, ctx] of this.bots) {
                if (name !== fromBot) {
                    ctx.addMessage('user', `${fromBot}: ${message}`);
                }
            }
            return message;
        }

        // Get the target bot's context
        const targetCtx = this.bots.get(toBot);
        if (!targetCtx) {
            throw new Error(`Bot '${toBot}' not found`);
        }

        // Send message and get response
        const response = await targetCtx.send(`${fromBot}: ${message}`, {
            onToken: (token) => {
                this.config.onToken?.(toBot, token);
            },
        });

        // Record the response
        this.transcript.push({
            bot: toBot,
            message: response,
            timestamp: Date.now(),
        });

        this.config.onTurnComplete?.(toBot, response);

        return response;
    }

    /**
     * Have a bot respond to the conversation (based on its history).
     * The bot sees all previous messages and generates a response.
     */
    async respond(botName: string): Promise<string> {
        const ctx = this.bots.get(botName);
        if (!ctx) {
            throw new Error(`Bot '${botName}' not found`);
        }

        // Build context from recent transcript
        const recentMessages = this.transcript.slice(-10);
        const contextPrompt = recentMessages
            .filter(t => t.bot !== botName)
            .map(t => `${t.bot}: ${t.message}`)
            .join('\n');

        if (!contextPrompt) {
            return '';
        }

        // Get response
        const response = await ctx.send(contextPrompt, {
            onToken: (token) => {
                this.config.onToken?.(botName, token);
            },
        });

        // Record the response
        this.transcript.push({
            bot: botName,
            message: response,
            timestamp: Date.now(),
        });

        this.config.onTurnComplete?.(botName, response);

        return response;
    }

    /**
     * Run an automated conversation between bots.
     * Bots take turns responding to each other.
     */
    async runConversation(
        startingBot: string,
        initialMessage: string,
        botOrder?: string[]
    ): Promise<ConversationTurn[]> {
        this.running = true;

        // Default order: all bots except starter, then starter
        const order = botOrder ?? [
            ...this.getBotNames().filter(n => n !== startingBot),
            startingBot,
        ];

        if (order.length < 2) {
            throw new Error('Need at least 2 bots for a conversation');
        }

        // Initial message
        this.transcript.push({
            bot: startingBot,
            message: initialMessage,
            timestamp: Date.now(),
        });
        this.config.onMessage?.(startingBot, initialMessage);

        // Inject initial message into all other bots
        for (const [name, ctx] of this.bots) {
            if (name !== startingBot) {
                ctx.addMessage('user', `${startingBot}: ${initialMessage}`);
            }
        }

        let turnCount = 1;
        let currentIndex = 0;

        while (this.running) {
            // Check turn limit
            if (this.config.maxTurns && turnCount >= this.config.maxTurns) {
                break;
            }

            // Get next bot (skip the one who just spoke)
            const lastSpeaker = this.transcript[this.transcript.length - 1]?.bot;
            let nextBot = order[currentIndex % order.length];

            // Skip if same as last speaker
            if (nextBot === lastSpeaker) {
                currentIndex++;
                nextBot = order[currentIndex % order.length];
            }

            // Get the last message to respond to
            const lastMessage = this.transcript[this.transcript.length - 1];
            if (!lastMessage) break;

            // Have the bot respond
            const response = await this.say(
                lastMessage.bot,
                lastMessage.message,
                nextBot
            );

            // Inject response into other bots' histories
            for (const [name, ctx] of this.bots) {
                if (name !== nextBot) {
                    ctx.addMessage('user', `${nextBot}: ${response}`);
                }
            }

            currentIndex++;
            turnCount++;
        }

        return this.transcript;
    }

    /**
     * Stop a running conversation.
     */
    stop(): void {
        this.running = false;
        // Abort any pending requests
        for (const ctx of this.bots.values()) {
            ctx.abort();
        }
    }

    /**
     * Get the full conversation transcript.
     */
    getTranscript(): ConversationTurn[] {
        return [...this.transcript];
    }

    /**
     * Clear the transcript and reset all bot histories.
     */
    reset(): void {
        this.transcript = [];
        for (const ctx of this.bots.values()) {
            ctx.clearHistory();
        }
    }
}

/**
 * Create a simple two-bot conversation.
 */
export function createTwoBotConversation(
    bot1: BotIdentity,
    bot2: BotIdentity,
    config?: ConversationConfig
): BotConversation {
    const conversation = new BotConversation(config);
    conversation.addBot(bot1);
    conversation.addBot(bot2);
    return conversation;
}

/**
 * Quick helper to have two bots chat for a few turns.
 */
export async function quickChat(
    bot1: BotIdentity,
    bot2: BotIdentity,
    initialMessage: string,
    turns: number = 4,
    ollamaConfig?: OllamaConfig
): Promise<ConversationTurn[]> {
    const conversation = createTwoBotConversation(bot1, bot2, {
        ollama: ollamaConfig,
        maxTurns: turns,
        onMessage: (bot, msg) => console.log(`[${bot}] ${msg}`),
    });

    return conversation.runConversation(bot1.name, initialMessage);
}
