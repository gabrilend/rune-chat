#!/usr/bin/env luajit

--[[
    Terminal Chatbot - Main Entry Point

    Usage:
        ./chatbot.lua              Run the chatbot
        ./chatbot.lua --init       Initialize/repair configuration
        ./chatbot.lua --help       Show this help message

    Configuration files:
        config/chatbot_config.lua  - Chatbot application settings (output formatting)
        config/library_config.lua  - Library settings (symlink to fuzzy-computing config)
]]

-- Set up library paths (relative to where chatbot is installed)
local script_dir = arg[0]:match("(.*/)")  or "./"
package.path = script_dir .. "libs/luasocket/share/lua/5.1/?.lua;" ..
               script_dir .. "libs/fuzzy-computing/?.lua;" ..
               script_dir .. "libs/?.lua;" ..
               script_dir .. "core/?.lua;" ..
               package.path
package.cpath = script_dir .. "libs/luasocket/lib/lua/5.1/?.so;" ..
                script_dir .. "libs/luasocket/lib/lua/5.1/socket/?.so;" ..
                script_dir .. "libs/luasocket/lib/lua/5.1/mime/?.so;" ..
                package.cpath

--------------------------------------------------------------------------------
-- Utility Functions
--------------------------------------------------------------------------------

local function file_exists(path)
    local f = io.open(path, "r")
    if f then f:close() return true end
    return false
end

local function dir_exists(path)
    local handle = io.popen('test -d "' .. path .. '" && echo yes')
    local result = handle:read("*a")
    handle:close()
    return result:match("yes") ~= nil
end

local function is_symlink(path)
    local handle = io.popen('test -L "' .. path .. '" && echo yes')
    local result = handle:read("*a")
    handle:close()
    return result:match("yes") ~= nil
end

local function get_project_dir()
    local handle = io.popen("pwd")
    local pwd = handle:read("*a"):gsub("%s+$", "")
    handle:close()
    return pwd
end

--------------------------------------------------------------------------------
-- Model Selection UI
--------------------------------------------------------------------------------

-- Fetch available models from Ollama server
local function fetch_ollama_models(host, port)
    -- Load HTTP libraries
    local ok, http = pcall(require, "socket.http")
    if not ok then return nil, "socket.http not available" end

    local ok2, json = pcall(require, "dkjson")
    if not ok2 then return nil, "dkjson not available" end

    local ok3, ltn12 = pcall(require, "ltn12")
    if not ok3 then return nil, "ltn12 not available" end

    local url = string.format("http://%s:%d/api/tags", host, port)
    local response_body = {}

    local result, status_code = http.request{
        url = url,
        method = "GET",
        sink = ltn12.sink.table(response_body),
    }

    if not result then
        return nil, "Failed to connect to Ollama server"
    end

    if status_code ~= 200 then
        return nil, "Ollama server returned status " .. tostring(status_code)
    end

    local response_text = table.concat(response_body)
    local ok4, data = pcall(json.decode, response_text)
    if not ok4 or not data then
        return nil, "Failed to parse response from Ollama"
    end

    if not data.models or #data.models == 0 then
        return nil, "No models found on Ollama server"
    end

    -- Extract model names and sort them
    local models = {}
    for _, model in ipairs(data.models) do
        table.insert(models, model.name)
    end
    table.sort(models)

    return models
end

-- Read a single keypress (handles arrow keys)
local function read_key()
    -- Set terminal to raw mode
    os.execute("stty raw -echo 2>/dev/null")

    local char = io.read(1)
    local key = char

    -- Check for escape sequence (arrow keys)
    if char == "\27" then
        local char2 = io.read(1)
        if char2 == "[" then
            local char3 = io.read(1)
            if char3 == "A" then key = "up"
            elseif char3 == "B" then key = "down"
            elseif char3 == "C" then key = "right"
            elseif char3 == "D" then key = "left"
            else key = "escape"
            end
        else
            key = "escape"
        end
    elseif char == "\r" or char == "\n" then
        key = "enter"
    elseif char == "q" or char == "Q" then
        key = "quit"
    elseif char == "j" then
        key = "down"
    elseif char == "k" then
        key = "up"
    end

    -- Restore terminal
    os.execute("stty sane 2>/dev/null")

    return key
