// ollama-client.ts - Async Ollama chat client for bot communication
// TypeScript port of chat_client.lua's core functionality
//
// NOTE: For Lua/C port, see libs/chatbot/core/chat.lua for the reference implementation.
// The streaming HTTP and JSON parsing patterns here mirror that Lua code closely.

export interface OllamaConfig {
    host?: string;
    port?: number;
    model?: string;
    timeout?: number;
    systemPrompt?: string;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: ToolCall[];      // For assistant messages that request tool calls
    tool_call_id?: string;        // For tool result messages
}

export interface StreamCallbacks {
    onToken?: (token: string) => void;
    onThinking?: (token: string) => void;
    onDone?: (fullResponse: string) => void;
    onToolCall?: (toolCall: ToolCall) => void;
}

// ============================================================================
// Tool Calling Types
// These interfaces follow the Ollama tool calling API format.
// For Lua port: see libs/chatbot/docs/tools-guide.md for the tool protocol spec.
// ============================================================================

/**
 * Definition of a tool that can be called by the LLM.
 * Follows OpenAI-compatible function calling format used by Ollama.
 */
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, { type: string; description: string }>;
            required?: string[];
        };
    };
}

/**
 * A tool call request from the LLM.
 * Lua port note: arguments may be a string (JSON) or already-parsed object.
 */
export interface ToolCall {
    id?: string;
    function: {
        name: string;
        arguments: string | Record<string, any>;
    };
}

/**
 * Result of executing a tool.
 * Matches the tool protocol in libs/chatbot/docs/tools-guide.md.
 */
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
}

/**
 * Function that executes tools by name.
 * Lua port note: In Lua this would be a function(name, args) that shells out
 * to tool executables or calls registered Lua functions.
 */
export type ToolExecutor = (name: string, args: Record<string, any>) => Promise<ToolResult>;

// ============================================================================

interface OllamaStreamChunk {
    model: string;
    created_at: string;
    message?: {
        role: string;
        content: string;
        tool_calls?: ToolCall[];   // Ollama includes tool calls in message
    };
    done: boolean;
    done_reason?: string;
}

const DEFAULT_CONFIG: Required<Omit<OllamaConfig, 'systemPrompt'>> & { systemPrompt?: string } = {
    host: '192.168.0.61',
    port: 16180,
    model: 'Tohur/natsumura-storytelling-rp-llama-3.1:latest',
    timeout: 60000,
    systemPrompt: undefined,
};

/**
 * Async Ollama chat context for a single conversation.
 * Maintains message history and supports streaming responses.
 * Supports tool calling via setTools() and setToolExecutor().
 */
export class OllamaContext {
    readonly config: Required<Omit<OllamaConfig, 'systemPrompt'>> & { systemPrompt?: string };
    private messages: ChatMessage[] = [];
    private abortController: AbortController | null = null;

    // Tool calling support
    // Lua port note: tools array holds definitions for --tool-info style discovery
    private tools: ToolDefinition[] = [];
    private toolExecutor: ToolExecutor | null = null;

    constructor(config: OllamaConfig = {}) {
        this.config = {
            host: config.host ?? DEFAULT_CONFIG.host,
            port: config.port ?? DEFAULT_CONFIG.port,
            model: config.model ?? DEFAULT_CONFIG.model,
            timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
            systemPrompt: config.systemPrompt,
        };

        // Add system prompt if provided
        if (this.config.systemPrompt) {
            this.messages.push({
                role: 'system',
                content: this.config.systemPrompt,
            });
        }
    }

    /**
     * Get the API URL for the Ollama server.
     */
    private getUrl(): string {
        return `http://${this.config.host}:${this.config.port}/api/chat`;
    }

