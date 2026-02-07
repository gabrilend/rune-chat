# Async Threadpool Library Specification

## 1. Overview

A general-purpose C threadpool library using pthreads, designed for language-agnostic task execution via JSON bytecode. Programs import the library and provide a project-specific config file defining available operations.

### Design Philosophy

- **Language agnostic:** JSON bytecode interface allows any language to submit tasks
- **Lock-minimal:** Prefer optimistic concurrency with post-hoc validation over mutexes
- **Compile-per-project:** Each application compiles with its own handler dispatch table
- **Dynamically scalable:** Ring buffers grow as needed; updater threads spawn on demand

---

## 2. Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           THREADPOOL                                     │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      TASK LIST (Ring Buffer)                     │    │
│  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐  │    │
│  │  │ slot[0] │ slot[1] │ slot[2] │ slot[3] │  ...    │ slot[N] │  │    │
│  │  │ UPDATER │  task   │  task   │  task   │         │  task   │  │    │
│  │  └────┬────┴────┬────┴────┬────┴────┬────┴─────────┴────┬────┘  │    │
│  └───────│─────────│─────────│─────────│───────────────────│───────┘    │
│          │         │         │         │                   │            │
│          ▼         ▼         ▼         ▼                   ▼            │
│  ┌───────────┐ ┌───────┐ ┌───────┐ ┌───────┐           ┌───────┐       │
│  │ Worker[0] │ │  W[1] │ │  W[2] │ │  W[3] │    ...    │  W[N] │       │
│  │ (updater) │ │       │ │       │ │       │           │       │       │
│  │ ┌───────┐ │ │ ┌───┐ │ │ ┌───┐ │ │ ┌───┐ │           │ ┌───┐ │       │
│  │ │Mailbox│ │ │ │ M │ │ │ │ M │ │ │ │ M │ │           │ │ M │ │       │
│  │ └───────┘ │ └─┴───┴─┘ └─┴───┴─┘ └─┴───┴─┘           └─┴───┴─┘       │
│  └───────────┘                                                          │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    SYMBOL TABLE (Hashtable)                      │    │
│  │              "response_buffer" → 0x7fff1234                      │    │
│  │              "request_data"    → 0x7fff5678                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    RESULT QUEUE (Ring Buffer)                    │    │
│  │              For returning values to callers                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Data Structures

### 3.1 Task Structure

```c
typedef struct task {
    uint32_t  opcode;           // Index into dispatch table
    void*     args;             // Pointer to argument blob
    uint32_t  assigned_to;      // Thread ID that owns this task (0 = unclaimed)
    uint32_t  flags;            // is_complete, has_error, etc.
    uint64_t  task_id;          // Unique identifier for result correlation
    void*     result;           // Pointer to result data (if any)
    uint32_t  result_size;      // Size of result data
} task_t;
```

### 3.2 Worker Thread Structure

```c
typedef struct worker {
    pthread_t  thread;
    uint32_t   thread_id;
    uint32_t   is_active;       // 0 = dormant, 1 = running
    uint32_t   task_iter;       // Current position in task list
    mailbox_t* mailbox;         // Per-worker JSON inbox
} worker_t;
```

### 3.3 Mailbox Structure

```c
typedef struct mailbox {
    char*     buffer;           // JSON string storage
    uint32_t  capacity;
    uint32_t  head;
    uint32_t  tail;
    uint32_t  count;
    uint32_t  owner_id;         // Thread currently processing (0 = unowned)
} mailbox_t;
```

### 3.4 Threadpool Structure

```c
typedef struct threadpool {
    task_t*           task_list;
    uint32_t          task_capacity;
    uint32_t          task_count;

    worker_t*         workers;
    uint32_t          worker_count;

    symbol_table_t*   symbols;          // Named memory regions
    result_queue_t*   results;          // Completed task results

    handler_fn*       dispatch_table;   // Opcode → function mapping
    uint32_t          dispatch_size;

    uint32_t          shutdown_requested;
} threadpool_t;
```

---

## 4. Conditional Dispatch Pattern

