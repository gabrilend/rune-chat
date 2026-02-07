-- core/distributed/coordinator.lua
-- Coordinates distributed inference across peers

local tensor = require("core.distributed.tensor")

local M = {}

-- Session states
M.STATE = {
    IDLE = "idle",
    CONFIGURING = "configuring",
    READY = "ready",
    INFERRING = "inferring",
    WAITING_ACTIVATION = "waiting_activation",
    ERROR = "error"
}

-- Role in distributed inference
M.ROLE = {
    FIRST_HALF = "first_half",   -- Layers 0 to N (sends activations)
    SECOND_HALF = "second_half", -- Layers N+1 to end (receives activations, produces output)
    FULL = "full"                -- Non-distributed fallback
}

-- Coordinator instance
local Coordinator = {}
Coordinator.__index = Coordinator

function M.new(config)
    local self = setmetatable({}, Coordinator)

    self.config = config or {}
    self.peer = config.peer           -- peer.lua connection
    self.state = M.STATE.IDLE
    self.role = M.ROLE.FULL

    -- Model configuration
    self.model_path = config.model_path
    self.total_layers = config.total_layers or 32
    self.hidden_dim = config.hidden_dim or 4096
    self.split_layer = config.split_layer or math.floor(self.total_layers / 2)

    -- Layer assignment
    self.local_layers = nil
    self.remote_layers = nil

    -- Active sessions
    self.sessions = {}

    -- Callbacks
    self.on_token = nil
    self.on_activation_received = nil
    self.on_state_change = nil
    self.on_error = nil

    -- Statistics
    self.stats = {
        activations_sent = 0,
        activations_received = 0,
        bytes_transferred = 0,
        tokens_generated = 0,
        inference_count = 0
    }

    return self
end

-- Set state with callback
function Coordinator:set_state(new_state)
    local old_state = self.state
    self.state = new_state
    if self.on_state_change then
        self.on_state_change(new_state, old_state)
    end
end

-- Configure as first half (layers 0 to split_layer)
function Coordinator:configure_first_half()
    self.role = M.ROLE.FIRST_HALF
    self.local_layers = {0, self.split_layer}
    self.remote_layers = {self.split_layer + 1, self.total_layers - 1}
    self:set_state(M.STATE.READY)

    -- Notify peer
    if self.peer then
        self.peer:send({
            type = "layer_assign",
            role = self.role,
            local_layers = self.local_layers,
            remote_layers = self.remote_layers,
            model_config = {
                total_layers = self.total_layers,
                hidden_dim = self.hidden_dim,
                split_layer = self.split_layer
            }
        })
    end

    return self
end

-- Configure as second half (layers split_layer+1 to end)
function Coordinator:configure_second_half()
    self.role = M.ROLE.SECOND_HALF
    self.local_layers = {self.split_layer + 1, self.total_layers - 1}
    self.remote_layers = {0, self.split_layer}
    self:set_state(M.STATE.READY)

    if self.peer then
        self.peer:send({
            type = "layer_assign",
            role = self.role,
            local_layers = self.local_layers,
            remote_layers = self.remote_layers
        })
    end

    return self
end

-- Handle layer assignment from peer
function Coordinator:handle_layer_assign(msg)
    if msg.role == M.ROLE.FIRST_HALF then
        -- Peer is first half, we should be second half
        self:configure_second_half()
    elseif msg.role == M.ROLE.SECOND_HALF then
        -- Peer is second half, we should be first half
        self:configure_first_half()
    end

    -- Update model config if provided
    if msg.model_config then
        self.total_layers = msg.model_config.total_layers or self.total_layers
        self.hidden_dim = msg.model_config.hidden_dim or self.hidden_dim
        self.split_layer = msg.model_config.split_layer or self.split_layer
    end
end

-- Generate unique session ID
local function generate_session_id()
    return string.format("%x-%x", os.time(), math.random(0, 0xFFFFFF))
end

-- Start a new inference session
function Coordinator:start_session(prompt_tokens)
    local session_id = generate_session_id()

    local session = {
        id = session_id,
        state = "started",
        prompt_tokens = prompt_tokens,
        generated_tokens = {},
        pending_activations = {},
        created_at = os.time(),
        stats = {
            activation_transfers = 0,
            total_bytes = 0
        }
    }

    self.sessions[session_id] = session
    self.stats.inference_count = self.stats.inference_count + 1

    -- Notify peer
    if self.peer then
        self.peer:send({
            type = "infer_start",
            session_id = session_id,
            prompt_tokens = prompt_tokens,
            role = self.role
        })
    end

    return session
end

-- Handle inference start from peer
function Coordinator:handle_infer_start(msg)
    local session = {
        id = msg.session_id,
        state = "started_remote",
        prompt_tokens = msg.prompt_tokens,
        generated_tokens = {},
        pending_activations = {},
        created_at = os.time(),
        remote_role = msg.role
    }

    self.sessions[msg.session_id] = session

    -- If we're second half, wait for activations
    if self.role == M.ROLE.SECOND_HALF then
        self:set_state(M.STATE.WAITING_ACTIVATION)
    end
end

