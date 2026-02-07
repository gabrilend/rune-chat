-- chat.lua - Lua wrapper for chat_client library
-- Provides a simple interface for async and blocking chat operations

-- Adjust package path to find libs
local script_path = debug.getinfo(1, "S").source:match("@(.*/)")
if script_path then
    local base_path = script_path:match("(.*/)[^/]+/[^/]+/$") or script_path .. "../../"
    package.path = base_path .. "libs/?.lua;" .. package.path
end

local chat_client = require("chat_client")
local socket = require("socket")

local Chat = {}

-- Create a new chat context
-- config: {host, port, model, timeout, think}
function Chat.new(config)
    return chat_client.new(config)
end

-- Async helper: run multiple contexts concurrently
-- contexts: array of ChatContext objects
-- Returns when all are complete
function Chat.run_all(contexts)
    local pending = {}
    for _, ctx in ipairs(contexts) do
        if not ctx:is_done() then
            table.insert(pending, ctx)
        end
    end

    while #pending > 0 do
        local still_pending = {}
        for _, ctx in ipairs(pending) do
            local result = ctx:poll()
            if not result.done then
                table.insert(still_pending, ctx)
            end
        end
        pending = still_pending

        -- Small sleep to prevent busy-waiting
        if #pending > 0 then
            socket.sleep(0.01)
        end
    end
end

-- Async helper: run a context until completion
-- Convenience wrapper for single context
function Chat.run_until_done(ctx)
    while not ctx:is_done() do
        ctx:poll()
        socket.sleep(0.01)
    end
    return ctx:get_last_response()
end

-- Example usage demonstration
function Chat.demo()
    print("=== Chat Library Demo ===\n")

    -- Create context
    local ctx = Chat.new({
        host = "192.168.0.61",
        port = 11434,
        model = "nemotron-3-nano"
    })

    -- Blocking usage
    print("--- Blocking Mode ---")
    io.write("Response: ")
    local response = ctx:send_blocking("Say hello in one sentence.", function(token)
        io.write(token)
        io.flush()
    end)
    print("\n")

    -- Clear and try async
    ctx:clear()

    print("--- Async Mode ---")
    io.write("Response: ")
    ctx:send_async("What is 2+2? Answer briefly.", function(token)
        io.write(token)
        io.flush()
    end)

    -- Poll until done
    while not ctx:is_done() do
        ctx:poll()
        socket.sleep(0.01)
    end
    print("\n")

    -- Show context
    print("--- Conversation History ---")
    for i, msg in ipairs(ctx:get_context()) do
        print(string.format("%d. [%s]: %s", i, msg.role, msg.content:sub(1, 50) .. "..."))
    end

    print("\n=== Demo Complete ===")
end

return Chat