The design uses `A*B+(1-A)*C` as a branchless selection idiom. Since B and C may be function indices (not pointers), implementation uses a dispatch table:

```c
// dispatch_table is an array of function pointers
// A is 0 or 1, B and C are indices
typedef void (*action_fn)(void* ctx);

static inline void dispatch(action_fn* table, int A, int B, int C, void* ctx) {
    table[A * B + (1 - A) * C](ctx);
}

// Example: select between "check next slot" (index 0) and "insert here" (index 1)
// If slot_taken (A=1): call table[1*0 + 0*1] = table[0] = check_next
// If slot_free (A=0):  call table[0*0 + 1*1] = table[1] = insert_here
```

Alternative readable form when clarity matters more than branchlessness:
```c
table[A ? B : C](ctx);
```

---

## 5. Task Assignment (Optimistic Concurrency)

Workers claim tasks using an optimistic two-phase check:

```c
void worker_claim_task(worker_t* w, task_t* task) {
    // Phase 1: Attempt to claim
    if (task->assigned_to != 0) {
        // Already claimed, skip to next
        w->task_iter = (w->task_iter + 1) % pool->task_capacity;
        return;
    }

    task->assigned_to = w->thread_id;

    // Phase 2: Copy task data to local memory
    task_t local_copy = *task;

    // Phase 3: Verify ownership wasn't stolen
    if (task->assigned_to != w->thread_id) {
        // Another thread grabbed it, discard copy and move on
        w->task_iter = (w->task_iter + 1) % pool->task_capacity;
        return;
    }

    // We own it - execute
    execute_task(w, &local_copy);

    // Mark slot as free
    task->assigned_to = 0;
    task->flags |= FLAG_COMPLETE;
}
```

**Rationale:** Rare duplicated work is acceptable; avoiding mutex overhead on every task claim improves throughput for the common case.

---

## 6. Updater Thread Behavior

### 6.1 Basic Operation

The updater (always at task_list[0]) performs:
1. Scan all worker mailboxes
2. Parse JSON from each mailbox (FIFO)
3. Convert JSON to task struct
4. Insert task into next free slot in task list
5. Wake dormant workers as needed

### 6.2 Scalable Updaters

When one updater becomes a bottleneck:

