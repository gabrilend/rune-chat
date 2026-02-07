-- core/operation.lua
-- Operation abstraction: everything is a tool call

local json = require("libs.dkjson")

local M = {}

-- Generate UUID v4
local function uuid()
    local template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    return string.gsub(template, '[xy]', function(c)
        local v = (c == 'x') and math.random(0, 0xf) or math.random(8, 0xb)
        return string.format('%x', v)
    end)
end

-- High resolution timestamp
local function timestamp()
    local socket = package.loaded["socket"] or require("socket")
    return socket.gettime()
end

-- Operation types (all are tool calls, these are semantic categories)
M.OP_TYPES = {
    MESSAGE = "send_message",      -- chat message
    READ_FILE = "read_file",       -- filesystem read
    WRITE_FILE = "write_file",     -- filesystem write
    EXEC = "exec",                 -- execute command
    GET_ENV = "get_env",           -- environment variable
    SET_CONTEXT = "set_context",   -- conversation context mutation
    GET_CONTEXT = "get_context",   -- conversation context read
    QUERY = "query",               -- arbitrary query against local resources
    CUSTOM = "custom",             -- user-defined tool
}

-- Create a new operation
-- All operations are tool calls with a name and arguments
function M.create(name, args, origin)
    assert(name, "operation name required")
    return {
        id = uuid(),
        type = "tool_call",
        name = name,
        args = args or {},
        origin = origin or M.local_peer_id,
        timestamp = timestamp(),
        version = 1
    }
end

-- Shorthand constructors
function M.message(text, origin)
    return M.create(M.OP_TYPES.MESSAGE, { text = text }, origin)
end

function M.read_file(path, origin)
    return M.create(M.OP_TYPES.READ_FILE, { path = path }, origin)
end

function M.write_file(path, content, origin)
    return M.create(M.OP_TYPES.WRITE_FILE, { path = path, content = content }, origin)
end

function M.exec(command, origin)
    return M.create(M.OP_TYPES.EXEC, { command = command }, origin)
end

function M.get_env(var, origin)
    return M.create(M.OP_TYPES.GET_ENV, { var = var }, origin)
end

function M.set_context(key, value, origin)
    return M.create(M.OP_TYPES.SET_CONTEXT, { key = key, value = value }, origin)
end

function M.get_context(key, origin)
    return M.create(M.OP_TYPES.GET_CONTEXT, { key = key }, origin)
end

function M.query(query_string, scope, origin)
    return M.create(M.OP_TYPES.QUERY, { query = query_string, scope = scope }, origin)
end

function M.custom(tool_name, args, origin)
    return M.create(tool_name, args, origin)
end

-- Serialize operation to JSON
function M.serialize(op)
    return json.encode(op)
end

-- Deserialize operation from JSON
function M.deserialize(str)
    local op, pos, err = json.decode(str)
    if err then
        return nil, err
    end
    return op
end

-- Validate operation structure
function M.validate(op)
    if type(op) ~= "table" then
        return false, "operation must be a table"
    end
    if not op.id then
        return false, "operation missing id"
    end
    if not op.name then
        return false, "operation missing name"
    end
    if not op.timestamp then
        return false, "operation missing timestamp"
    end
    if op.type ~= "tool_call" then
        return false, "operation type must be 'tool_call'"
    end
    return true
end

-- Compare two operations (for ordering)
function M.compare(op_a, op_b)
    return op_a.timestamp < op_b.timestamp
end

-- Create result wrapper
function M.result(op_id, success, data, error_msg)
    return {
        op_id = op_id,
        success = success,
        data = data,
        error = error_msg,
        timestamp = timestamp(),
        peer_id = M.local_peer_id
    }
end

-- Local peer ID (set on init)
M.local_peer_id = nil

function M.init(peer_id)
    M.local_peer_id = peer_id or uuid()
    math.randomseed(os.time() + (timestamp() * 1000) % 1000000)
    return M.local_peer_id
end

return M
