-- core/peer.lua
-- WebSocket peer connection management
-- Symmetric: both peers are equal participants

local json = require("libs.dkjson")
local operation = require("core.operation")
local executor = require("core.executor")
local divergence = require("core.divergence")

local M = {}

-- Connection state
M.STATE = {
    DISCONNECTED = "disconnected",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    HANDSHAKING = "handshaking",
    READY = "ready"
}

-- Message types
M.MSG = {
    HELLO = "hello",
    HELLO_ACK = "hello_ack",
    OP = "op",
    OP_ACK = "op_ack",
    RESULT = "result",
    DIVERGENCE = "divergence",
    SYNC_REQUEST = "sync_request",
    SYNC_RESPONSE = "sync_response",
    PING = "ping",
    PONG = "pong"
}

-- Peer instance
local Peer = {}
Peer.__index = Peer

function M.new(config)
    local self = setmetatable({}, Peer)

    self.config = config or {}
    self.peer_id = operation.init(config.peer_id)
    self.state = M.STATE.DISCONNECTED
    self.remote_peer_id = nil
    self.session_id = nil

    -- Connection (to be set by transport layer)
    self.socket = nil
    self.is_server = false

    -- Operation queue
    self.op_queue = {}
    self.pending_acks = {}  -- op_id -> timestamp

    -- Callbacks
    self.on_message = nil
    self.on_op = nil
    self.on_result = nil
    self.on_divergence = nil
    self.on_state_change = nil
    self.on_error = nil

    -- Operation log (for replay/sync)
    self.op_log = {}
    self.result_log = {}

    return self
end

-- State management
function Peer:set_state(new_state)
    local old_state = self.state
    self.state = new_state
    if self.on_state_change then
        self.on_state_change(new_state, old_state)
    end
end

-- Send message to peer
function Peer:send(msg)
    if not self.socket then
        return nil, "not connected"
    end

    local payload = json.encode(msg)
    -- WebSocket frame format depends on transport
    -- For now, assume socket:send handles framing
    local ok, err = self.socket:send(payload)
    if not ok then
        if self.on_error then
            self.on_error("send failed: " .. (err or "unknown"))
        end
        return nil, err
    end
    return true
end

-- Handle incoming message
function Peer:handle_message(payload)
    local msg, _, err = json.decode(payload)
    if err then
        if self.on_error then
            self.on_error("parse error: " .. err)
        end
        return
    end

    -- Dispatch by type
    local handler = self["handle_" .. msg.type]
    if handler then
        handler(self, msg)
    else
        if self.on_message then
            self.on_message(msg)
        end
    end
end

-- Protocol: Hello (initiate handshake)
function Peer:send_hello()
    self:set_state(M.STATE.HANDSHAKING)
    return self:send({
        type = M.MSG.HELLO,
        peer_id = self.peer_id,
        capabilities = {
            operations = true,
            divergence_tracking = true,
            sync = true
        },
        timestamp = os.time()
    })
end

function Peer:handle_hello(msg)
    self.remote_peer_id = msg.peer_id

    -- Generate session ID (lower peer_id wins for determinism)
    if self.peer_id < msg.peer_id then
        self.session_id = self.peer_id .. "-" .. msg.peer_id
    else
        self.session_id = msg.peer_id .. "-" .. self.peer_id
    end

    -- Send ack
    self:send({
        type = M.MSG.HELLO_ACK,
        peer_id = self.peer_id,
        session_id = self.session_id,
        timestamp = os.time()
    })

    self:set_state(M.STATE.READY)
end

function Peer:handle_hello_ack(msg)
    self.remote_peer_id = msg.peer_id
    self.session_id = msg.session_id
    self:set_state(M.STATE.READY)
end

-- Protocol: Send operation
function Peer:send_op(op)
    -- Log locally
    table.insert(self.op_log, op)

    -- Track pending ack
    self.pending_acks[op.id] = os.time()

    -- Send
    return self:send({
        type = M.MSG.OP,
        op = op
    })
end

function Peer:handle_op(msg)
    local op = msg.op

    -- Acknowledge receipt
    self:send({
        type = M.MSG.OP_ACK,
        op_id = op.id
    })

    -- Log
    table.insert(self.op_log, op)

    -- Execute locally
    local result = executor.execute(op)

    -- Log result
    table.insert(self.result_log, result)

    -- Record for divergence tracking
    divergence.record(op.id, self.peer_id, result)

    -- Send our result
    self:send_result(op.id, result)

    -- Callback
    if self.on_op then
        self.on_op(op, result)
    end