1. Spawn additional updater tasks into the task list
2. Each updater owns a **domain** (subset of mailboxes)
3. Domain boundaries stored in updater's local state
4. After each cycle, if an updater inserted 0 tasks:
   - It terminates (doesn't re-queue itself)
   - Remaining updaters expand their domains
5. Minimum: 1 updater always exists at slot[0]

**Mailbox ownership during update:**
```c
void updater_process_mailbox(worker_t* w, mailbox_t* mb) {
    // Claim ownership
    if (mb->owner_id != 0) return;  // Another updater has it
    mb->owner_id = w->thread_id;

    // Read JSON
    char* json = mailbox_pop(mb);
    if (!json) {
        mb->owner_id = 0;
        return;
    }

    // Parse and prepare task
    task_t new_task = parse_json_to_task(json);

    // Verify still owner before inserting
    if (mb->owner_id != w->thread_id) {
        // Lost ownership, discard work
        free(json);
        return;
    }

    insert_task_to_list(new_task);
    mb->owner_id = 0;
    free(json);
}
```

---

## 7. Thread Lifecycle

### 7.1 Initialization

```c
threadpool_t* threadpool_create(const char* config_path) {
    config_t cfg = parse_config(config_path);

    threadpool_t* pool = malloc(sizeof(threadpool_t));
    pool->worker_count = cfg.thread_count;
    pool->workers = calloc(pool->worker_count, sizeof(worker_t));
    pool->task_list = calloc(cfg.initial_task_capacity, sizeof(task_t));
    pool->dispatch_table = cfg.handlers;
    pool->symbols = symbol_table_create();
    pool->results = result_queue_create();

    // Create all workers in dormant state
    for (int i = 0; i < pool->worker_count; i++) {
        pool->workers[i].thread_id = i + 1;  // 0 reserved for "unclaimed"
        pool->workers[i].is_active = 0;
        pool->workers[i].mailbox = mailbox_create();
        pthread_create(&pool->workers[i].thread, NULL, worker_loop, &pool->workers[i]);
    }

    // Install updater task at slot[0]
    pool->task_list[0].opcode = OPCODE_UPDATER;
    pool->task_list[0].assigned_to = 0;

    return pool;
}
```

### 7.2 Worker Loop

```c
void* worker_loop(void* arg) {
    worker_t* w = (worker_t*)arg;

    while (!pool->shutdown_requested) {
        if (!w->is_active) {
            // Dormant: wait for wakeup signal
            worker_sleep(w);
            continue;
        }

        task_t* task = &pool->task_list[w->task_iter];
        worker_claim_task(w, task);

        // Advance iterator
        w->task_iter = (w->task_iter + 1) % pool->task_capacity;

        // If we looped back to 0, we might run the updater
        if (w->task_iter == 0) {
            // Updater task is at slot[0], attempt to claim it
        }
    }

    return NULL;
}
```

### 7.3 Dormancy and Wakeup

**Open question:** Use condition variables or simple flag polling?

**Option A: Condition Variables (CPU efficient)**
```c
void worker_sleep(worker_t* w) {
    pthread_mutex_lock(&pool->wake_mutex);
    while (!w->is_active && !pool->shutdown_requested) {
        pthread_cond_wait(&pool->wake_cond, &pool->wake_mutex);
    }
    pthread_mutex_unlock(&pool->wake_mutex);
}

void worker_wake(worker_t* w) {
    w->is_active = 1;
    pthread_cond_signal(&pool->wake_cond);
}
```

**Option B: Spin with Yield (simpler, slightly more CPU)**
```c
void worker_sleep(worker_t* w) {
    while (!w->is_active && !pool->shutdown_requested) {
        sched_yield();  // or usleep(100)
    }
}

void worker_wake(worker_t* w) {
    w->is_active = 1;  // Worker will see this on next spin
}
```

**Recommendation:** Start with Option B for simplicity. If CPU usage becomes a concern, migrate to Option A.

### 7.4 Shutdown

```c
void threadpool_shutdown(threadpool_t* pool) {
    // 1. Stop accepting new tasks
    pool->shutdown_requested = 1;

    // 2. Wake all dormant workers
    for (int i = 0; i < pool->worker_count; i++) {
        worker_wake(&pool->workers[i]);
    }

    // 3. Wait for all workers to exit
    for (int i = 0; i < pool->worker_count; i++) {
        pthread_join(pool->workers[i].thread, NULL);
    }

    // 4. Free resources
    for (int i = 0; i < pool->worker_count; i++) {
        mailbox_destroy(pool->workers[i].mailbox);
    }
    free(pool->workers);
    free(pool->task_list);
    symbol_table_destroy(pool->symbols);
    result_queue_destroy(pool->results);
    free(pool);
}
```

---

## 8. Memory Management

### 8.1 Ownership Rules

| Resource | Allocator | Freer | Notes |
|----------|-----------|-------|-------|
| Task argument blob | Threadpool (during JSON parse) | Worker (after execution) | Copied from JSON, freed when done |
| Task slot | Never freed | N/A | Part of ring buffer, reused |
| Result data | Worker (during execution) | Caller (after retrieval) | Placed in result queue |
| Mailbox JSON strings | External submitter | Updater (after parse) | FIFO consumption |

### 8.2 Ring Buffer Growth

When the task list is full:

```c
void task_list_grow(threadpool_t* pool) {
    uint32_t new_capacity = pool->task_capacity * 2;
    task_t* new_list = realloc(pool->task_list, new_capacity * sizeof(task_t));

    // Zero out new slots
    memset(&new_list[pool->task_capacity], 0,
           (new_capacity - pool->task_capacity) * sizeof(task_t));

    pool->task_list = new_list;
    pool->task_capacity = new_capacity;
}
```

**Note:** Growth must be coordinated to avoid workers accessing invalid memory. Options:
1. Pause all workers during growth (simple, brief stall)
2. Double-buffer with atomic pointer swap (complex, no stall)

**Recommendation:** Start with option 1.

---

## 9. Return Values and Results

### 9.1 Result Queue

Tasks that produce output write to a result queue:

```c
typedef struct result {
    uint64_t  task_id;        // Correlates with original submission
    int32_t   status;         // 0 = success, negative = error code
    void*     data;           // Result payload
    uint32_t  data_size;
    char      error_msg[256]; // If status < 0
} result_t;

typedef struct result_queue {
    result_t* buffer;
    uint32_t  capacity;
    uint32_t  head;
    uint32_t  tail;
    pthread_mutex_t mutex;    // Results are written less frequently, mutex OK
} result_queue_t;
```

### 9.2 Retrieval Methods

**Synchronous (blocking):**
```c
result_t* threadpool_wait_result(threadpool_t* pool, uint64_t task_id, uint32_t timeout_ms);
```

**Asynchronous (polling):**
```c
result_t* threadpool_poll_result(threadpool_t* pool, uint64_t task_id);
// Returns NULL if not ready
```

**Callback (set at submission time):**
```c
typedef void (*result_callback_fn)(result_t* result, void* user_data);

uint64_t threadpool_submit_with_callback(
    threadpool_t* pool,
    const char* json,
    result_callback_fn callback,
    void* user_data
);
```

**Recommendation:** Implement polling first (simplest), add callbacks as an optimization for the LLM streaming use case.

---

## 10. Symbol Table (Named Memory Regions)

### 10.1 Structure

```c
typedef struct symbol_entry {
    char      name[64];
    void*     ptr;
    uint32_t  size;
    uint32_t  flags;    // read-only, write-only, read-write
} symbol_entry_t;

typedef struct symbol_table {
    symbol_entry_t** buckets;
    uint32_t         bucket_count;
    pthread_rwlock_t lock;  // Read-heavy, write-rare
} symbol_table_t;
```

### 10.2 Operations

```c
// Register a named region
void symbol_register(symbol_table_t* st, const char* name, void* ptr, uint32_t size);

// Lookup by name (returns NULL if not found)
void* symbol_resolve(symbol_table_t* st, const char* name, uint32_t* out_size);

// Unregister
void symbol_unregister(symbol_table_t* st, const char* name);
```

### 10.3 JSON Bytecode Reference

```json
{
    "opcode": 3,
    "args": {
        "write_to": "response_buffer",
        "data": "Hello, world!"
    }
}
```

The updater resolves `"response_buffer"` → `0x7fff1234` before creating the task struct.

---

## 11. Error Handling

### 11.1 Error Sources

| Source | Handling |
|--------|----------|
| JSON parse failure | Log error, skip malformed entry, continue |
| Unknown opcode | Write error result, mark task complete |
| Handler crash (SIGSEGV) | Worker catches signal, writes error result, continues |
| malloc failure | Retry with backoff, then write error result |
| Symbol not found | Write error result with "unknown symbol: X" |

### 11.2 Error Propagation

Errors are reported via the result queue:

```c
void report_error(threadpool_t* pool, uint64_t task_id, int code, const char* msg) {
    result_t err = {
        .task_id = task_id,
        .status = code,
        .data = NULL,
        .data_size = 0
    };
    strncpy(err.error_msg, msg, sizeof(err.error_msg) - 1);
    result_queue_push(pool->results, &err);
}
```

### 11.3 Error Codes

```c
#define ERR_SUCCESS          0
#define ERR_UNKNOWN_OPCODE  -1
#define ERR_INVALID_JSON    -2
#define ERR_SYMBOL_NOT_FOUND -3
#define ERR_MALLOC_FAILED   -4
#define ERR_HANDLER_CRASH   -5
#define ERR_TIMEOUT         -6
```

---

## 12. Config File Format

Runtime-parsed text file at `config/config`:

```ini
# Threadpool configuration
thread_count=4
initial_task_capacity=256
result_queue_capacity=128

# Handler registration (opcode=handler_name)
# Handler names must match symbols exported by the compiled binary
0=handler_updater
1=handler_http_get
2=handler_http_post
3=handler_write_memory
4=handler_read_memory
5=handler_file_read
6=handler_file_write
```

### 12.1 Handler Registration

At compile time, the application defines handlers:

```c
// handlers.c
void handler_http_get(task_t* task) { /* ... */ }
void handler_http_post(task_t* task) { /* ... */ }
// ...

// Dispatch table built from config at startup
handler_fn dispatch_table[MAX_OPCODES];

void load_handlers(config_t* cfg) {
    // Map handler names to function pointers
    handler_map_t map[] = {
        {"handler_updater",     handler_updater},
        {"handler_http_get",    handler_http_get},
        {"handler_http_post",   handler_http_post},
        // ...
    };

    for (int i = 0; i < cfg->handler_count; i++) {
        int opcode = cfg->handlers[i].opcode;
        const char* name = cfg->handlers[i].name;
        dispatch_table[opcode] = lookup_handler(map, name);
    }
}
```

---

## 13. External Interface

### 13.1 Mailbox Submission (File-Based)

For non-speed-critical tasks or one-shot programs:

```
/tmp/threadpool-{pid}/mailbox-{worker_id}.json
```

External program appends JSON line:
```bash
echo '{"opcode": 1, "task_id": 42, "args": {"url": "http://example.com"}}' \
    >> /tmp/threadpool-12345/mailbox-1.json
```

Updater watches files with `inotify` or periodic polling.

### 13.2 Shared Memory (High-Speed)

For integrated programs:

```c
// External program
#include "threadpool.h"

int main() {
    threadpool_t* pool = threadpool_attach("myapp");  // Attach to existing pool

    uint64_t task_id = threadpool_submit(pool,
        "{\"opcode\": 1, \"args\": {\"url\": \"http://example.com\"}}");

    result_t* result = threadpool_wait_result(pool, task_id, 5000);
    // ...
}
```

### 13.3 Lua FFI Bindings

For the chatbot use case:

```lua
local ffi = require("ffi")
ffi.cdef[[
    typedef struct threadpool threadpool_t;
    typedef struct result result_t;

    threadpool_t* threadpool_create(const char* config_path);
    void threadpool_shutdown(threadpool_t* pool);
    uint64_t threadpool_submit(threadpool_t* pool, const char* json);
    result_t* threadpool_poll_result(threadpool_t* pool, uint64_t task_id);
    void threadpool_result_free(result_t* result);
]]

local tp = ffi.load("threadpool")
local pool = tp.threadpool_create("config/config")

local task_id = tp.threadpool_submit(pool, '{"opcode": 1, "args": {...}}')

-- Poll in main loop
while true do
    local result = tp.threadpool_poll_result(pool, task_id)
    if result ~= nil then
        -- Process result
        tp.threadpool_result_free(result)
        break
    end
    -- Do other work...
end
```

---

## 14. Open Questions

1. **Signal handling for crashed handlers:** Use `sigsetjmp`/`siglongjmp` to recover from SIGSEGV within a handler? Or let the whole worker die and respawn it?

2. **Task priorities:** Should some tasks (like the updater) have priority over others? Or is round-robin sufficient?

3. **Memory pressure:** What happens if result queue fills up? Block workers? Drop old results? Grow dynamically?

4. **Streaming results:** For LLM streaming, should there be a "partial result" mechanism? Multiple result entries per task_id?

---

## 15. Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Task list ring buffer
- [ ] Worker thread creation/dormancy
- [ ] Basic task claiming (optimistic)
- [ ] Single updater at slot[0]

### Phase 2: Communication
- [ ] Mailbox implementation
- [ ] JSON parsing (use cJSON or similar)
- [ ] Result queue
- [ ] Symbol table

### Phase 3: Integration
- [ ] Config file parser
- [ ] Dispatch table loader
- [ ] File-based mailbox submission
- [ ] Basic error handling

### Phase 4: Optimization
- [ ] Scalable updaters
- [ ] Condition variable wakeup
- [ ] Ring buffer growth
- [ ] Lua FFI bindings

### Phase 5: Streaming Support
- [ ] Partial/streaming results
- [ ] HTTP chunked response handler
- [ ] Integration with fuzzy-computing.lua
