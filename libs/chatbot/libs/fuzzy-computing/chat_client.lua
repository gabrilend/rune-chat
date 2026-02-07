-- chat_client.lua - Reusable chat library with async support
-- Provides ChatContext class for multiple concurrent conversations

local socket = require("socket")
local json = require("dkjson")
local http = require("socket.http")
local ltn12 = require("ltn12")

local ChatContext = {}
ChatContext.__index = ChatContext

-- Default configuration
local DEFAULT_CONFIG = {
    host = "192.168.0.61",
    port = 16180,
    model = "nemotron-3-nano",
    timeout = 60,
    think = true,
    api_endpoint = "/api/chat",
    output_filters = {},
}

-- Cache for model capabilities (avoid repeated API calls)
local model_capabilities_cache = {}

-- Check if a model supports thinking via Ollama API
local function check_model_capabilities(host, port, model_name)
    -- Check cache first
    local cache_key = host .. ":" .. port .. "/" .. model_name
    if model_capabilities_cache[cache_key] ~= nil then
        return model_capabilities_cache[cache_key]
    end

    local capabilities = {
        thinking = false,
        vision = false,
    }

    -- Query the model info
    local url = string.format("http://%s:%d/api/show", host, port)
    local request_body = json.encode({name = model_name})
    local response_body = {}

    local result, status_code = http.request{
        url = url,
        method = "POST",
        headers = {
            ["Content-Type"] = "application/json",
            ["Content-Length"] = #request_body,
        },
        source = ltn12.source.string(request_body),
        sink = ltn12.sink.table(response_body),
    }

    if result and status_code == 200 then
        local response_text = table.concat(response_body)
        local ok, info = pcall(json.decode, response_text)
        if ok and info then
            -- Check for thinking support in model capabilities
            -- Models that support thinking typically have it in their capabilities
            -- or are known thinking models (qwen3, nemotron, deepseek, etc.)
            local model_lower = model_name:lower()

            -- Check by model family/name patterns known to support thinking
            -- Note: Fine-tuned variants like "qwen3-coder" may NOT support thinking
            local is_thinking_model = false

            -- QwQ is always a thinking model
            if model_lower:match("qwq") then
                is_thinking_model = true
            -- Nemotron models support thinking
            elseif model_lower:match("nemotron") then
                is_thinking_model = true
            -- DeepSeek reasoning models (r1, reasoner)
            elseif model_lower:match("deepseek") and (model_lower:match("r1") or model_lower:match("reason")) then
                is_thinking_model = true
            -- Base qwen3 models (but NOT coder or embedding models)
            elseif model_lower:match("qwen3") and not model_lower:match("coder") and not model_lower:match("embed") then
                is_thinking_model = true
            end

            if is_thinking_model then
                capabilities.thinking = true
            end

            -- Check for vision support
            if info.projector_info then
                capabilities.vision = true
            end
            if info.details and info.details.families then
                for _, family in ipairs(info.details.families) do
                    local fam_lower = family:lower()
                    if fam_lower:match("clip") or fam_lower:match("llava") then
                        capabilities.vision = true
                    end
                end
            end
        end
    end

    -- Cache the result
    model_capabilities_cache[cache_key] = capabilities
    return capabilities
end

-- Create a new ChatContext instance
function ChatContext.new(config)
    config = config or {}

    local host = config.host or DEFAULT_CONFIG.host
    local port = config.port or DEFAULT_CONFIG.port
    local model = config.model or DEFAULT_CONFIG.model
    local want_think = config.think ~= false

    -- Check model capabilities and auto-disable thinking if not supported
    local capabilities = check_model_capabilities(host, port, model)
    local actual_think = want_think and capabilities.thinking

    local self = setmetatable({
        -- Connection config
        host = host,
        port = port,
        model = model,
        timeout = config.timeout or DEFAULT_CONFIG.timeout,
        think = actual_think,
        api_endpoint = config.api_endpoint or DEFAULT_CONFIG.api_endpoint,
        output_filters = config.output_filters or DEFAULT_CONFIG.output_filters,

        -- Model capabilities
        capabilities = capabilities,

        -- Tools (can be set later via set_tools)
        tools = nil,

        -- Conversation state
        messages = {},

        -- Async state
        conn = nil,
        coroutine = nil,
        token_buffer = {},
        full_response = "",
        full_thinking = "",
        is_complete = true,
        error = nil,
        tool_calls = nil,  -- Populated if model requests tool calls

        -- Callbacks
        on_token = nil,
        on_thinking = nil,
        on_thinking_start = nil,
        on_thinking_end = nil,
        on_done = nil,
        on_tool_calls = nil,

        -- Internal state for streaming
        _in_thinking = false,
        _line_buffer = "",
    }, ChatContext)

    return self
