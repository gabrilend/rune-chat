# Tools Guide

This guide explains how to use and create tools for the chat library. Tools allow the LLM to
perform actions like reading files, writing code, and interacting with your project.

## Overview

Tools are executable scripts that the LLM can call during a conversation. When the model determines
it needs to perform an action (like reading a file), it generates a "tool call" which the library
executes and returns the result.

### Tool Sources

The library loads tools from two locations:

1. **Library Tools** (`libs/tools/`) - Built-in tools that come with the library
2. **Project Tools** (`{project}/tools/`) - Custom tools you create for your project

Project tools with the same name as library tools will override them, allowing customization.

### Built-in Library Tools

|                Tool | Description                             |
|---------------------|-----------------------------------------|
|         `read_file` | Read contents of a file                 |
|        `write_code` | Write code to a file                    |
|        `write_text` | Write text content to a file            |
|        `write_json` | Write JSON data to a file               |
|       `text_update` | Update specific sections of a text file |
| `insert_dependency` | Add dependencies to project files       |

---

## Configuration

Tools are configured in `chat_config.lua`. You can create this file in your project root to
override defaults.

### Project Configuration Example

```lua
-- chat_config.lua (in your project root)
return {
    -- Use a custom tools directory name
    tools_dir = "my_tools",

    -- Disable library tools (only use project tools)
    include_library_tools = false,

    -- Copy library tools to project on first run
    copy_library_tools = true,
}
```

### Configuration Options

|                  Option |  Default  | Description                                 |
|-------------------------|-----------|---------------------------------------------|
|             `tools_dir` | `"tools"` | Name of tools subdirectory in your project  |
| `include_library_tools` |  `true`   | Whether to include built-in library tools   |
|   `auto_init_tools_dir` |  `true`   | Create tools directory if it doesn't exist  |
|    `copy_library_tools` |  `false`  | Copy library tools to project on first init |

---

## Creating Custom Tools

Tools are executable scripts that follow a simple protocol:

1. When called with `--tool-info`, output JSON describing the tool
2. When called normally, read JSON arguments from stdin and output JSON result

### Tool Info Format

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

### Tool Result Format

```json
{
    "success": true,
    "data": "Result data here"
}
```

Or on error:

```json
{
    "success": false,
    "error": "Description of what went wrong"
}
```

### Example: Bash Tool

```bash
#!/bin/bash
# tools/list_files - List files in a directory

if [[ "$1" == "--tool-info" ]]; then
    cat << 'EOF'
{
    "name": "list_files",
    "description": "List files in a directory",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Directory path to list"
            },
            "pattern": {
                "type": "string",
                "description": "Optional glob pattern to filter files"
            }
        },
        "required": ["path"]
    }
}
EOF
    exit 0
fi

# Read JSON input
input=$(cat)
path=$(echo "$input" | jq -r '.path')
pattern=$(echo "$input" | jq -r '.pattern // "*"')
project_dir=$(echo "$input" | jq -r '._project_dir // "."')

# Resolve relative paths
if [[ ! "$path" = /* ]]; then
    path="$project_dir/$path"
fi

# List files
if [[ -d "$path" ]]; then
    files=$(ls -1 "$path"/$pattern 2>/dev/null | head -50)
    echo "{\"success\": true, \"files\": $(echo "$files" | jq -R -s 'split("\n") | map(select(length > 0))')}"
else
    echo "{\"success\": false, \"error\": \"Directory not found: $path\"}"
fi
```

### Example: Python Tool

```python
#!/usr/bin/env python3
# tools/calculate - Perform calculations

import sys
import json

TOOL_INFO = {
    "name": "calculate",
    "description": "Evaluate a mathematical expression",
    "parameters": {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Math expression to evaluate (e.g., '2 + 2 * 3')"
            }
        },
        "required": ["expression"]
    }
}

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--tool-info":
        print(json.dumps(TOOL_INFO))
        return

    try:
        args = json.load(sys.stdin)
        expr = args.get("expression", "")

        # Safety: only allow basic math operations
        allowed = set("0123456789+-*/().% ")
        if not all(c in allowed for c in expr):
            print(json.dumps({"success": False, "error": "Invalid characters in expression"}))
            return

        result = eval(expr)
        print(json.dumps({"success": True, "result": result}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
```

