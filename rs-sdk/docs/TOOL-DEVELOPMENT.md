# Tool Development Guide

This guide explains how to create custom tools for the RS-SDK bot-chat system.

## Tool Protocol

Tools are executable scripts that follow a simple protocol:

1. When called with `--tool-info`, output JSON describing the tool
2. When called normally, read JSON arguments from stdin and output JSON result

## Tool Info Format

```json
{
    "name": "my_tool",
    "description": "What this tool does (shown to the LLM)",
    "parameters": {
        "type": "object",
        "properties": {
            "param1": {
                "type": "string",
                "description": "Description of param1"
            },
            "param2": {
                "type": "integer",
                "description": "Description of param2"
            }
        },
        "required": ["param1"]
    }
}
```

## Result Format

Success:
```json
{
    "success": true,
    "data": "Result data here"
}
```

Error:
```json
{
    "success": false,
    "error": "Description of what went wrong"
}
```

## Examples

### Bash Tool

```bash
#!/bin/bash
# tools/check_time - Get current server time

if [[ "$1" == "--tool-info" ]]; then
    cat << 'EOF'
{"name": "check_time", "description": "Get the current server time", "parameters": {"type": "object", "properties": {}, "required": []}}
EOF
    exit 0
fi

# Consume stdin
cat > /dev/null

# Return current time
time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"success\": true, \"time\": \"${time}\"}"
```

### Bash Tool with Parameters

```bash
#!/bin/bash
# tools/calculate_distance - Calculate distance between two points

if [[ "$1" == "--tool-info" ]]; then
    cat << 'EOF'
{
    "name": "calculate_distance",
    "description": "Calculate the distance between two world coordinates",
    "parameters": {
        "type": "object",
        "properties": {
            "x1": {"type": "integer", "description": "First X coordinate"},
            "z1": {"type": "integer", "description": "First Z coordinate"},
            "x2": {"type": "integer", "description": "Second X coordinate"},
            "z2": {"type": "integer", "description": "Second Z coordinate"}
        },
        "required": ["x1", "z1", "x2", "z2"]
    }
}
EOF
    exit 0
fi

# Read JSON input
input=$(cat)

# Extract parameters using sed (basic JSON parsing)
x1=$(echo "$input" | sed -n 's/.*"x1"[[:space:]]*:[[:space:]]*\([0-9-]*\).*/\1/p')
z1=$(echo "$input" | sed -n 's/.*"z1"[[:space:]]*:[[:space:]]*\([0-9-]*\).*/\1/p')
x2=$(echo "$input" | sed -n 's/.*"x2"[[:space:]]*:[[:space:]]*\([0-9-]*\).*/\1/p')
z2=$(echo "$input" | sed -n 's/.*"z2"[[:space:]]*:[[:space:]]*\([0-9-]*\).*/\1/p')

# Validate
if [[ -z "$x1" || -z "$z1" || -z "$x2" || -z "$z2" ]]; then
    echo '{"success": false, "error": "Missing required coordinates"}'
    exit 0
fi

# Calculate Euclidean distance (using awk for floating point)
distance=$(awk "BEGIN {
    dx = $x2 - $x1
    dz = $z2 - $z1
    printf \"%.2f\", sqrt(dx*dx + dz*dz)
}")

echo "{\"success\": true, \"distance\": ${distance}}"
```

### Lua Tool

```lua
#!/usr/bin/env luajit
-- tools/word_count - Count words in text

local json = require("dkjson")

local TOOL_INFO = {
    name = "word_count",
    description = "Count words in text",
    parameters = {
        type = "object",
        properties = {
            text = {
                type = "string",
                description = "Text to analyze"
            }
        },
        required = {"text"}
    }
}

if arg[1] == "--tool-info" then
    print(json.encode(TOOL_INFO))
    os.exit(0)
end

local input = io.read("*a")
local ok, args = pcall(json.decode, input)

if not ok or not args.text then
    print(json.encode({success = false, error = "Invalid input"}))
    os.exit(0)
end

local words = 0
for _ in args.text:gmatch("%S+") do
    words = words + 1
end

print(json.encode({success = true, count = words}))
```

### TypeScript/Bun Tool

