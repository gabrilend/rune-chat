# API Input Design - Peer-to-Peer Operations

## Purpose

Accept text from arbitrary inputs via peer-to-peer WebSocket operation exchange. Two nodes, symmetric execution, local materialization of shared operations.

## Architecture: Peer Model

```
.-------------------.                      .-------------------.
|     PEER A        |                      |     PEER B        |
|                   |      WebSocket       |                   |
|  ┌─────────────┐  |   op: tool_call      |  ┌─────────────┐  |
|  │ local ctx A │◄─┼──────────────────────┼─►│ local ctx B │  |
|  └─────────────┘  |                      |  └─────────────┘  |
|        │          |                      |        │          |
|        ▼          |                      |        ▼          |
|  ┌─────────────┐  |                      |  ┌─────────────┐  |
|  │ executor    │  |                      |  │ executor    │  |
|  └─────────────┘  |                      |  └─────────────┘  |
|        │          |                      |        │          |
|        ▼          |                      |        ▼          |
|  ┌─────────────┐  |   divergence track   |  ┌─────────────┐  |
|  │ result A    │◄─┼──────────────────────┼─►│ result B    │  |
|  └─────────────┘  |                      |  └─────────────┘  |
'-------------------'                      '-------------------'

sim1: A originates ops → both execute with own context → compare
sim2: B originates ops → both execute with own context → compare
```

## Core Principle: Operations, Not Data

Exchange **tool calls** (intents/operations). Each peer materializes results from local resources.

```lua
-- Everything is a tool call
operation = {
    id = "uuid",
    type = "tool_call",
    name = "read_file" | "send_message" | "set_context" | "exec" | ...,
    args = { path = "/etc/hostname" },
    origin = "peer_a",  -- who generated this op
    timestamp = 1234567890.123
}
```

## Truth Model: Divergence Tracking

Never collapse to single truth. Track what each peer believes.

```lua
divergence = {
    op_id = "uuid",
    peer_a = { result = "hostname-a", success = true },
    peer_b = { result = "hostname-b", success = true },
    diverged = true,
    reconciled = false  -- never fully true
}
```

## Context: Maximal Scope

Anything we can access:
- Filesystem (files, directories, permissions)
- Environment variables
- Running processes
- Network state
- Conversation history
- System info (hostname, OS, resources)
- Time, locale, user

```lua
local_context = {
    fs = { ... },
    env = os.getenv,
    proc = { ... },
    net = { ... },
    conv = { messages = {...} },
    sys = { hostname = "...", os = "...", user = "..." },
    time = os.time
}
```

## Protocol: WebSocket + JSON

### Connection
```
ws://192.168.x.x:16181/peer
```

Hardcoded IP:port. Manager layer deferred.

### Message Types

```lua
-- Handshake
{ type = "hello", peer_id = "uuid", capabilities = {...} }
{ type = "hello_ack", peer_id = "uuid", session_id = "uuid" }

-- Operation exchange
{ type = "op", op = { id, name, args, origin, timestamp } }
{ type = "op_ack", op_id = "uuid" }

-- Result sharing
{ type = "result", op_id = "uuid", result = {...}, success = bool }

-- Divergence notification
{ type = "divergence", op_id = "uuid", local_result = {...}, remote_result = {...} }

-- Sync
{ type = "sync_request", since = timestamp }
{ type = "sync_response", ops = [...], results = [...] }
```

## Execution Model

```
┌────────────────────────────────────────────────────────────┐
│                    PEER NODE                               │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────┐     ┌──────────────┐                    │
│  │ WebSocket    │────►│ Op Router    │                    │
│  │ Server/Client│     └──────┬───────┘                    │
│  └──────────────┘            │                            │
│         ▲                    ▼                            │
│         │            ┌──────────────┐                     │
│         │            │ Op Queue     │ (ordered by time)   │
│         │            └──────┬───────┘                     │
│         │                   │                             │
│         │                   ▼                             │
│         │            ┌──────────────┐                     │
│         │            │ Executor     │                     │
│         │            │ - tool calls │                     │
│         │            │ - local ctx  │                     │
│         │            └──────┬───────┘                     │
│         │                   │                             │
│         │                   ▼                             │
│         │            ┌──────────────┐                     │
│         │            │ Result Store │                     │
│         │            │ - per op_id  │                     │
│         │            │ - track div  │                     │
│         │            └──────┬───────┘                     │
│         │                   │                             │
│         └───────────────────┘ (broadcast results)         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## File Structure

```
core/
├── peer.lua           # WebSocket peer connection management
├── operation.lua      # Operation creation, validation, serialization
├── executor.lua       # Execute ops against local context
├── divergence.lua     # Track and report divergences
└── context.lua        # Local context access (fs, env, proc, etc.)