end

function Peer:handle_op_ack(msg)
    self.pending_acks[msg.op_id] = nil
end

-- Protocol: Send result
function Peer:send_result(op_id, result)
    return self:send({
        type = M.MSG.RESULT,
        op_id = op_id,
        result = {
            success = result.success,
            data = result.data,
            error = result.error
        },
        peer_id = self.peer_id
    })
end

function Peer:handle_result(msg)
    -- Record remote result for divergence tracking
    local rec = divergence.record(msg.op_id, msg.peer_id, msg.result)

    -- Check for divergence
    if rec.state == divergence.STATE.DIVERGED then
        self:handle_divergence_detected(msg.op_id, rec)
    end

    -- Callback
    if self.on_result then
        self.on_result(msg.op_id, msg.result, msg.peer_id)
    end
end

-- Protocol: Divergence notification
function Peer:handle_divergence_detected(op_id, rec)
    -- Notify peer
    self:send({
        type = M.MSG.DIVERGENCE,
        op_id = op_id,
        local_result = rec.results[self.peer_id],
        state = rec.state
    })

    -- Callback
    if self.on_divergence then
        self.on_divergence(op_id, rec)
    end
end

function Peer:handle_divergence(msg)
    -- Remote peer detected divergence
    local rec = divergence.get(msg.op_id)
    if self.on_divergence then
        self.on_divergence(msg.op_id, rec)
    end
end

-- Protocol: Sync (replay missed operations)
function Peer:request_sync(since_timestamp)
    return self:send({
        type = M.MSG.SYNC_REQUEST,
        since = since_timestamp or 0
    })
end

function Peer:handle_sync_request(msg)
    local since = msg.since or 0
    local ops = {}
    local results = {}

    for _, op in ipairs(self.op_log) do
        if op.timestamp > since then
            table.insert(ops, op)
        end
    end

    for _, result in ipairs(self.result_log) do
        if result.timestamp > since then
            table.insert(results, result)
        end
    end

    self:send({
        type = M.MSG.SYNC_RESPONSE,
        ops = ops,
        results = results
    })
end

function Peer:handle_sync_response(msg)
    -- Replay operations
    for _, op in ipairs(msg.ops or {}) do
        -- Check if we already have it
        local found = false
        for _, existing in ipairs(self.op_log) do
            if existing.id == op.id then
                found = true
                break
            end
        end

        if not found then
            table.insert(self.op_log, op)
            -- Execute if from remote
            if op.origin ~= self.peer_id then
                local result = executor.execute(op)
                divergence.record(op.id, self.peer_id, result)
            end
        end
    end

    -- Record remote results
    for _, result in ipairs(msg.results or {}) do
        if result.peer_id and result.peer_id ~= self.peer_id then
            divergence.record(result.op_id, result.peer_id, result)
        end
    end
end

-- Protocol: Ping/Pong (keepalive)
function Peer:ping()
    return self:send({
        type = M.MSG.PING,
        timestamp = os.time()
    })
end

function Peer:handle_ping(msg)
    self:send({
        type = M.MSG.PONG,
        timestamp = os.time(),
        echo = msg.timestamp
    })
end

function Peer:handle_pong(msg)
    -- Could calculate latency here
end

-- High-level: Create and broadcast operation
function Peer:broadcast_op(name, args)
    local op = operation.create(name, args, self.peer_id)

    -- Execute locally first
    local local_result = executor.execute(op)
    table.insert(self.result_log, local_result)
    divergence.record(op.id, self.peer_id, local_result)

    -- Send to peer
    if self.state == M.STATE.READY then
        self:send_op(op)
    else
        -- Queue for later
        table.insert(self.op_queue, op)
    end

    return op, local_result
end

-- Flush queued operations
function Peer:flush_queue()
    while #self.op_queue > 0 do
        local op = table.remove(self.op_queue, 1)
        self:send_op(op)
    end
end

-- Get divergence summary
function Peer:divergence_summary()
    return divergence.summary()
end

-- Get specific divergence
function Peer:explain_divergence(op_id)
    return divergence.explain(op_id)
end

-- Disconnect
function Peer:disconnect()
    if self.socket then
        self.socket:close()
        self.socket = nil
    end
    self:set_state(M.STATE.DISCONNECTED)
end

-- Module exports
M.Peer = Peer

return M
