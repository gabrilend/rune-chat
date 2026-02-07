#!/usr/bin/env luajit
--[[
    chat_daemon.lua - Unix socket daemon for Bash chat integration

    Provides a persistent chat server that bash scripts can connect to.
    Each connection gets its own conversation context.

    Protocol (JSON lines over Unix socket):
        Request:  {"action":"send","message":"Hello"}
        Response: {"type":"token","data":"Hi"}
                  {"type":"token","data":" there"}
                  {"type":"done","full_response":"Hi there"}

        Request:  {"action":"clear"}
        Response: {"type":"ok"}

        Request:  {"action":"get_context"}
        Response: {"type":"context","messages":[...]}

        Request:  {"action":"ping"}
        Response: {"type":"pong"}
]]

-- Add libs to path
local script_path = arg[0]:match("(.*/)")
if script_path then
    local base_path = script_path .. "../../"
    package.path = base_path .. "libs/?.lua;" .. base_path .. "libs/share/lua/5.1/?.lua;" .. package.path
    package.cpath = base_path .. "libs/lib/lua/5.1/?.so;" .. package.cpath
end

local socket = require("socket")
local unix = require("socket.unix")
local json = require("dkjson")

-- Try to load chat_client
local ok, chat_client = pcall(require, "chat_client")
if not ok then
    -- Fallback: try relative path
    package.path = (script_path or "./") .. "../../libs/?.lua;" .. package.path
    chat_client = require("chat_client")
end

-- Configuration
local CONFIG = {
    socket_path = os.getenv("CHAT_SOCKET") or "/tmp/chat_daemon.sock",
    host = os.getenv("CHAT_HOST") or "192.168.0.61",
    port = tonumber(os.getenv("CHAT_PORT")) or 11434,
    model = os.getenv("CHAT_MODEL") or "nemotron-3-nano",
}

-- Remove stale socket file
os.remove(CONFIG.socket_path)

-- Create Unix domain socket server
local server = assert(unix())
local ok, err = server:bind(CONFIG.socket_path)
if not ok then
    io.stderr:write("Failed to bind socket: " .. tostring(err) .. "\n")
    io.stderr:write("Socket path: " .. CONFIG.socket_path .. "\n")
    os.exit(1)
end

assert(server:listen(5))
print("Chat daemon listening on " .. CONFIG.socket_path)
print("Using host: " .. CONFIG.host .. ":" .. CONFIG.port)
print("Model: " .. CONFIG.model)

-- Set permissions so other users can connect
os.execute("chmod 777 " .. CONFIG.socket_path)

-- Track client contexts (one per connection)
local clients = {}  -- conn -> {context, buffer, id}
local next_client_id = 1

-- Non-blocking server
server:settimeout(0)

-- Send JSON response to client
local function send_response(conn, response)
    local data = json.encode(response) .. "\n"
    local ok, err = conn:send(data)
    if not ok then
        return false, err
    end
    return true
end

-- Process a command from client
local function process_command(conn, client, cmd)
    if cmd.action == "send" then
        if not cmd.message or cmd.message == "" then
            return send_response(conn, {type = "error", error = "Missing message"})
        end

        -- Stream response tokens
        local ok, err = client.context:send_blocking(cmd.message, function(token)
            send_response(conn, {type = "token", data = token})
        end)

        if ok then
            -- Send done marker with full response
            local full = client.context:get_last_response()
            send_response(conn, {type = "done", full_response = full})
        else
            send_response(conn, {type = "error", error = err or "Unknown error"})
        end

    elseif cmd.action == "clear" then
        client.context:clear()
        send_response(conn, {type = "ok"})

    elseif cmd.action == "get_context" then
        local messages = client.context:get_context()
        send_response(conn, {type = "context", messages = messages})

    elseif cmd.action == "get_info" then
        local info = client.context:get_info()
        info.client_id = client.id
        send_response(conn, {type = "info", info = info})

    elseif cmd.action == "ping" then
        send_response(conn, {type = "pong"})

    elseif cmd.action == "set_model" then
        if cmd.model then
            client.context.model = cmd.model
            send_response(conn, {type = "ok", model = cmd.model})
        else
            send_response(conn, {type = "error", error = "Missing model"})
        end

    else
        send_response(conn, {type = "error", error = "Unknown action: " .. tostring(cmd.action)})
    end
end

-- Main event loop
print("Ready to accept connections...")

while true do
    -- Accept new connections
    local conn, err = server:accept()
    if conn then
        conn:settimeout(0)
        local ctx = chat_client.new({
            host = CONFIG.host,
            port = CONFIG.port,
            model = CONFIG.model
        })
        local client_id = next_client_id
        next_client_id = next_client_id + 1
        clients[conn] = {context = ctx, buffer = "", id = client_id}
        print(string.format("[%d] Client connected", client_id))
    end

    -- Process existing clients
    local to_remove = {}

    for conn, client in pairs(clients) do
        -- Try to read data
        local data, err, partial = conn:receive("*l")

        if data then
            -- Got a complete line
            local ok, cmd = pcall(json.decode, data)
            if ok and type(cmd) == "table" then
                process_command(conn, client, cmd)
            else
                send_response(conn, {type = "error", error = "Invalid JSON"})
            end
        elseif err == "closed" then
            -- Client disconnected
            print(string.format("[%d] Client disconnected", client.id))
            table.insert(to_remove, conn)
        elseif err ~= "timeout" then
            -- Some other error
            print(string.format("[%d] Error: %s", client.id, tostring(err)))
            table.insert(to_remove, conn)
        end
        -- timeout is normal for non-blocking
    end

    -- Remove disconnected clients
    for _, conn in ipairs(to_remove) do
        clients[conn] = nil
        conn:close()
    end

    -- Small sleep to prevent busy-waiting
    socket.sleep(0.01)
end