end

-- Set tools for the context (Ollama tool/function calling)
function ChatContext:set_tools(tools)
    self.tools = tools
end

-- Build the HTTP request body
function ChatContext:_build_request_body()
    local body = {
        model = self.model,
        messages = self.messages,
        stream = true,
    }
    -- Only include think parameter if enabled (avoid errors on non-thinking models)
    if self.think then
        body.think = true
    end
    -- Include tools if set
    if self.tools and #self.tools > 0 then
        body.tools = self.tools
    end
    return json.encode(body)
end

-- Send HTTP request over connection
function ChatContext:_send_http_request(request_body)
    local request = string.format(
        "POST %s HTTP/1.1\r\n" ..
        "Host: %s:%d\r\n" ..
        "Content-Type: application/json\r\n" ..
        "Content-Length: %d\r\n" ..
        "Connection: close\r\n" ..
        "\r\n%s",
        self.api_endpoint, self.host, self.port, #request_body, request_body
    )
    return self.conn:send(request)
end

-- Read HTTP headers, return true if 200 OK
function ChatContext:_read_headers()
    local status_line = self.conn:receive("*l")
    if not status_line or not status_line:match("200") then
        return false, "HTTP error: " .. tostring(status_line)
    end

    -- Skip headers until empty line
    repeat
        local header = self.conn:receive("*l")
    until not header or header == ""

    return true
end

-- Process a single JSON line from the stream
function ChatContext:_process_json_line(line)
    -- Skip empty lines and chunk size indicators (hex numbers)
    if line == "" or line:match("^%x+$") then
        return false
    end

    local ok, chunk = pcall(json.decode, line)
    if not ok or type(chunk) ~= "table" or not chunk.message then
        return false
    end

    -- Handle thinking tokens
    if chunk.message.thinking and chunk.message.thinking ~= "" then
        if not self._in_thinking then
            self._in_thinking = true
            if self.on_thinking_start then
                self.on_thinking_start()
            end
        end
        self.full_thinking = self.full_thinking .. chunk.message.thinking
        if self.on_thinking then
            self.on_thinking(chunk.message.thinking)
        end
    end

    -- Handle content tokens
    if chunk.message.content and chunk.message.content ~= "" then
        -- Close thinking when real content starts
        if self._in_thinking then
            self._in_thinking = false
            if self.on_thinking_end then
                self.on_thinking_end()
            end
        end

        local content = chunk.message.content
        -- Apply output filters
        for _, filter in ipairs(self.output_filters) do
            content = content:gsub(filter, "")
        end

        if content ~= "" then
            self.full_response = self.full_response .. content
            table.insert(self.token_buffer, content)
            if self.on_token then
                self.on_token(content)
            end
        end
    end

    -- Capture tool calls
    if chunk.message.tool_calls then
        self.tool_calls = chunk.message.tool_calls
        if self.on_tool_calls then
            self.on_tool_calls(chunk.message.tool_calls)
        end
    end

    return chunk.done == true
end

-- Coroutine function for async streaming
function ChatContext:_stream_coroutine()
    -- Read and process streaming response
    while true do
        local line, err = self.conn:receive("*l")
        if not line then
            if err == "timeout" then
                coroutine.yield()
            else
                -- Connection closed or error
                break
            end
        else
            local done = self:_process_json_line(line)
            if done then
                break
            end
            -- Yield after processing to allow polling
            coroutine.yield()
        end
    end

    -- Close thinking if still open
    if self._in_thinking and self.on_thinking_end then
        self.on_thinking_end()
    end

    -- Add assistant response to history (if no tool calls)
    if self.full_response ~= "" and not self.tool_calls then
        table.insert(self.messages, {role = "assistant", content = self.full_response})
    end

    self.is_complete = true
    self.conn:close()
    self.conn = nil

    if self.on_done then
        self.on_done(self.full_response, self.tool_calls)
    end
end

