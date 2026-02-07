# API Input Design

## Purpose

Add the ability to accept text from arbitrary inputs, API-style. Decouple input source from chat processing. Enable programmatic, networked, and multi-client access to the chatbot.

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    INPUT SOURCES                        │
├─────────────────────────────────────────────────────────┤
│ readline.lua    │ Interactive terminal, history, multi- │
│                 │ line, cursor movement                 │
├─────────────────────────────────────────────────────────┤
│ bash/chat.sh    │ Unix socket client, named pipes,      │
│                 │ daemon process (chat_daemon.lua)      │
├─────────────────────────────────────────────────────────┤
│ lua/chat.lua    │ Programmatic Lua wrapper, async/sync  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    PROCESSING                           │
├─────────────────────────────────────────────────────────┤
│ UI:read_input() │ Receives plain string                 │
│ Chat:send()     │ Adds to context, calls LLM, tools     │
│ StreamFormatter │ Real-time output formatting           │
└─────────────────────────────────────────────────────────┘
```

## Design Problem: API Input Layer

### Abstraction Level 0: What is "API-style"?

Questions to resolve:
1. **Protocol**: HTTP REST? WebSocket? Unix socket? Named pipe? All?
2. **Format**: JSON envelope? Plain text? Streaming?
3. **Session**: Stateless (context per-request)? Stateful (persistent sessions)?
4. **Scope**: Local-only? Network-accessible?

### Abstraction Level 1: Context Storage

Current: In-memory only (lives with process)

Options:
```
┌────────────────────────────────────────────────────────┐
│ A. Ephemeral     │ Context dies with connection       │
│ B. Session file  │ JSON/msgpack file per session ID   │
│ C. SQLite        │ Structured, queryable              │
│ D. Shared memory │ Fast, multi-process access         │
└────────────────────────────────────────────────────────┘
```

Session identification:
- Generated UUID
- Client-provided ID
- Connection-based (socket fd)

### Abstraction Level 2: Input Abstraction Interface

```lua
-- Proposed interface for input sources
InputSource = {
    -- Returns next message (blocking or callback-based)
    read = function(self) -> string | nil, err

    -- Send response back to this source
    write = function(self, text) -> bool, err

    -- Metadata
    session_id = function(self) -> string
    source_type = function(self) -> "terminal" | "http" | "socket" | "pipe"

    -- Lifecycle
    close = function(self)
}
```

### Abstraction Level 3: API Server Component

```
┌─────────────────────────────────────────────────────────┐
│                   API SERVER                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ HTTP/REST   │  │ WebSocket   │  │ Unix Socket │     │
│  │ :8080/chat  │  │ :8080/ws    │  │ /tmp/chat   │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          ▼                              │
│              ┌───────────────────┐                      │
│              │ Request Router    │                      │
│              │ - Parse JSON      │                      │
│              │ - Validate        │                      │
│              │ - Extract session │                      │
│              └─────────┬─────────┘                      │
│                        ▼                                │
│              ┌───────────────────┐                      │
│              │ Session Manager   │                      │
│              │ - Load context    │                      │
│              │ - Create new      │                      │
│              │ - Persist         │                      │
│              └─────────┬─────────┘                      │
│                        ▼                                │
│              ┌───────────────────┐                      │
│              │ Chat:send()       │                      │
│              │ (existing core)   │                      │
│              └───────────────────┘                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Request/Response Format (Draft)

### Request
```json
{
    "message": "Hello, chatbot",
    "session_id": "uuid-or-null-for-new",
    "options": {
        "stream": true,
        "model": "override-model",
        "system": "optional system prompt"
    }
}
```

### Response (non-streaming)
```json
{
    "session_id": "assigned-or-existing",
    "response": "Hello! How can I help?",
    "tool_calls": [...],
    "usage": { "prompt_tokens": 10, "completion_tokens": 20 }
}
```

### Response (streaming)
```
data: {"type": "token", "content": "Hello"}
data: {"type": "token", "content": "!"}
data: {"type": "thinking", "content": "..."}
data: {"type": "tool_call", "name": "read_file", "args": {...}}
data: {"type": "done", "session_id": "..."}
```

## Context Storage Design

### File-based (simple, portable)
```
.chat_sessions/
├── index.json          # session_id -> metadata mapping
├── abc123.json         # full context for session abc123
├── def456.json
└── ...
```

### Session Metadata
```json
{
    "session_id": "abc123",
    "created_at": "2026-02-05T10:00:00Z",
    "last_active": "2026-02-05T10:05:00Z",
    "message_count": 12,
    "model": "ministral-3:14b"
}
```

## Implementation Phases

### Phase 1: Input Abstraction
- [ ] Define `InputSource` interface
- [ ] Refactor terminal input to implement interface
- [ ] Refactor existing bash wrapper to implement interface

### Phase 2: Session/Context Persistence
- [ ] Design session storage format
- [ ] Implement save/load context
- [ ] Add session management (create, resume, list, delete)

### Phase 3: HTTP API Server
- [ ] Add HTTP server (luasocket or luvit)
- [ ] Implement `/chat` endpoint
- [ ] Implement streaming via SSE or chunked transfer

### Phase 4: Integration
- [ ] Unified server serving multiple protocols
- [ ] CLI flag to start in API mode vs interactive mode
- [ ] Configuration for API settings

## Open Questions

1. Should the API server be a separate process or integrated into chatbot.lua?
2. Authentication for network access?
3. Rate limiting?
4. Maximum context size / truncation strategy?
5. How to handle tool execution in API mode (some tools are interactive)?

## Dependencies

- `luasocket` - already present for HTTP client
- Potentially: `lua-http` or `luvit` for full HTTP server
- JSON: `dkjson` already present

---

*Document created for iterative design refinement. Each section will be expanded as decisions are made.*