    /**
     * Send a message and stream the response.
     * Returns a promise that resolves with the full response when done.
     */
    async send(message: string, callbacks?: StreamCallbacks): Promise<string> {
        // Add user message to history
        this.messages.push({ role: 'user', content: message });

        // Prepare abort controller for timeout
        this.abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            this.abortController?.abort();
        }, this.config.timeout);

        try {
            // Build request body, optionally including tools
            // Lua port note: tools array is only included if non-empty
            const requestBody: Record<string, any> = {
                model: this.config.model,
                messages: this.messages,
                stream: true,
            };
            if (this.tools.length > 0) {
                requestBody.tools = this.tools;
            }

            const response = await fetch(this.getUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: this.abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            // Stream the response
            // Lua port note: This streaming JSON line parsing mirrors libs/chatbot/core/chat.lua
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';
            let buffer = '';
            let toolCalls: ToolCall[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete JSON lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const chunk: OllamaStreamChunk = JSON.parse(line);

                        if (chunk.message?.content) {
                            const token = chunk.message.content;
                            fullResponse += token;
                            callbacks?.onToken?.(token);
                        }

                        // Collect tool calls from the response
                        // Lua port note: tool_calls appear in the final message chunk
                        if (chunk.message?.tool_calls) {
                            toolCalls = chunk.message.tool_calls;
                            for (const tc of toolCalls) {
                                callbacks?.onToolCall?.(tc);
                            }
                        }

                        if (chunk.done) {
                            break;
                        }
                    } catch {
                        // Skip malformed JSON
                    }
                }
            }

            // Add assistant response to history (include tool_calls if present)
            const assistantMessage: ChatMessage = { role: 'assistant', content: fullResponse };
            if (toolCalls.length > 0) {
                assistantMessage.tool_calls = toolCalls;
            }
            this.messages.push(assistantMessage);

            callbacks?.onDone?.(fullResponse);
            return fullResponse;

        } finally {
            clearTimeout(timeoutId);
            this.abortController = null;
        }
    }

    /**
     * Send a message without streaming (simpler, returns full response).
     */
    async sendBlocking(message: string): Promise<string> {
        return this.send(message);
    }

    /**
     * Abort the current request if one is in progress.
     */
    abort(): void {
        this.abortController?.abort();
    }

    /**
     * Get the current message history.
     */
    getHistory(): ChatMessage[] {
        return [...this.messages];
    }

    /**
     * Clear message history (keeps system prompt if set).
     */
    clearHistory(): void {
        if (this.config.systemPrompt) {
            this.messages = [{
                role: 'system',
                content: this.config.systemPrompt,
            }];
        } else {
            this.messages = [];
        }
    }

    /**
     * Add a message to history without sending (useful for injecting context).
     */
    addMessage(role: 'user' | 'assistant', content: string): void {
        this.messages.push({ role, content });
    }

    /**
     * Get the last assistant response.
     */
    getLastResponse(): string | null {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant') {
                return this.messages[i].content;
            }
        }
        return null;
    }

    // ========================================================================
    // Tool Calling Methods
    // Lua port note: These methods configure tools for the chat context.
    // The Lua equivalent uses discover_tools() to scan a tools/ directory.
    // ========================================================================

    /**
     * Set the available tools for this context.
     * Tools will be included in API requests to Ollama.
     */
    setTools(tools: ToolDefinition[]): void {
        this.tools = tools;
    }

    /**
     * Get the currently configured tools.
     */
    getTools(): ToolDefinition[] {
        return [...this.tools];
    }

    /**
     * Set the tool executor function.
     * This function is called when the LLM requests a tool call.
     */
    setToolExecutor(executor: ToolExecutor): void {
        this.toolExecutor = executor;
    }

    /**
     * Check if the last message contains tool calls.
     */
    hasToolCalls(): boolean {
        const last = this.messages[this.messages.length - 1];
        return last?.role === 'assistant' && (last.tool_calls?.length ?? 0) > 0;
    }

    /**
     * Get tool calls from the last assistant message.
     */
    getToolCalls(): ToolCall[] {
        const last = this.messages[this.messages.length - 1];
        if (last?.role === 'assistant' && last.tool_calls) {
            return last.tool_calls;
        }
        return [];
    }

    /**
     * Add a tool result to the message history.
     * Call this after executing a tool to provide the result back to the LLM.
     * Lua port note: This adds a 'tool' role message with the result JSON.
     */
    addToolResult(toolCallId: string, result: ToolResult): void {
        this.messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCallId,
        });
    }

    /**
     * Send a message with automatic tool execution.
     * If the LLM responds with tool calls, executes them and continues
     * the conversation until a final text response is received.
     *
     * Lua port note: This is the main agentic loop. In Lua, this would be
     * implemented with coroutines or a while loop with io.popen for tool execution.
     * The async/await pattern here maps to Lua's callback-based async.
     *
     * @param message The user message to send
     * @param callbacks Optional streaming callbacks
     * @param maxToolRounds Maximum tool execution rounds (default 10)
     * @returns The final text response after all tool calls are resolved
     */
    async sendWithTools(
        message: string,
        callbacks?: StreamCallbacks,
        maxToolRounds: number = 10
    ): Promise<string> {
        if (!this.toolExecutor) {
            // No executor set, just do a normal send
            return this.send(message, callbacks);
        }

        let response = await this.send(message, callbacks);
        let rounds = 0;

        // Agentic loop: execute tools until we get a final response
        // Lua port note: This loop pattern is similar to libs/chatbot/core/chat.lua
        while (this.hasToolCalls() && rounds < maxToolRounds) {
            rounds++;
            const toolCalls = this.getToolCalls();

            // Execute each tool call
            for (const tc of toolCalls) {
                const toolName = tc.function.name;

                // Parse arguments - may be string or object
                // Lua port note: In Lua, use dkjson.decode if string
                let args: Record<string, any>;
                if (typeof tc.function.arguments === 'string') {
                    try {
                        args = JSON.parse(tc.function.arguments);
                    } catch {
                        args = {};
                    }
                } else {
                    args = tc.function.arguments;
                }

                // Execute the tool
                const result = await this.toolExecutor(toolName, args);

                // Add result to history
                const callId = tc.id || `call_${rounds}_${toolName}`;
                this.addToolResult(callId, result);
            }

            // Continue the conversation - LLM will see tool results
            // Send empty message to get LLM to process tool results
            response = await this.send('', callbacks);
        }

        return response;
    }
}

/**
 * Create a new Ollama context with the given configuration.
 */
export function createContext(config?: OllamaConfig): OllamaContext {
    return new OllamaContext(config);
}