.chat_sessions/
├── peers.json         # Known peers (ip:port, last seen)
├── ops/               # Operation log (append-only)
│   └── {session_id}.jsonl
└── divergences/       # Divergence records
    └── {session_id}.json
```

## Implementation Plan

### Phase 1: Core Abstractions
- [ ] `operation.lua` - op creation, serialization
- [ ] `context.lua` - local context interface
- [ ] `executor.lua` - execute op against context

### Phase 2: Peer Communication
- [ ] `peer.lua` - WebSocket client/server
- [ ] Message routing and acknowledgment
- [ ] Op queue and ordering

### Phase 3: Divergence Tracking
- [ ] `divergence.lua` - compare results, track differences
- [ ] Never reconcile fully (probabilistic truth)
- [ ] Surface divergences to user/log

### Phase 4: Integration
- [ ] Hook into existing Chat:send() for message ops
- [ ] Hook into tool execution for tool_call ops
- [ ] CLI: `--peer <ip:port>` to connect

## Configuration

```lua
-- config/peer_config.lua
return {
    listen_port = 16181,
    peer_address = nil,  -- or "192.168.0.x:16181"
    peer_id = nil,       -- auto-generated UUID
    op_log_dir = ".chat_sessions/ops",
    divergence_log = ".chat_sessions/divergences",
    context_scope = {
        fs = true,
        env = true,
        proc = true,
        net = false,  -- opt-in
    }
}
```

## Lifecycle: Rapid Debug Adjustment

```
1. Start peer A: ./chatbot.lua --peer-listen 16181
2. Start peer B: ./chatbot.lua --peer-connect 192.168.0.x:16181

3. User on A types message
   → op created: { type: "tool_call", name: "send_message", args: {text: "..."} }
   → sent to B
   → both execute locally
   → results compared
   → divergence tracked if different

4. Tool call on B
   → op created, sent to A
   → both execute
   → compare

5. Hot reload: edit code → restart peer → sync ops from log → resume
```

## Decisions Made

| Question | Answer |
|----------|--------|
| Protocol | WebSocket |
| Operations | Everything is a tool call |
| Truth | Track divergence, never collapse |
| Context | Maximal (fs, env, proc, anything) |
| Discovery | Hardcoded IP:port (manager later) |
| Results | Shared, externalized, network-ready |

---

## Extension: Distributed LLM Inference

Beyond operation exchange, peers can share computation itself. Run half a model on each GPU.

```
.-------------------.                      .-------------------.
|     MACHINE A     |                      |     MACHINE B     |
|   GPU: Layers 0-15|   activation sync    |   GPU: Layers 16-31
|                   |                      |                   |
|  [embedding]      |                      |                   |
|  [layer 0-15]     |                      |                   |
|       │           |                      |                   |
|       └───────────┼─► activations ──────►│  [layer 16-31]   |
|                   |                      |  [lm_head]        |
|                   |◄────── tokens ───────┼──────┘            |
'-------------------'                      '-------------------'
```

### Pipeline Parallelism

- Machine A: layers 0 to N (first half)
- Machine B: layers N+1 to end (second half)
- Sync point: activation tensor after layer N
- Output tokens streamed to both peers

### File Structure

```
core/distributed/
├── tensor.lua        # Tensor serialization for network
├── coordinator.lua   # Manages distributed inference sessions
└── (future: llama_bridge.lua)
```

### Activation Transfer

```lua
{
    type = "infer_act",
    session_id = "uuid",
    layer = 15,
    tensor = {
        shape = [1, 2048, 4096],
        dtype = "float16",
        data = "<base64 or binary>",
        checksum = "xxxx"
    }
}
```

### Bandwidth Requirements

| Seq Length | Hidden 4096 | @ 1Gbps | @ 10Gbps |
|------------|-------------|---------|----------|
| 512        | 4 MB        | 32ms    | 3.2ms    |
| 2048       | 16 MB       | 128ms   | 12.8ms   |
| 8192       | 64 MB       | 512ms   | 51.2ms   |

Best for: long sequences, large models, batch inference.

### Integration

Both peers see tokens as generated. Neither machine could run the full model alone. Together, they improvise the output.

See: `records/2026-02-05-distributed-inference.md` for full design.

---

*Two layers of distribution: operations (what to do) and computation (how to think).*