```typescript
#!/usr/bin/env bun
// tools/fetch_wiki - Fetch info from game wiki

const TOOL_INFO = {
    name: "fetch_wiki",
    description: "Look up information about an item or NPC on the wiki",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The item or NPC name to search for"
            }
        },
        required: ["query"]
    }
};

async function main() {
    if (process.argv[2] === "--tool-info") {
        console.log(JSON.stringify(TOOL_INFO));
        return;
    }

    const input = await Bun.stdin.text();
    let args: { query?: string };

    try {
        args = JSON.parse(input);
    } catch {
        console.log(JSON.stringify({ success: false, error: "Invalid JSON" }));
        return;
    }

    if (!args.query) {
        console.log(JSON.stringify({ success: false, error: "Missing query" }));
        return;
    }

    // Implementation would fetch from wiki API
    // This is a stub example
    console.log(JSON.stringify({
        success: true,
        data: {
            name: args.query,
            info: "Wiki lookup not implemented"
        }
    }));
}

main();
```

## Tool Discovery

Tools are discovered automatically by the `discoverTools()` function:

```typescript
import { discoverTools } from '../bot-chat';

const tools = await discoverTools('./rs-sdk/tools');
// Returns array of ToolDefinition objects
```

The discovery process:
1. Scans the directory for executable files
2. Skips files starting with `.` or `_`
3. Executes each with `--tool-info`
4. Parses and validates the JSON response
5. Returns tool definitions for Ollama

## Tool Execution

Tools are executed by the `createToolExecutor()` function:

```typescript
import { createToolExecutor } from '../bot-chat';

const executor = createToolExecutor('./rs-sdk/tools');
const result = await executor('query_bot_status', { username: 'idle' });
```

The execution process:
1. Spawns the tool as a subprocess
2. Writes JSON arguments to stdin
3. Reads JSON result from stdout
4. Returns the parsed result

## Best Practices

### 1. Clear Descriptions

Write descriptions that help the LLM understand when to use the tool:

```json
{
    "description": "Query the real-time position of another bot. Use this when you need to know where a teammate is located in the game world."
}
```

### 2. Validate Input

Always validate arguments before processing:

```bash
username=$(echo "$input" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [[ -z "$username" ]]; then
    echo '{"success": false, "error": "Missing required parameter: username"}'
    exit 0
fi
```

### 3. Informative Errors

Return helpful error messages:

```json
{
    "success": false,
    "error": "Bot 'idle' is offline. Only online bots can be queried."
}
```

### 4. Reasonable Timeouts

Tools should complete quickly (default timeout is 30s):

```bash
# Set timeout on curl
response=$(curl -sf --max-time 5 "$url" 2>/dev/null) || {
    echo '{"success": false, "error": "Gateway timeout"}'
    exit 0
}
```

### 5. Clean Output

Ensure only JSON goes to stdout:

```bash
# Redirect debug output to stderr
echo "Debug: processing..." >&2

# Only JSON to stdout
echo '{"success": true, "data": "..."}'
```

### 6. Handle Network Errors

Always handle connection failures gracefully:

```bash
response=$(curl -sf "$url" 2>/dev/null)
curl_status=$?

if [[ $curl_status -ne 0 ]] || [[ -z "$response" ]]; then
    echo '{"success": false, "error": "Failed to connect to gateway"}'
    exit 0
fi
```

## Testing Tools

### Test --tool-info

```bash
./tools/my_tool --tool-info
# Should output valid JSON
```

### Test Execution

```bash
echo '{"param1": "value"}' | ./tools/my_tool
# Should output JSON result
```

### Validate JSON

```bash
./tools/my_tool --tool-info | python3 -m json.tool
echo '{}' | ./tools/my_tool | python3 -m json.tool
```

## Directory Structure

Place tools in `rs-sdk/tools/`:

```
rs-sdk/tools/
├── query_bot_status     # Query single bot
├── query_all_bots       # List all bots
├── get_bot_location     # Get coordinates
├── send_game_message    # Send chat (stub)
└── my_custom_tool       # Your tools here
```

## Environment Variables

Tools can access environment variables:

```bash
GATEWAY_HOST="${GATEWAY_HOST:-localhost}"
GATEWAY_PORT="${GATEWAY_PORT:-8245}"
```

Common variables:
- `GATEWAY_HOST` - Gateway server hostname
- `GATEWAY_PORT` - Gateway server port
- `BOT_USERNAME` - Current bot's username (if set)