-- Start non-blocking async send
-- Returns true on success, nil + error on failure
-- callbacks: {on_token, on_thinking, on_thinking_start, on_thinking_end, on_done, on_tool_calls}
function ChatContext:send_async(message, callbacks)
    callbacks = callbacks or {}

    if not self.is_complete then
        return nil, "Request already in progress"
    end

    -- Add user message to history (if provided - may be nil for tool responses)
    if message then
        table.insert(self.messages, {role = "user", content = message})
    end

    -- Reset state
    self.token_buffer = {}
    self.full_response = ""
    self.full_thinking = ""
    self.is_complete = false
    self.error = nil
    self.tool_calls = nil
    self._in_thinking = false

    -- Set callbacks
    self.on_token = callbacks.on_content or callbacks.on_token
    self.on_thinking = callbacks.on_thinking
    self.on_thinking_start = callbacks.on_thinking_start
    self.on_thinking_end = callbacks.on_thinking_end
    self.on_done = callbacks.on_done
    self.on_tool_calls = callbacks.on_tool_calls

    -- Connect
    self.conn = socket.tcp()
    self.conn:settimeout(0)  -- Non-blocking

    local ok, err = self.conn:connect(self.host, self.port)
    if not ok and err ~= "timeout" then
        table.remove(self.messages)
        self.is_complete = true
        self.error = "Connection failed: " .. tostring(err)
        return nil, self.error
    end

    -- Wait for connection to complete (with timeout)
    local _, writable = socket.select(nil, {self.conn}, self.timeout)
    if not writable[1] then
        table.remove(self.messages)
        self.conn:close()
        self.conn = nil
        self.is_complete = true
        self.error = "Connection timeout"
        return nil, self.error
    end

    -- Send request
    local request_body = self:_build_request_body()
    local sent, err = self:_send_http_request(request_body)
    if not sent then
        table.remove(self.messages)
        self.conn:close()
        self.conn = nil
        self.is_complete = true
        self.error = "Send failed: " .. tostring(err)
        return nil, self.error
    end

    -- Read headers (blocking for simplicity)
    self.conn:settimeout(self.timeout)
    local ok, err = self:_read_headers()
    if not ok then
        table.remove(self.messages)
        self.conn:close()
        self.conn = nil
        self.is_complete = true
        self.error = err
        return nil, err
    end

    -- Switch to non-blocking for streaming
    self.conn:settimeout(0)

    -- Create coroutine for streaming
    self.coroutine = coroutine.create(function()
        self:_stream_coroutine()
    end)

    return true
end

-- Poll for tokens (call in main loop)
-- Returns: {tokens = {...}, done = bool, error = string|nil}
function ChatContext:poll()
    if self.is_complete then
        local tokens = self.token_buffer
        self.token_buffer = {}
        return {tokens = tokens, done = true, error = self.error}
    end

    if not self.coroutine then
        return {tokens = {}, done = true, error = "No active request"}
    end

    -- Check if socket has data
    local readable = socket.select({self.conn}, nil, 0)
    if readable[1] then
        -- Resume coroutine to process data
        local ok, err = coroutine.resume(self.coroutine)
        if not ok then
            self.error = tostring(err)
            self.is_complete = true
        end
    elseif coroutine.status(self.coroutine) ~= "dead" then
        -- Give coroutine a chance to run even without data
        local ok, err = coroutine.resume(self.coroutine)
        if not ok then
            self.error = tostring(err)
            self.is_complete = true
        end
    end

    -- Return buffered tokens
    local tokens = self.token_buffer
    self.token_buffer = {}

    return {tokens = tokens, done = self.is_complete, error = self.error}
end

-- Check if current request is complete
function ChatContext:is_done()
    return self.is_complete
end

