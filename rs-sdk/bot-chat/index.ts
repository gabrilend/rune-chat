// bot-chat - AI chat integration for RS-SDK bots
// Enables bots to have conversations with each other using Ollama

export {
    OllamaContext,
    OllamaConfig,
    ChatMessage,
    StreamCallbacks,
    createContext,
    // Tool calling types
    ToolDefinition,
    ToolCall,
    ToolResult,
    ToolExecutor,
} from './ollama-client';

export {
    BotConversation,
    BotIdentity,
    ConversationConfig,
    ConversationTurn,
    createTwoBotConversation,
    quickChat,
} from './conversation';

export {
    GameChatIntegration,
    GameChatConfig,
    createGameChat,
} from './game-integration';

// Tool discovery and execution
export {
    discoverTools,
    executeTool,
    createToolExecutor,
    createToolExecutorWithTools,
} from './tool-executor';