-- Send activation tensor to peer (called by first half)
function Coordinator:send_activation(session_id, layer, activation_data, shape)
    if self.role ~= M.ROLE.FIRST_HALF then
        return nil, "only first_half sends activations"
    end

    local session = self.sessions[session_id]
    if not session then
        return nil, "unknown session: " .. session_id
    end

    local msg = tensor.create_activation_message(
        session_id,
        layer,
        activation_data,
        shape or {1, #activation_data / (self.hidden_dim * 2), self.hidden_dim},
        tensor.DTYPE.FLOAT16
    )

    -- Update stats
    local size = tensor.calc_size(msg.tensor.shape, msg.tensor.dtype)
    self.stats.activations_sent = self.stats.activations_sent + 1
    self.stats.bytes_transferred = self.stats.bytes_transferred + size
    session.stats.activation_transfers = session.stats.activation_transfers + 1
    session.stats.total_bytes = session.stats.total_bytes + size

    -- Send to peer
    if self.peer then
        return self.peer:send(msg)
    end

    return true
end

-- Handle received activation (called on second half)
function Coordinator:handle_activation(msg)
    local parsed, err = tensor.parse_activation_message(msg)
    if not parsed then
        if self.on_error then
            self.on_error("activation parse error: " .. err)
        end
        return
    end

    local session = self.sessions[parsed.session_id]
    if not session then
        -- Create session if we received activation before infer_start
        session = {
            id = parsed.session_id,
            state = "receiving",
            generated_tokens = {},
            pending_activations = {}
        }
        self.sessions[parsed.session_id] = session
    end

    -- Store activation
    table.insert(session.pending_activations, {
        layer = parsed.layer,
        tensor = parsed.tensor,
        received_at = os.time()
    })

    -- Update stats
    self.stats.activations_received = self.stats.activations_received + 1

    -- Callback
    if self.on_activation_received then
        self.on_activation_received(parsed.session_id, parsed.layer, parsed.tensor)
    end

    -- Continue inference with received activation
    self:continue_inference(parsed.session_id)
end

-- Continue inference after receiving activation (second half)
function Coordinator:continue_inference(session_id)
    local session = self.sessions[session_id]
    if not session then return end

    -- Get pending activation
    local activation = table.remove(session.pending_activations, 1)
    if not activation then return end

    -- TODO: Actually run inference from split_layer to end
    -- This is where we'd call llama.cpp or similar
    -- For now, simulate with placeholder

    self:set_state(M.STATE.INFERRING)

    -- Placeholder: In real implementation, this would:
    -- 1. Load activation into GPU
    -- 2. Run layers split_layer+1 to total_layers
    -- 3. Sample next token
    -- 4. Send token to peer
    -- 5. Repeat for autoregressive generation

    -- Simulate token generation
    local token = self:simulate_token_generation(activation)
    self:emit_token(session_id, token)
end

-- Simulate token generation (placeholder)
function Coordinator:simulate_token_generation(activation)
    -- In real implementation: run second half of model
    return {
        id = math.random(1, 32000),
        text = "[token]"
    }
end

-- Emit generated token to both peers
function Coordinator:emit_token(session_id, token)
    local session = self.sessions[session_id]
    if not session then return end

    table.insert(session.generated_tokens, token)
    self.stats.tokens_generated = self.stats.tokens_generated + 1

    -- Local callback
    if self.on_token then
        self.on_token(session_id, token)
    end

    -- Send to peer
    if self.peer then
        self.peer:send({
            type = "infer_token",
            session_id = session_id,
            token = token
        })
    end
end

-- Handle token from peer
function Coordinator:handle_token(msg)
    local session = self.sessions[msg.session_id]
    if session then
        table.insert(session.generated_tokens, msg.token)
    end

    -- Callback
    if self.on_token then
        self.on_token(msg.session_id, msg.token)
    end
end

-- End inference session
function Coordinator:end_session(session_id)
    local session = self.sessions[session_id]
    if not session then return end

    session.state = "completed"
    session.ended_at = os.time()

    if self.peer then
        self.peer:send({
            type = "infer_done",
            session_id = session_id,
            tokens_generated = #session.generated_tokens
        })
    end

    self:set_state(M.STATE.READY)
end

-- Handle inference done from peer
function Coordinator:handle_infer_done(msg)
    local session = self.sessions[msg.session_id]
    if session then
        session.state = "completed"
        session.ended_at = os.time()
    end
    self:set_state(M.STATE.READY)
end

-- Message dispatcher (integrate with peer.lua)
function Coordinator:handle_message(msg)
    local handlers = {
        layer_assign = self.handle_layer_assign,
        infer_start = self.handle_infer_start,
        infer_act = self.handle_activation,
        infer_token = self.handle_token,
        infer_done = self.handle_infer_done
    }

    local handler = handlers[msg.type]
    if handler then
        handler(self, msg)
        return true
    end
    return false  -- Not a distributed inference message
end

-- Get statistics
function Coordinator:get_stats()
    return {
        role = self.role,
        state = self.state,
        local_layers = self.local_layers,
        remote_layers = self.remote_layers,
        sessions = #self.sessions,
        stats = self.stats
    }
end

-- Print configuration info
function Coordinator:info()
    local layer_info = ""
    if self.local_layers then
        layer_info = string.format("local=%d-%d, remote=%d-%d",
            self.local_layers[1], self.local_layers[2],
            self.remote_layers[1], self.remote_layers[2])
    end

    local activation_size = tensor.calc_size(
        {1, 2048, self.hidden_dim},
        tensor.DTYPE.FLOAT16
    )

    return string.format(
        "Distributed Coordinator\n" ..
        "  Role: %s\n" ..
        "  State: %s\n" ..
        "  Model: %d layers, hidden_dim=%d\n" ..
        "  Split: layer %d (%s)\n" ..
        "  Activation size (2k seq): %s",
        self.role,
        self.state,
        self.total_layers,
        self.hidden_dim,
        self.split_layer,
        layer_info,
        tensor.format_size(activation_size)
    )
end

-- Module exports
M.Coordinator = Coordinator

return M
