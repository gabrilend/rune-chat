# Configuration Guide

This guide covers all configuration options for the chat library.

## Configuration Loading Order

Configuration is loaded from multiple sources, with later sources overriding earlier ones:

1. **Library Defaults** (`libs/chat_config.lua`)
2. **Project Config** (`{project}/chat_config.lua`)
3. **Runtime Config** (passed to `Chat.new()`)

## Creating a Project Configuration

Create a `chat_config.lua` file in your project root:

```lua
-- chat_config.lua
return {
    host = "localhost",
    port = 11434,
    model = "llama3",
}
```

## All Configuration Options

### Connection Settings

#### `host`
- **Type:** string
- **Default:** `"192.168.0.61"`
- **Description:** Ollama server hostname or IP address

```lua
host = "localhost"
host = "192.168.1.100"
host = "ollama.example.com"
```

#### `port`
- **Type:** integer
- **Default:** `11434`
- **Description:** Ollama server port

```lua
port = 11434
```

#### `timeout`
- **Type:** integer (seconds)
- **Default:** `60`
- **Description:** Request timeout - how long to wait for responses

```lua
timeout = 120  -- 2 minutes for slow models
```

---

### Model Settings

#### `model`
- **Type:** string
- **Default:** `"nemotron-3-nano"`
- **Description:** Default model for chat. Must match a model on your Ollama server.

```lua
model = "llama3"
model = "codellama:13b"
model = "mixtral:8x7b"
```

Run `ollama list` on your server to see available models.

#### `think`
- **Type:** boolean
- **Default:** `true`
- **Description:** Enable thinking/reasoning mode for models that support it

```lua
think = true   -- Show reasoning process
think = false  -- Direct answers only
```

---

### Tools Configuration

#### `tools_dir`
- **Type:** string
- **Default:** `"tools"`
- **Description:** Name of the tools subdirectory in your project

```lua
tools_dir = "tools"        -- Default: project/tools/
tools_dir = "my_tools"     -- Custom: project/my_tools/
tools_dir = "ai/functions" -- Nested: project/ai/functions/
```

#### `include_library_tools`
- **Type:** boolean
- **Default:** `true`
- **Description:** Whether to include built-in library tools

```lua
include_library_tools = true   -- Use both library and project tools
include_library_tools = false  -- Only use project tools
```

When enabled, library tools are loaded first, then project tools can override them.

#### `auto_init_tools_dir`
- **Type:** boolean
- **Default:** `true`
- **Description:** Automatically create the tools directory if it doesn't exist

```lua
auto_init_tools_dir = true   -- Create directory on first run
auto_init_tools_dir = false  -- Don't create automatically
```

#### `copy_library_tools`
- **Type:** boolean
- **Default:** `false`
- **Description:** Copy library tools to project directory on first initialization

```lua
copy_library_tools = false  -- Load from library (default)
copy_library_tools = true   -- Copy to project for customization
```

When true, library tools are copied to your project's tools directory on first run. This allows you to modify them. Existing files are not overwritten.

---

### Behavior Settings

#### `debug`
- **Type:** boolean
- **Default:** `false`
- **Description:** Enable debug logging to `chatbot_debug.log`

```lua
debug = true   -- Log all API requests/responses
debug = false  -- No debug logging
```

Can also be enabled via environment variable: `CHATBOT_DEBUG=1`

#### `init_flag_file`
- **Type:** string
- **Default:** `".chat_initialized"`
- **Description:** Filename for the initialization flag

```lua
init_flag_file = ".chat_initialized"
init_flag_file = ".chatbot_ready"
```

This file is created after first successful initialization and prevents re-initialization on subsequent runs.

---

### Encouragement Messages

#### `encouragements`
- **Type:** table (array of strings)
- **Default:** Array of encouraging messages
- **Description:** Messages shown to the LLM during long operations

```lua
-- Custom messages
encouragements = {
    "Great work!",
    "Keep going!",
    "Almost there!",
}

-- Disable encouragements
encouragements = {}
```

---

### Advanced Settings

#### `api_endpoint`
- **Type:** string
- **Default:** `"/api/chat"`
- **Description:** HTTP endpoint path for the chat API

```lua
api_endpoint = "/api/chat"      -- Standard Ollama
api_endpoint = "/v1/chat"       -- Alternative API
```

#### `max_history`
- **Type:** integer
- **Default:** `0` (unlimited)
- **Description:** Maximum messages to keep in conversation history

```lua
max_history = 0    -- Keep all messages
max_history = 50   -- Keep last 50 messages
max_history = 10   -- Keep last 10 messages
```

#### `output_filters`
- **Type:** table (array of strings)
- **Default:** Model artifact patterns
- **Description:** Patterns to remove from model output

```lua
output_filters = {
    "<no_tool_response>",
    "</no_tool_response>",
    "<thinking>",
    "</thinking>",
}
```

---

## Runtime Configuration

Override any config option when creating a Chat instance:

```lua
local Chat = require("chat")

-- Use defaults
local chat = Chat.new()

-- Override specific options
local chat = Chat.new({
    model = "codellama",
    timeout = 120,
    debug = true,
})

-- Full custom config
local chat = Chat.new({
    host = "10.0.0.50",
    port = 11434,
    model = "mixtral",
    timeout = 180,
    think = false,
    tools_dir = "functions",
    include_library_tools = true,
    debug = os.getenv("DEBUG") == "1",
})
```

---

## Environment Variables

Some settings can be controlled via environment variables:

| Variable | Effect |
|----------|--------|
| `CHATBOT_DEBUG=1` | Enable debug logging |

---

## Example Configurations

### Minimal Local Setup

```lua
return {
    host = "localhost",
    model = "llama3",
}
```

### Production Server

```lua
return {
    host = "ollama.internal.company.com",
    port = 11434,
    model = "mixtral:8x7b",
    timeout = 180,
    think = true,
    debug = false,
}
```

### Development Setup

```lua
return {
    host = "localhost",
    model = "codellama:7b",
    timeout = 60,
    debug = true,
    copy_library_tools = true,  -- Customize tools locally
}
```

### Minimal Tools Only

```lua
return {
    host = "localhost",
    model = "llama3",
    include_library_tools = false,  -- Only my tools
    tools_dir = "ai_tools",
}
```

---

## Viewing Active Configuration

```lua
local Chat = require("chat")
local chat = Chat.new()

-- Get full config
local config = chat:get_config()
print("Host:", config.host)
print("Model:", config.model)
print("Tools dir:", config.tools_dir)

-- Get connection info
local info = chat:get_info()
print("Connected to:", info.host .. ":" .. info.port)
```
