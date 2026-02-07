--[[
    chat_config.lua - Default Configuration for Chat Library (fuzzy-computing)

    This file contains settings for the fuzzy-computing chat library:
    - Connection settings (host, port, model)
    - Tool configuration
    - Document linting settings
    - Image generation settings

    For chatbot application settings (terminal output formatting, display preferences),
    see: config/chatbot_config.lua

    Configuration is loaded in this order (later overrides earlier):
      1. This file (library defaults)
      2. Project's chat_config.lua (if exists)
      3. Runtime config passed to Chat.new()

    USAGE:
      -- In your project's chat_config.lua:
      return {
          host = "localhost",
          port = 11434,
          model = "llama3",
          tools_dir = "my_tools",  -- Custom tools directory name
      }

    All options are documented below with their default values.
]]

local config = {}

--------------------------------------------------------------------------------
-- CONNECTION SETTINGS
-- Configure how the library connects to the Ollama server
--------------------------------------------------------------------------------

-- Ollama server hostname or IP address
-- Default: "192.168.0.61" (local network server)
-- Examples: "localhost", "192.168.1.100", "ollama.example.com"
config.host = "192.168.0.61"

-- Ollama server port
-- Default: 11434 (Ollama's default port)
config.port = 16180

-- Request timeout in seconds
-- How long to wait for a response before giving up
-- Default: 60 seconds
config.timeout = 60

--------------------------------------------------------------------------------
-- MODEL SETTINGS
-- Configure the language model behavior
--------------------------------------------------------------------------------

-- Default model to use for chat
-- This should match a model name available on your Ollama server
-- Run `ollama list` on your server to see available models
-- Default: "nemotron-3-nano"
config.model = "ministral-3:14b"

-- Enable thinking/reasoning mode
-- When true, models that support it will show their reasoning process
-- Auto-detection: The chatbot checks if the model supports thinking and
-- automatically disables it for models that don't (e.g., ministral)
-- Default: true
config.think = true

--------------------------------------------------------------------------------
-- TOOLS CONFIGURATION
-- Configure how tools (function calling) work
--------------------------------------------------------------------------------

-- Name of the tools subdirectory within projects
-- Tools are executable scripts that the LLM can call
-- Default: "tools"
-- The library searches for tools in:
--   1. {library_dir}/tools/  (built-in library tools)
--   2. {project_dir}/{tools_dir}/  (project-specific tools)
config.tools_dir = "tools"

-- Whether to include library's built-in tools
-- When true, built-in tools (read_file, write_code, etc.) are always available
-- Project tools with the same name will override library tools
-- Default: true
config.include_library_tools = true

-- Whether to auto-initialize project tools directory
-- When true, creates the tools directory if it doesn't exist
-- Default: true
config.auto_init_tools_dir = true

-- Whether to copy library tools to project on first init
-- When true, copies built-in tools to project's tools directory
-- This allows users to customize them
-- Default: false (tools are loaded from library, not copied)
config.copy_library_tools = false

--------------------------------------------------------------------------------
-- BEHAVIOR SETTINGS
-- Configure runtime behavior
--------------------------------------------------------------------------------

-- Enable debug mode
-- When true, logs detailed information to chatbot_debug.log
-- Can also be enabled via CHATBOT_DEBUG=1 environment variable
-- Default: false
config.debug = false

-- Path to the initialization flag file
-- This file is created after first successful initialization
-- Default: ".chat_initialized"
config.init_flag_file = ".chat_initialized"

--------------------------------------------------------------------------------
-- ENCOURAGEMENT MESSAGES
-- Supportive messages shown to the LLM during long operations
-- Set to empty table {} to disable
--------------------------------------------------------------------------------

config.encouragements = {
    "You're doing great!",
    "Keep up the awesome work!",
    "You've got this!",
    "Believe in yourself!",
    "You're amazing!",
    "Stay focused, you're doing wonderfully!",
    "One step at a time, you're getting there!",
    "You're a star!",
    "Keep shining!",
    "You're making progress!",
}

--------------------------------------------------------------------------------
-- LIBRARY SOURCES
-- Maps library names to their source paths or URLs
-- Used by insert_dependency tool to validate and locate libraries
-- Paths can be:
--   - Absolute paths: "/home/user/libs/mylib"
--   - Relative to project: "libs/mylib"
--   - Git URLs: "https://github.com/user/repo" (future: auto-clone)
--------------------------------------------------------------------------------

config.sources = {
    -- Core libraries (paths relative to project root or absolute)
    dkjson = "libs/dkjson.lua",
    luasocket = "libs/luasocket",
    readline = "libs/readline.lua",

    -- Graphics
    raylib = "libs/raylib-wayland",

    -- fuzzy-computing library (this library itself)
    ["fuzzy-computing"] = "/home/ritz/programming/lua/chatbot/libs/fuzzy-computing",
}

--------------------------------------------------------------------------------
-- ADVANCED SETTINGS
-- Usually don't need to change these
--------------------------------------------------------------------------------

-- HTTP API endpoint path for chat
-- Default: "/api/chat"
config.api_endpoint = "/api/chat"

-- Maximum message history to keep
-- Set to 0 for unlimited
-- Default: 0 (unlimited)
config.max_history = 0

-- Patterns to filter from model output
-- These artifacts are removed from responses
config.output_filters = {
    "<no_tool_response>",
    "</no_tool_response>",
}

--------------------------------------------------------------------------------
-- LINTER SETTINGS
-- Configuration for the lint_docs tool (document file linting)
-- Note: For terminal output formatting, see config/chatbot_config.lua -> output_line_width
--------------------------------------------------------------------------------

config.linter = {
    -- Line width for text wrapping in documents (typically 80 or 100)
    -- Default: 80
    line_width = 99,

    -- File extensions to process (empty string = no extension)
    -- Default: {".md", ".txt", ""}
    file_extensions = {".md", ".txt", ""},

    -- Table formatting options
    table = {
        -- Padding inside cells (spaces)
        -- Default: 1
        cell_padding = 1,
    },
}

--------------------------------------------------------------------------------
-- IMAGE GENERATION SETTINGS
-- Configuration for the generate_image tool (ComfyUI integration)
--------------------------------------------------------------------------------

config.image_generation = {
    -- ComfyUI server hostname
    -- Default: "192.168.0.61"
    host = "192.168.0.61",

    -- ComfyUI server port
    -- Default: 8123
    port = 8123,

    -- Output directory for generated images (relative to project)
    -- Default: "images"
    output_dir = "images",

    -- Path to the ComfyUI workflow JSON file (exported via "Save API Format")
    -- Can be relative to project root or absolute
    -- Default: "comfyui_workflow.json"
    workflow_file = "comfyui_workflow.json",

    -- Image dimensions
    -- Default: 512x512
    width = 512,
    height = 512,

    -- Node IDs in your workflow for prompt injection
    -- Find these by examining your exported workflow JSON
    -- These are typically the CLIP Text Encode nodes
    positive_prompt_node = "6",
    negative_prompt_node = "7",

    -- Node ID for the KSampler (to randomize seed)
    -- Default: "3"
    sampler_node = "3",

    -- Timeout for image generation in seconds
    -- Default: 120 (2 minutes)
    timeout = 120,

    -- Polling interval in seconds when waiting for generation
    -- Default: 1
    poll_interval = 1,

    -- Vision model settings (for describing generated images back to the main LLM)
    -- Enable this to have a small vision model describe what was generated
    -- The description is returned to the main model so it knows what was created
    vision = {
        -- Enable vision description of generated images
        -- Default: true
        enabled = true,

        -- Vision-capable model to use (must be pulled on your Ollama server)
        -- Small models like moondream are fast and work well for descriptions
        -- Default: "moondream"
        model = "moondream",

        -- Prompt template for the vision model
        -- Use {prompt} as placeholder for the original generation prompt
        -- Default: asks for description and comparison to original prompt
        prompt_template = [[Describe this AI-generated image in 2-3 sentences. Focus on the main subject, composition, and style.

The image was generated from this prompt: "{prompt}"

If anything in the image differs noticeably from what the prompt requested (missing elements, different style, unexpected additions), briefly note those differences in 1-2 sentences. If the image matches the prompt well, no need to mention differences.]],

        -- Timeout for vision model request in seconds
        -- Default: 30
        timeout = 30,
    },
}

return config