end

-- Interactive model selection UI
-- Returns selected model name or nil if cancelled
local function select_model_interactive(models, default_model)
    local selected = 1
    local scroll_offset = 0
    local max_visible = 16

    -- Find default model in list
    if default_model then
        for i, model in ipairs(models) do
            if model == default_model or model:match("^" .. default_model .. ":") then
                selected = i
                break
            end
        end
    end

    -- ANSI codes
    local CLEAR_LINE = "\27[2K"
    local CURSOR_UP = "\27[A"
    local CURSOR_DOWN = "\27[B"
    local HIDE_CURSOR = "\27[?25l"
    local SHOW_CURSOR = "\27[?25h"
    local BOLD = "\27[1m"
    local CYAN = "\27[36m"
    local DIM = "\27[2m"
    local RESET = "\27[0m"
    local REVERSE = "\27[7m"

    -- Calculate initial scroll offset to show selected item
    if selected > max_visible then
        scroll_offset = selected - max_visible
    end

    local function draw()
        local visible_count = math.min(#models, max_visible)
        local total = #models

        -- Draw header
        io.write(CLEAR_LINE .. CYAN .. "Select a model " .. DIM .. "(↑/↓ to move, Enter to select, q to cancel)" .. RESET .. "\n")

        -- Show scroll indicator if needed
        if scroll_offset > 0 then
            io.write(CLEAR_LINE .. DIM .. "  ↑ " .. scroll_offset .. " more..." .. RESET .. "\n")
        else
            io.write(CLEAR_LINE .. "\n")
        end

        -- Draw visible models
        for i = 1, visible_count do
            local model_idx = i + scroll_offset
            local model = models[model_idx]
            if model then
                io.write(CLEAR_LINE)
                if model_idx == selected then
                    io.write(REVERSE .. BOLD .. " > " .. model .. " " .. RESET .. "\n")
                else
                    io.write("   " .. model .. "\n")
                end
            else
                io.write(CLEAR_LINE .. "\n")
            end
        end

        -- Show scroll indicator if needed
        local remaining = total - scroll_offset - visible_count
        if remaining > 0 then
            io.write(CLEAR_LINE .. DIM .. "  ↓ " .. remaining .. " more..." .. RESET .. "\n")
        else
            io.write(CLEAR_LINE .. "\n")
        end

        io.flush()
    end

    local function move_cursor_up(lines)
        for _ = 1, lines do
            io.write(CURSOR_UP)
        end
    end

    -- Initial draw
    io.write(HIDE_CURSOR)
    draw()

    -- Calculate total lines drawn (header + scroll indicator + models + scroll indicator)
    local total_lines = 1 + 1 + math.min(#models, max_visible) + 1

    while true do
        local key = read_key()

        if key == "up" then
            if selected > 1 then
                selected = selected - 1
                -- Adjust scroll if needed
                if selected <= scroll_offset then
                    scroll_offset = selected - 1
                end
            end
        elseif key == "down" then
            if selected < #models then
                selected = selected + 1
                -- Adjust scroll if needed
                if selected > scroll_offset + max_visible then
                    scroll_offset = selected - max_visible
                end
            end
        elseif key == "enter" then
            io.write(SHOW_CURSOR)
            -- Clear the menu
            move_cursor_up(total_lines)
            for _ = 1, total_lines do
                io.write(CLEAR_LINE .. "\n")
            end
            move_cursor_up(total_lines)
            return models[selected]
        elseif key == "quit" or key == "escape" then
            io.write(SHOW_CURSOR)
            -- Clear the menu
            move_cursor_up(total_lines)
            for _ = 1, total_lines do
                io.write(CLEAR_LINE .. "\n")
            end
            move_cursor_up(total_lines)
            return nil
        end

        -- Redraw
        move_cursor_up(total_lines)
        draw()
    end
end

--------------------------------------------------------------------------------
-- Default Config File Contents
--------------------------------------------------------------------------------

local CHATBOT_CONFIG_TEMPLATE = [=[--[[
    chatbot_config.lua - Chatbot Application Configuration

    This file contains settings specific to the chatbot application itself,
    such as terminal output formatting and display preferences.

    For library/tool settings (model, host, tools, image generation, etc.),
    see: config/library_config.lua (symlinked from libs/fuzzy-computing/config/)

    This separation allows the fuzzy-computing library to be used in other
    projects with its own defaults, while this file customizes the chatbot.
]]

local config = {}

--------------------------------------------------------------------------------
-- TERMINAL OUTPUT SETTINGS
-- Configure how LLM responses are formatted in the terminal
--------------------------------------------------------------------------------

-- Line width for wrapping LLM output in the terminal
-- This affects how assistant responses are word-wrapped and how tables are formatted
-- Note: For document linting (lint_docs tool), see library_config.lua -> config.linter.line_width
-- Default: 100
config.output_line_width = 100

-- Enable table formatting in output
-- When true, markdown tables in responses are reformatted with proper alignment
-- Default: true
config.format_tables = true

--------------------------------------------------------------------------------
-- DEBUG SETTINGS
-- Options for development and troubleshooting
--------------------------------------------------------------------------------

-- Show vision model (moondream) descriptions in cyan
-- Useful for seeing what the vision fallback model reports about generated images
-- Default: true
config.show_vision_debug = true

return config
]=]

--------------------------------------------------------------------------------
-- Initialization
--------------------------------------------------------------------------------

local function print_help()
    print([[
Terminal Chatbot - An LLM chat interface with tool support

Usage:
    ./chatbot.lua              Run the chatbot interactively
    ./chatbot.lua --blind      Hide input as you type (speak mode)
    ./chatbot.lua --init       Initialize config and project directories
    ./chatbot.lua --help       Show this help message

Chatbot Configuration (in chatbot install directory):
    config/chatbot_config.lua  - Default output formatting, debug settings
    config/library_config.lua  - Model, host, tools, image generation (symlink)

Project Directories (created by --init or on first run):
    config/                    - Project-specific configuration
    src/                       - Source code files (write_code tool)
    libs/                      - Library files
    images/                    - Generated images (generate_image tool)

The chatbot looks for config/chatbot_config.lua in the current directory first.
If found, the project is considered initialized and that config is used.
If not found, you'll be prompted to initialize the project.

Environment Variables:
    CHAT_HOST      Override the Ollama server host
    CHAT_PORT      Override the Ollama server port
    CHAT_MODEL     Override the model name
    CHATBOT_DEBUG  Set to "1" to enable debug logging
    CHATBOT_BLIND  Set to "1" to hide input (speak mode)

Commands (while running):
    quit, exit    Exit the chatbot
    clear         Clear conversation history
]])
end

local function init_config_files()
    local config_dir = script_dir .. "config"
    local chatbot_config_path = config_dir .. "/chatbot_config.lua"
    local library_link_path = config_dir .. "/library_config.lua"
    local library_target = "../libs/fuzzy-computing/config/chat_config.lua"

    print("Initializing chatbot configuration...")

    -- Create config directory
    if not dir_exists(config_dir) then
        os.execute('mkdir -p "' .. config_dir .. '"')
        print("  Created: config/")
    end

    -- Create chatbot_config.lua if missing
    if not file_exists(chatbot_config_path) then
        local f = io.open(chatbot_config_path, "w")
        if f then
            f:write(CHATBOT_CONFIG_TEMPLATE)
            f:close()
            print("  Created: config/chatbot_config.lua")
        else
            io.stderr:write("Error: Failed to create config/chatbot_config.lua\n")
            return false
        end
    else
        print("  Exists:  config/chatbot_config.lua")
    end

    -- Create library_config.lua symlink if missing
    if not file_exists(library_link_path) and not is_symlink(library_link_path) then
        -- Check that the target exists
        local target_full = config_dir .. "/" .. library_target
        if file_exists(target_full) then
            local cmd = string.format('ln -s "%s" "%s"', library_target, library_link_path)
            os.execute(cmd)
            print("  Created: config/library_config.lua -> " .. library_target)
        else
            io.stderr:write("Warning: Library config not found at: " .. target_full .. "\n")
            io.stderr:write("         The symlink was not created.\n")
        end
    else
        print("  Exists:  config/library_config.lua")
    end

    print("\nConfiguration initialized successfully!")
    print("Edit config/chatbot_config.lua to customize output formatting.")
    print("Edit config/library_config.lua to change model, host, and tool settings.")

    return true
end

local function check_config_files()
    local errors = {}
    local config_dir = script_dir .. "config"
    local chatbot_config_path = config_dir .. "/chatbot_config.lua"
    local library_config_path = script_dir .. "libs/fuzzy-computing/config/chat_config.lua"

    if not dir_exists(config_dir) then
        table.insert(errors, "Missing directory: config/")
    end

    if not file_exists(chatbot_config_path) then
        table.insert(errors, "Missing file: config/chatbot_config.lua")
    end

    if not file_exists(library_config_path) then
        table.insert(errors, "Missing file: libs/fuzzy-computing/config/chat_config.lua")
    end

    return errors
end

--------------------------------------------------------------------------------
-- Config Loading
--------------------------------------------------------------------------------

-- Load a config file from a path
local function load_config_file(config_path)
    local chunk, err = loadfile(config_path)
    if not chunk then
        return nil, "Failed to parse " .. config_path .. ": " .. tostring(err)
    end

    local ok, config = pcall(chunk)
    if not ok then
        return nil, "Failed to execute " .. config_path .. ": " .. tostring(config)
    end

    if type(config) ~= "table" then
        return nil, config_path .. " must return a table"
    end

    return config
end

-- Load chatbot config, checking project directory first, then falling back to default
local function load_chatbot_config(project_dir)
    -- First, try to load from project's config directory
    local project_config_path = project_dir .. "/config/chatbot_config.lua"
    if file_exists(project_config_path) then
        return load_config_file(project_config_path)
    end

    -- Fall back to chatbot's default config
    local default_config_path = script_dir .. "config/chatbot_config.lua"
    return load_config_file(default_config_path)
end

--------------------------------------------------------------------------------
-- Project Initialization (for user projects, not the chatbot itself)
--------------------------------------------------------------------------------

-- Generate project config with the selected model
local function generate_project_config(selected_model, host, port)
    host = host or "localhost"
    port = port or 11434

    local model_line = ""
    if selected_model then
        model_line = string.format('config.model = "%s"', selected_model)
    else
        model_line = '-- config.model = "llama3"  -- Uncomment and set your preferred model'
    end

    return string.format([=[--[[
    Project Configuration for Terminal Chatbot

    This file contains all settings for this project.
    The chatbot will use these settings when run from this directory.
]]

local config = {}

--------------------------------------------------------------------------------
-- CONNECTION SETTINGS
-- Configure how to connect to the Ollama server
--------------------------------------------------------------------------------

-- Ollama server hostname or IP address
config.host = "%s"

-- Ollama server port
config.port = %d

-- Request timeout in seconds
config.timeout = 60

--------------------------------------------------------------------------------
-- MODEL SETTINGS
--------------------------------------------------------------------------------

-- Default model to use for chat
%s

-- Enable thinking/reasoning mode (for models that support it)
config.think = true

--------------------------------------------------------------------------------
-- TERMINAL OUTPUT SETTINGS
--------------------------------------------------------------------------------

-- Line width for wrapping LLM output in the terminal
config.output_line_width = 100

-- Enable table formatting in output
config.format_tables = true

--------------------------------------------------------------------------------
-- TOOLS SETTINGS
--------------------------------------------------------------------------------

-- Name of the tools subdirectory
config.tools_dir = "tools"

-- Whether to include library's built-in tools
config.include_library_tools = true

--------------------------------------------------------------------------------
-- DEBUG SETTINGS
--------------------------------------------------------------------------------

-- Show vision model descriptions in cyan
config.show_vision_debug = true

-- Enable debug logging (also via CHATBOT_DEBUG=1 environment variable)
config.debug = false

return config
]=], host, port, model_line)
end

-- Check if project is initialized (has a config file)
local function is_project_initialized(project_dir)
    local config_path = project_dir .. "/config/chatbot_config.lua"
    return file_exists(config_path)
end

-- Initialize a project directory
local function do_init_project(project_dir, ui, selected_model, host, port)
    -- Create directories
    os.execute('mkdir -p "' .. project_dir .. '/config"')
    os.execute('mkdir -p "' .. project_dir .. '/src"')
    os.execute('mkdir -p "' .. project_dir .. '/libs"')
    os.execute('mkdir -p "' .. project_dir .. '/images"')

    -- Create project config file with selected model and connection settings
    local config_path = project_dir .. "/config/chatbot_config.lua"
    local config_content = generate_project_config(selected_model, host, port)
    local f = io.open(config_path, "w")
    if f then
        f:write(config_content)
        f:close()
    else
        if ui then
            ui:print_colored("red", "Error: Failed to create config file")
        else
            io.stderr:write("Error: Failed to create config file\n")
        end
        return false
    end

    return true
end

-- Get Ollama host/port from library config
local function get_ollama_settings()
    local library_config_path = script_dir .. "libs/fuzzy-computing/config/chat_config.lua"
    if file_exists(library_config_path) then
        local config = load_config_file(library_config_path)
        if config then
            return config.host or "localhost", config.port or 11434, config.model
        end
    end
    return "localhost", 11434, nil
end

-- Ask user and optionally initialize project
local function init_project(project_dir, ui)
    -- Check if already initialized (config file exists)
    if is_project_initialized(project_dir) then
        return true
    end

    -- Ask user if they want to initialize
    io.write("\n")
    ui:print_colored("yellow", "This directory hasn't been initialized for the chatbot.")
    io.write("The following will be created:\n")
    io.write("  • config/  - configuration files\n")
    io.write("  • src/     - source code files (write_code tool)\n")
    io.write("  • libs/    - library files\n")
    io.write("  • images/  - generated images (generate_image tool)\n")
    io.write("\n")
    io.write("Initialize project? [Y/n] ")
    io.flush()

    local answer = io.read("*l")
    -- Only initialize if user explicitly says yes or presses enter (default yes)
    -- "n", "no", "N", "No", etc. should all decline
    if answer and answer ~= "" and not answer:lower():match("^y") then
        ui:print_colored("dim", "Skipped initialization. You can run './chatbot.lua --init' later.")
        io.write("\n")
        return false
    end

    -- User said yes - now ask about model selection
    local selected_model = nil
    local host, port, default_model = get_ollama_settings()

    io.write("\n")
    ui:print_colored("cyan", "Fetching available models from Ollama...")
    io.flush()

    local models, err = fetch_ollama_models(host, port)
    if models and #models > 0 then
        -- Clear the "Fetching..." message
        io.write("\27[A\27[2K")  -- Move up and clear line
        io.write("\n")
        selected_model = select_model_interactive(models, default_model)
        if selected_model then
            ui:print_colored("green", "Selected model: " .. selected_model)
        else
            ui:print_colored("dim", "No model selected, using default.")
        end
    else
        -- Clear the "Fetching..." message and show warning
        io.write("\27[A\27[2K")  -- Move up and clear line
        ui:print_colored("dim", "Could not fetch models: " .. (err or "unknown error"))
        ui:print_colored("dim", "You can set the model later in config/chatbot_config.lua")
    end
    io.write("\n")

    -- Initialize with selected model and connection settings
    if do_init_project(project_dir, ui, selected_model, host, port) then
        ui:print_colored("green", "Project initialized!")
        io.write("\n")
        return true
    end

    return false
end

--------------------------------------------------------------------------------
-- Main
--------------------------------------------------------------------------------

local function main()
    -- Handle command line arguments
    if arg[1] == "--help" or arg[1] == "-h" then
        print_help()
        os.exit(0)
    end

    -- Check for --blind flag (can be combined with other operations)
    local blind_mode = false
    for i, a in ipairs(arg) do
        if a == "--blind" or a == "-b" then
            blind_mode = true
            table.remove(arg, i)
            break
        end
    end

    if arg[1] == "--init" then
        -- Initialize chatbot's own config files first
        local success = init_config_files()
        if not success then
            os.exit(1)
        end

        -- Also initialize project directories in current directory
        local project_dir = get_project_dir()

        if is_project_initialized(project_dir) then
            print("\nProject already initialized.")
        else
            -- Get Ollama settings and offer model selection
            local host, port, default_model = get_ollama_settings()
            local selected_model = nil

            print("\nFetching available models from Ollama...")
            local models, err = fetch_ollama_models(host, port)
            if models and #models > 0 then
                -- Clear the "Fetching..." line
                io.write("\27[A\27[2K")
                io.write("\n")
                selected_model = select_model_interactive(models, default_model)
                if selected_model then
                    print("\27[32mSelected model: " .. selected_model .. "\27[0m")
                else
                    print("\27[2mNo model selected, using default.\27[0m")
                end
            else
                io.write("\27[A\27[2K")
                print("\27[2mCould not fetch models: " .. (err or "unknown error") .. "\27[0m")
                print("\27[2mYou can set the model later in config/chatbot_config.lua\27[0m")
            end

            print("\nInitializing project directories...")
            if do_init_project(project_dir, nil, selected_model, host, port) then
                print("  Created: config/")
                print("  Created: src/")
                print("  Created: libs/")
                print("  Created: images/")
                print("\nProject initialized!")
            else
                io.stderr:write("Failed to initialize project.\n")
                os.exit(1)
            end
        end

        os.exit(0)
    end

    -- Check chatbot's own configuration files exist
    local config_errors = check_config_files()
    if #config_errors > 0 then
        io.stderr:write("\nConfiguration Error:\n")
        for _, err in ipairs(config_errors) do
            io.stderr:write("  - " .. err .. "\n")
        end
        io.stderr:write("\nRun './chatbot.lua --init' to initialize configuration files.\n\n")
        os.exit(1)
    end

    -- Determine project directory (current working directory)
    local project_dir = get_project_dir()

    -- Load chatbot-specific configuration (project config first, then default)
    local chatbot_config, config_err = load_chatbot_config(project_dir)
    if not chatbot_config then
        io.stderr:write("\nConfiguration Error:\n  " .. config_err .. "\n")
        io.stderr:write("\nRun './chatbot.lua --init' to repair configuration files.\n\n")
        os.exit(1)
    end

    -- Now we can load modules that depend on config
    local Chat = require("chat")
    local UI = require("ui")

    -- Create UI with config
    local ui = UI.new(chatbot_config)

    -- Initialize project if needed (ask user, create dirs and config)
    -- If user declines, we continue with the chatbot's default config
    if not is_project_initialized(project_dir) then
        if init_project(project_dir, ui) then
            -- Project was just initialized - reload config from project directory
            chatbot_config, config_err = load_chatbot_config(project_dir)
            if chatbot_config then
                -- Recreate UI with new config
                ui = UI.new(chatbot_config)
            end
        end
    end

    -- Create chat instance
    -- Note: library config is loaded by chat_config_loader inside Chat.new()
    local chat = Chat.new({}, script_dir, project_dir)
    chat:discover_tools()

    -- Enable blind mode if requested (hide input like speaking)
    if blind_mode then
        local rl = require("readline")
        rl.set_blind_mode(true)
        io.write("\27[2m[blind mode: input hidden]\27[0m\n")
    end

    -- Run the chat UI
    ui:run(chat)
end

main()
