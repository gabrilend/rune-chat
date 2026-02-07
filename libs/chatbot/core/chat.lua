-- chat.lua - Ollama integration and LLM processing
-- Uses libs/chat_client.lua for core communication
-- Supports tools from both library and project directories

local json = require("dkjson")
local chat_client = require("chat_client")
local config_loader = require("chat_config_loader")

local Chat = {}
Chat.__index = Chat

-- Base64 encoding table
local b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

-- Base64 encode a string
local function base64_encode(data)
    return ((data:gsub('.', function(x)
        local r, b = '', x:byte()
        for i = 8, 1, -1 do r = r .. (b % 2 ^ i - b % 2 ^ (i - 1) > 0 and '1' or '0') end
        return r
    end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if #x < 6 then return '' end
        local c = 0
        for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2 ^ (6 - i) or 0) end
        return b64chars:sub(c + 1, c + 1)
    end) .. ({ '', '==', '=' })[#data % 3 + 1])
end

-- Read and base64 encode an image file
local function encode_image_file(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return base64_encode(data)
end

-- Discover tools from a directory
local function discover_tools_in_dir(tools_dir, existing_tools)
    existing_tools = existing_tools or {}

    local handle = io.popen('ls -1 "' .. tools_dir .. '" 2>/dev/null')
    if not handle then return existing_tools end

    for filename in handle:lines() do
        local script_path = tools_dir .. "/" .. filename
        local test = io.popen('test -x "' .. script_path .. '" && echo yes')
        local is_exec = test:read("*a"):match("yes")
        test:close()

        if is_exec then
            local info_handle = io.popen('"' .. script_path .. '" --tool-info 2>/dev/null')
            local info_json = info_handle:read("*a")
            info_handle:close()

            local ok, tool_info = pcall(json.decode, info_json)
            if ok and tool_info and tool_info.name then
                tool_info._path = script_path
                tool_info._source = tools_dir
                existing_tools[tool_info.name] = tool_info
            end
        end
    end
    handle:close()

    return existing_tools
end

-- Create a new Chat instance
function Chat.new(runtime_config, script_dir, project_dir)
    local self = setmetatable({}, Chat)

    -- Determine directories
    self.project_dir = project_dir or "./"
    self.script_dir = script_dir or self.project_dir

    -- Load merged configuration
    self.config = config_loader.load(self.project_dir, runtime_config)

    -- Store library dir from config
    self.library_dir = self.config._library_dir or "./libs/"

    -- Shortcuts for common config values
    self.host = self.config.host
    self.port = self.config.port
    self.model = self.config.model
    self.timeout = self.config.timeout
    self.think = self.config.think

    -- Initialize project if needed
    if not config_loader.is_initialized(self.project_dir, self.config.init_flag_file) then
        config_loader.init_tools_dir(self.project_dir, self.config)
        config_loader.mark_initialized(self.project_dir, self.config.init_flag_file)
    end

    -- Create the underlying chat client context
    -- chat_client does capability detection and may disable thinking if not supported
    self.context = chat_client.new({
        host = self.host,
        port = self.port,
        model = self.model,
        timeout = self.timeout,
        think = self.think,
        api_endpoint = self.config.api_endpoint,
        output_filters = self.config.output_filters or {},
    })

    -- Use the capability-adjusted think value from context
    -- (chat_client auto-disables thinking for models that don't support it)
    self.think = self.context.think

    self.tools = {}
    math.randomseed(os.time())

    return self
end

-- Get messages (delegate to context)
function Chat:get_messages()
    return self.context:get_context()
end

-- Get a random encouragement
function Chat:get_encouragement()
    local msgs = self.config.encouragements
    if not msgs or #msgs == 0 then
        return ""
    end
    return msgs[math.random(#msgs)]
end

-- Get the last user message for context reminders
function Chat:get_user_task_reminder()
    local messages = self.context:get_context()
    for i = #messages, 1, -1 do
        if messages[i].role == "user" then
            return messages[i].content
        end
    end
    return nil
end

-- Discover tools from both library and project directories
function Chat:discover_tools()
    self.tools = {}

    -- First, load library tools (if enabled)
    if self.config.include_library_tools then
        local lib_tools_dir = self.library_dir .. "tools"
        self.tools = discover_tools_in_dir(lib_tools_dir, self.tools)
    end

    -- Then, load project tools (these override library tools with same name)
    local project_tools_dir = self.project_dir .. self.config.tools_dir
    self.tools = discover_tools_in_dir(project_tools_dir, self.tools)
end

-- Get tool names
function Chat:get_tool_names()
    local names = {}
    for name, _ in pairs(self.tools) do
        table.insert(names, name)
    end
    return names
end

-- Get tools grouped by source
function Chat:get_tools_by_source()
    local lib_tools = {}
    local project_tools = {}

    for name, tool in pairs(self.tools) do
        if tool._source:match("libs/") then
            table.insert(lib_tools, name)
        else
            table.insert(project_tools, name)
        end
    end

    return { library = lib_tools, project = project_tools }
end

-- Build tools array for Ollama API
function Chat:get_tools_for_api()
    local api_tools = {}
    for name, tool in pairs(self.tools) do
        table.insert(api_tools, {
            type = "function",
            ["function"] = {
                name = tool.name,
                description = tool.description,
                parameters = tool.parameters
            }
        })
    end
    return api_tools
end

-- Execute a tool
function Chat:execute_tool(name, arguments)
    local tool = self.tools[name]
    if not tool then
        return {success = false, error = "Unknown tool: " .. name}
    end

    local tool_args = {}
    for k, v in pairs(arguments) do
        tool_args[k] = v
    end
    tool_args._project_dir = self.project_dir

    local args_json = json.encode(tool_args)
    local tmp_file = os.tmpname()
    local f, err = io.open(tmp_file, "w")
    if not f then
        return {success = false, error = "Failed to create temp file: " .. tostring(err)}
    end
    f:write(args_json)
    f:close()

    local handle = io.popen('"' .. tool._path .. '" < "' .. tmp_file .. '" 2>&1')
    if not handle then
        os.remove(tmp_file)
        return {success = false, error = "Failed to execute tool"}
    end

    local result = handle:read("*a")
    local success = handle:close()
    os.remove(tmp_file)

    if not success or result == "" then
        return {success = false, error = "Tool execution failed", raw = result or "no output"}
    end

    local ok, parsed = pcall(json.decode, result)
    if ok and type(parsed) == "table" then
        return parsed
    else
        return {success = false, error = "Invalid tool output", raw = result}
    end
end

-- Clear chat history
function Chat:clear()
    self.context:clear()
end

-- Get configuration info
function Chat:get_info()
    return self.context:get_info()
end

-- Get full configuration
function Chat:get_config()
    return self.config
end

-- Send message to Ollama with streaming (uses chat_client library)
function Chat:send(user_message, callbacks, is_tool_response)
    callbacks = callbacks or {}

    -- Set tools on the context
    local api_tools = self:get_tools_for_api()
    self.context:set_tools(#api_tools > 0 and api_tools or nil)

    -- Add user message if not a tool response
    local message_to_send = nil
    if not is_tool_response then
        message_to_send = user_message
    end

    -- Use the library's streaming send
    local full_response, tool_calls, err = self.context:send_streaming(message_to_send, callbacks)

    if err then
        return nil, err
    end

    -- Handle tool calls (chatbot-specific logic)
    if tool_calls and #tool_calls > 0 then
        -- Add assistant response to context before tool results
        self.context:add_message("assistant", full_response or "")

        for _, tc in ipairs(tool_calls) do
            local func = tc["function"]
            if func then
                if callbacks.on_tool_call then callbacks.on_tool_call(func.name) end

                local args = {}
                if func.arguments then
                    if type(func.arguments) == "string" then
                        local ok, parsed = pcall(json.decode, func.arguments)
                        if ok then args = parsed end
                    elseif type(func.arguments) == "table" then
                        args = func.arguments
                    end
                end

                local result = self:execute_tool(func.name, args)
                if callbacks.on_tool_result then callbacks.on_tool_result(func.name, result) end

                local result_content = json.encode(result)

                -- Add encouragement for read_file (chatbot-specific)
                if func.name == "read_file" and result.success then
                    local reminder = self:get_user_task_reminder()
                    local encouragement = self:get_encouragement()
                    if reminder and encouragement ~= "" then
                        result_content = result_content .. "\n\n--- REMINDER ---\n" ..
                            reminder .. "\n--- " .. encouragement .. " ---"
                    end
                end

                -- Check if tool returned an image to include in context
                local images = nil
                if result.display_image then
                    local encoded = encode_image_file(result.display_image)
                    if encoded then
                        images = {encoded}
                    end
                end

                self.context:add_message("tool", result_content, images)
            end
        end

        -- Recursively send to get model's response to tool results
        return self:send(nil, callbacks, true)
    end

    return true
end

return Chat
