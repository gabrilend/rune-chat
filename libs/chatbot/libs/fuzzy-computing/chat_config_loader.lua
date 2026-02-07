--[[
    chat_config_loader.lua - Configuration Loading System

    Handles loading and merging configuration from:
      1. Library defaults (libs/fuzzy-computing/config/chat_config.lua)
      2. Project overrides (project_dir/chat_config.lua)
      3. Runtime overrides (passed to load())

    Usage:
      local config_loader = require("chat_config_loader")
      local config = config_loader.load(project_dir, runtime_overrides)
]]

local config_loader = {}

-- Deep merge two tables (b overrides a)
local function deep_merge(a, b)
    local result = {}

    -- Copy all from a
    for k, v in pairs(a) do
        if type(v) == "table" then
            result[k] = deep_merge(v, {})
        else
            result[k] = v
        end
    end

    -- Override/merge from b
    for k, v in pairs(b) do
        if type(v) == "table" and type(result[k]) == "table" then
            result[k] = deep_merge(result[k], v)
        else
            result[k] = v
        end
    end

    return result
end

-- Try to load a Lua config file, return empty table if not found
local function try_load_config(path)
    local f = io.open(path, "r")
    if not f then
        return {}
    end
    f:close()

    -- Try to load as Lua module
    local chunk, err = loadfile(path)
    if not chunk then
        io.stderr:write("Warning: Failed to parse config " .. path .. ": " .. tostring(err) .. "\n")
        return {}
    end

    local ok, result = pcall(chunk)
    if not ok then
        io.stderr:write("Warning: Failed to execute config " .. path .. ": " .. tostring(result) .. "\n")
        return {}
    end

    if type(result) ~= "table" then
        io.stderr:write("Warning: Config " .. path .. " must return a table\n")
        return {}
    end

    return result
end

-- Get the library directory (where this file is located)
local function get_library_dir()
    local info = debug.getinfo(1, "S")
    local path = info.source:match("@(.*/)")
    return path or "./"
end

-- Check if project has been initialized
function config_loader.is_initialized(project_dir, init_flag_file)
    init_flag_file = init_flag_file or ".chat_initialized"
    local path = project_dir .. "/" .. init_flag_file
    local f = io.open(path, "r")
    if f then
        f:close()
        return true
    end
    return false
end

-- Mark project as initialized
function config_loader.mark_initialized(project_dir, init_flag_file)
    init_flag_file = init_flag_file or ".chat_initialized"
    local path = project_dir .. "/" .. init_flag_file
    local f = io.open(path, "w")
    if f then
        f:write("initialized=" .. os.date("%Y-%m-%d %H:%M:%S") .. "\n")
        f:write("library_version=1.0.0\n")
        f:close()
        return true
    end
    return false
end

-- Initialize project tools directory
function config_loader.init_tools_dir(project_dir, config)
    local tools_path = project_dir .. "/" .. config.tools_dir

    -- Check if directory exists
    local test = io.popen('test -d "' .. tools_path .. '" && echo yes')
    local exists = test:read("*a"):match("yes")
    test:close()

    if not exists and config.auto_init_tools_dir then
        os.execute('mkdir -p "' .. tools_path .. '"')
    end

    -- Copy library tools if configured
    if config.copy_library_tools then
        local lib_tools = get_library_dir() .. "tools"
        -- Check if library tools exist
        local lib_test = io.popen('test -d "' .. lib_tools .. '" && echo yes')
        local lib_exists = lib_test:read("*a"):match("yes")
        lib_test:close()

        if lib_exists then
            -- Copy each tool that doesn't already exist in project
            local handle = io.popen('ls -1 "' .. lib_tools .. '" 2>/dev/null')
            if handle then
                for filename in handle:lines() do
                    local src = lib_tools .. "/" .. filename
                    local dst = tools_path .. "/" .. filename

                    -- Check if destination exists
                    local dst_test = io.open(dst, "r")
                    if not dst_test then
                        os.execute('cp "' .. src .. '" "' .. dst .. '"')
                        os.execute('chmod +x "' .. dst .. '"')
                    else
                        dst_test:close()
                    end
                end
                handle:close()
            end
        end
    end
end

-- Get user's home directory
local function get_home_dir()
    return os.getenv("HOME") or os.getenv("USERPROFILE") or "~"
end

-- Load configuration with priority:
--   1. Project config (project_dir/config/chatbot_config.lua or project_dir/chat_config.lua)
--   2. User default (~/.config/fuzzy-chat/default-config.lua)
--   3. Library defaults (only if running from library directory)
--   4. Runtime overrides
-- project_dir: Path to the project directory
-- runtime_config: Optional table of runtime overrides
-- Returns: Merged configuration table
function config_loader.load(project_dir, runtime_config)
    project_dir = project_dir or "./"
    runtime_config = runtime_config or {}

    local lib_dir = get_library_dir()
    local home_dir = get_home_dir()

    -- Determine if we're running from the library directory itself
    local running_from_library = false
    local abs_project = io.popen('cd "' .. project_dir .. '" && pwd'):read("*l") or project_dir
    local abs_lib = io.popen('cd "' .. lib_dir .. '.." && pwd'):read("*l") or lib_dir
    if abs_project == abs_lib or abs_project:match("/fuzzy%-computing/?$") then
        running_from_library = true
    end

    -- 1. Try to load project config (check multiple locations)
    local project_config = {}
    local project_config_found = false

    -- First try: project_dir/config/chatbot_config.lua (new standard location)
    local config_path1 = project_dir .. "/config/chatbot_config.lua"
    local f1 = io.open(config_path1, "r")
    if f1 then
        f1:close()
        project_config = try_load_config(config_path1)
        project_config_found = true
    end

    -- Second try: project_dir/chat_config.lua (legacy location)
    if not project_config_found then
        local config_path2 = project_dir .. "/chat_config.lua"
        local f2 = io.open(config_path2, "r")
        if f2 then
            f2:close()
            project_config = try_load_config(config_path2)
            project_config_found = true
        end
    end

    -- 2. Load user default config if no project config found
    local user_config = {}
    if not project_config_found then
        local user_config_path = home_dir .. "/.config/fuzzy-chat/default-config.lua"
        local f3 = io.open(user_config_path, "r")
        if f3 then
            f3:close()
            user_config = try_load_config(user_config_path)
        end
    end

    -- 3. Only load library defaults if running from library directory or no other config found
    local default_config = {}
    if running_from_library or (not project_config_found and next(user_config) == nil) then
        default_config = try_load_config(lib_dir .. "config/chat_config.lua")
    end

    -- 4. Merge: library defaults <- user defaults <- project <- runtime
    local config = deep_merge(default_config, user_config)
    config = deep_merge(config, project_config)
    config = deep_merge(config, runtime_config)

    -- Store paths for later use
    config._library_dir = lib_dir
    config._project_dir = project_dir

    -- Handle environment variable overrides
    if os.getenv("CHATBOT_DEBUG") == "1" then
        config.debug = true
    end
    if os.getenv("CHAT_HOST") then
        config.host = os.getenv("CHAT_HOST")
    end
    if os.getenv("CHAT_PORT") then
        config.port = tonumber(os.getenv("CHAT_PORT")) or config.port
    end
    if os.getenv("CHAT_MODEL") then
        config.model = os.getenv("CHAT_MODEL")
    end

    return config
end

-- Get library directory (exposed for tools discovery)
config_loader.get_library_dir = get_library_dir

return config_loader