-- Blocking send with streaming callbacks
-- callbacks: {on_content, on_thinking, on_thinking_start, on_thinking_end, on_done}
-- Returns: response string, tool_calls (or nil), error (or nil)
function ChatContext:send_streaming(message, callbacks)
    callbacks = callbacks or {}

    -- Add user message to history (if provided)
    if message then
        table.insert(self.messages, {role = "user", content = message})
    end

    -- Reset state
    self.full_response = ""
    self.full_thinking = ""
    self.tool_calls = nil
    self._in_thinking = false

    -- Connect
    local conn = socket.tcp()
    conn:settimeout(self.timeout)

    local ok, err = conn:connect(self.host, self.port)
    if not ok then
        if message then table.remove(self.messages) end
        return nil, nil, "Connection failed: " .. tostring(err)
    end

    -- Send request
    local request_body = self:_build_request_body()
    local request = string.format(
        "POST %s HTTP/1.1\r\n" ..
        "Host: %s:%d\r\n" ..
        "Content-Type: application/json\r\n" ..
        "Content-Length: %d\r\n" ..
        "Connection: close\r\n" ..
        "\r\n%s",
        self.api_endpoint, self.host, self.port, #request_body, request_body
    )

    local sent, send_err = conn:send(request)
    if not sent then
        if message then table.remove(self.messages) end
        conn:close()
        return nil, nil, "Send failed: " .. tostring(send_err)
    end

    -- Read status line
    local status_line = conn:receive("*l")
    if not status_line or not status_line:match("200") then
        if message then table.remove(self.messages) end
        conn:close()
        return nil, nil, "HTTP error: " .. tostring(status_line)
    end

    -- Skip headers
    repeat
        local header = conn:receive("*l")
    until not header or header == ""

    -- Stream response
    while true do
        local line, recv_err = conn:receive("*l")
        if not line then break end

        -- Skip empty lines and chunk size indicators
        if line ~= "" and not line:match("^%x+$") then
            local parse_ok, chunk = pcall(json.decode, line)
            if parse_ok and type(chunk) == "table" and chunk.message then
                -- Handle thinking
                if chunk.message.thinking and chunk.message.thinking ~= "" then
                    if not self._in_thinking then
                        self._in_thinking = true
                        if callbacks.on_thinking_start then
                            callbacks.on_thinking_start()
                        end
                    end
                    self.full_thinking = self.full_thinking .. chunk.message.thinking
                    if callbacks.on_thinking then
                        callbacks.on_thinking(chunk.message.thinking)
                    end
                end

                -- Handle content
                if chunk.message.content and chunk.message.content ~= "" then
                    if self._in_thinking then
                        self._in_thinking = false
                        if callbacks.on_thinking_end then
                            callbacks.on_thinking_end()
                        end
                    end

                    local content = chunk.message.content
                    -- Apply output filters
                    for _, filter in ipairs(self.output_filters) do
                        content = content:gsub(filter, "")
                    end

                    if content ~= "" then
                        self.full_response = self.full_response .. content
                        if callbacks.on_content then
                            callbacks.on_content(content)
                        end
                    end
                end

                -- Capture tool calls
                if chunk.message.tool_calls then
                    self.tool_calls = chunk.message.tool_calls
                end

                if chunk.done then break end
            end
        end
    end

    -- Close thinking if still open
    if self._in_thinking and callbacks.on_thinking_end then
        callbacks.on_thinking_end()
    end

    conn:close()

    -- Add assistant response to history (only if no tool calls - tool handling adds it later)
    if self.full_response ~= "" and not self.tool_calls then
        table.insert(self.messages, {role = "assistant", content = self.full_response})
    end

    if callbacks.on_done then
        callbacks.on_done()
    end

    -- Return response and tool_calls
    if self.full_response ~= "" or self.tool_calls then
        return self.full_response, self.tool_calls, nil
    elseif message then
        table.remove(self.messages)
        return nil, nil, "Empty response"
    end

    return self.full_response, self.tool_calls, nil
end

-- Legacy blocking send (simple interface)
-- Returns: response string, or nil + error
function ChatContext:send_blocking(message, on_token, on_thinking)
    local response, tool_calls, err = self:send_streaming(message, {
        on_content = on_token,
        on_thinking = on_thinking,
    })
    if err then
        return nil, err
    end
    return response
end

-- Clear conversation history
function ChatContext:clear()
    self.messages = {}
end

-- Get conversation history
function ChatContext:get_context()
    return self.messages
end

-- Get the last response
function ChatContext:get_last_response()
    return self.full_response
end

-- Get the last tool calls (if any)
function ChatContext:get_tool_calls()
    return self.tool_calls
end

-- Get configuration info
function ChatContext:get_info()
    return {
        host = self.host,
        port = self.port,
        model = self.model,
        think = self.think,
        capabilities = self.capabilities,
    }
end

-- Add a message to history (for restoring context)
function ChatContext:add_message(role, content, images)
    local message = {role = role, content = content}
    if images and #images > 0 then
        message.images = images
    end
    table.insert(self.messages, message)
end

-- Set system message (prepends to conversation)
function ChatContext:set_system_message(content)
    -- Remove existing system message if present
    if #self.messages > 0 and self.messages[1].role == "system" then
        table.remove(self.messages, 1)
    end
    -- Insert at beginning
    table.insert(self.messages, 1, {role = "system", content = content})
end

-- Module exports
return {
    new = ChatContext.new,
    ChatContext = ChatContext,
}