### Example: Lua Tool

```lua
#!/usr/bin/env luajit
-- tools/word_count - Count words in text

local json = require("dkjson")

local TOOL_INFO = {
    name = "word_count",
    description = "Count words, lines, and characters in text",
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
    os.exit(1)
end

local text = args.text
local words = 0
for _ in text:gmatch("%S+") do words = words + 1 end

local lines = 1
for _ in text:gmatch("\n") do lines = lines + 1 end

print(json.encode({
    success = true,
    words = words,
    lines = lines,
    characters = #text
}))
```

---

## Tool Discovery

Tools are discovered automatically when you call `chat:discover_tools()`. The library:

1. Scans `libs/tools/` for library tools (if `include_library_tools` is true)
2. Scans `{project}/tools/` for project tools
3. Executes each executable with `--tool-info`
4. Registers tools that return valid JSON

### Checking Available Tools

```lua
local Chat = require("chat")
local chat = Chat.new()

chat:discover_tools()

-- List all tool names
print("Available tools:")
for _, name in ipairs(chat:get_tool_names()) do
    print("  - " .. name)
end

-- See which are library vs project tools
local by_source = chat:get_tools_by_source()
print("\nLibrary tools:", table.concat(by_source.library, ", "))
print("Project tools:", table.concat(by_source.project, ", "))
```

---

## Special Arguments

The library automatically adds these arguments when calling tools:

|       Argument | Description                            |
|----------------|----------------------------------------|
| `_project_dir` | Absolute path to the project directory |

Use `_project_dir` to resolve relative file paths in your tools.

---

## Best Practices

### 1. Clear Descriptions

Write descriptions that help the LLM understand when to use the tool:

```json
{
    "description": "Read the contents of a file. Use this when you need to see what's in a file before modifying it."
}
```

### 2. Validate Input

Always validate arguments before processing:

```python
path = args.get("path")
if not path:
    return {"success": False, "error": "Missing required argument: path"}
if ".." in path:
    return {"success": False, "error": "Path traversal not allowed"}
```

### 3. Informative Errors

Return helpful error messages:

```json
{
    "success": false,
    "error": "File not found: /path/to/file.txt. Did you mean /path/to/files.txt?"
}
```

### 4. Reasonable Limits

Prevent runaway operations:

```bash
# Limit file reads
head -c 100000 "$file"  # Max 100KB

# Limit directory listings
ls | head -100  # Max 100 files
```

### 5. Security

- Validate file paths are within project directory
- Sanitize shell arguments
- Don't execute arbitrary code from arguments

---

## Overriding Library Tools

To customize a library tool, create a tool with the same name in your project's tools directory:

```bash
# Project structure
my_project/
├── chat_config.lua
├── tools/
│   └── read_file    # Your custom version overrides library's read_file
└── src/
    └── main.lua
```

Your custom `read_file` will be used instead of the library's version.

---

## Initialization

On first run, the library:

1. Creates the tools directory (if `auto_init_tools_dir` is true)
2. Optionally copies library tools (if `copy_library_tools` is true)
3. Creates `.chat_initialized` flag file

To re-initialize, delete the `.chat_initialized` file and restart your application.

---

## Troubleshooting

### Tool Not Found

```
Unknown tool: my_tool
```

- Check the tool is executable: `chmod +x tools/my_tool`
- Verify `--tool-info` returns valid JSON: `./tools/my_tool --tool-info | jq .`
- Ensure the tool name in JSON matches the expected name

### Tool Execution Failed

```
Tool execution failed
```

- Check the tool runs manually: `echo '{"arg":"value"}' | ./tools/my_tool`
- Look for errors in stderr
- Enable debug mode: `CHATBOT_DEBUG=1`

### Invalid Tool Output

```
Invalid tool output
```

- Ensure output is valid JSON: `./tools/my_tool | jq .`
- Check for extra output (warnings, debug prints) before the JSON
- Redirect stderr if needed: `command 2>/dev/null`
