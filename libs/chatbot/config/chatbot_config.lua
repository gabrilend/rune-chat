--[[
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
