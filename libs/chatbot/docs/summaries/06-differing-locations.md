# Summary: "Differing Locations" and Model Diversity

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

Analysis of the phrase "faster, less powerful models that are approaching from differing locations."

## Key Points

### Ensemble Strategy
- Multiple smaller models attack the problem simultaneously
- Different starting points prevent groupthink
- Resembles genetic algorithms or beam search

### What "Differing Locations" Could Mean

| Dimension | Variation Examples |
|-----------|-------------------|
| Temperature | 0.2 vs 0.7 vs 1.0 |
| System prompt | "Be concise" vs "Be thorough" vs "Be creative" |
| Model size | 3B vs 7B vs 13B |
| Fine-tuning | Base vs code-tuned vs instruction-tuned |

### Aggregation Pattern
- Each worker runs independently
- Supervisor aggregates results
- Solutions compared, merged, or voted upon

### Performance Trade-off
- Speed gain from smaller models
- Offsets overhead of multiple runs
- **Embarrassingly parallel** - no coordination needed during generation

## Architecture Implication

The system is inherently distributed. Single-model iteration is one strategy; multi-model ensemble is another. The original request seems to favor the latter.

---

## Pass 1: Problem Identification

### Problem 20: Worker Pool Architecture

How do we manage multiple worker models running in parallel?

```json
{
  "problem_id": "P020",
  "name": "worker_pool_architecture",
  "description": "How do we structure and manage parallel workers?",
  "constraints": [
    "Must support heterogeneous workers (different models)",
    "Should handle worker failures gracefully",
    "Must aggregate results efficiently"
  ],
  "architecture": {
    "pool_manager": {
      "role": "Maintains list of available workers",
      "responsibilities": [
        "Health checking",
        "Load balancing",
        "Failure recovery"
      ]
    },
    "worker": {
      "role": "Executes single requests",
      "properties": {
        "model": "string - which LLM",
        "endpoint": "string - API URL",
        "config": "object - temperature, etc.",
        "location_id": "string - identifies its 'location'"
      }
    },
    "dispatcher": {
      "role": "Sends requests to workers",
      "strategy": "broadcast (all workers) or sample (subset)"
    },
    "aggregator": {
      "role": "Combines worker responses",
      "methods": ["voting", "merging", "selection"]
    }
  },
  "status": "open"
}
```

**Explanation**: The pool architecture enables the "differing locations" strategy. Each worker represents a different location (model + config combination). The dispatcher sends the same request to multiple workers; the aggregator combines their responses.

---

### Problem 21: Location Configuration

How do we define and configure "locations" (model + settings combinations)?

```json
{
  "problem_id": "P021",
  "name": "location_configuration",
  "description": "How do we specify different worker configurations?",
  "constraints": [
    "Must be declarative and versionable",
    "Should support easy experimentation",
    "Must validate configurations"
  ],
  "location_schema": {
    "location": {
      "id": "string - unique identifier",
      "name": "string - human-readable",
      "model": {
        "provider": "ollama | openai | anthropic | local",
        "model_id": "string - e.g., 'nemotron-3-nano'",
        "endpoint": "string - API URL"
      },
      "parameters": {
        "temperature": "number 0-2",
        "top_p": "number 0-1",
        "max_tokens": "number",
        "system_prompt_prefix": "string"
      },
      "tags": ["fast", "creative", "precise", "etc"]
    }
  },
  "example_locations": [
    {
      "id": "precise-cold",
      "name": "Precise (Low Temperature)",
      "model": {"provider": "ollama", "model_id": "nemotron-3-nano"},
      "parameters": {"temperature": 0.2},
      "tags": ["precise", "deterministic"]
    },
    {
      "id": "creative-hot",
      "name": "Creative (High Temperature)",
      "model": {"provider": "ollama", "model_id": "nemotron-3-nano"},
      "parameters": {"temperature": 0.9},
      "tags": ["creative", "exploratory"]
    },
    {
      "id": "thorough-large",
      "name": "Thorough (Larger Model)",
      "model": {"provider": "ollama", "model_id": "llama-7b"},
      "parameters": {"temperature": 0.5},
      "tags": ["thorough", "slow"]
    }
  ],
  "status": "open"
}
```

**Explanation**: Locations are the "differing starting points." By defining them declaratively, we can easily add, remove, or modify locations without code changes. Tags help the dispatcher select appropriate locations for different tasks.

---

### Problem 22: Result Aggregation

How do we combine results from multiple workers into a single coherent output?

```json
{
  "problem_id": "P022",
  "name": "result_aggregation",
  "description": "How do we merge outputs from parallel workers?",
  "constraints": [
    "Must handle disagreement",
    "Should produce coherent output",
    "Must be deterministic given same inputs"
  ],
  "aggregation_strategies": {
    "majority_vote": {
      "description": "Select output that most workers agree on",
      "use_case": "Binary decisions, simple outputs",
      "handling_ties": "Prefer output from higher-confidence worker"
    },
    "weighted_vote": {
      "description": "Weight votes by worker confidence or historical accuracy",
      "use_case": "When some workers are known to be better",
      "weights": "Configurable per location"
    },
    "union_merge": {
      "description": "Combine all unique suggestions",
      "use_case": "Collecting issues or ideas",
      "deduplication": "Semantic similarity check"
    },
    "supervisor_selection": {
      "description": "Present all options to supervisor, let it choose",
      "use_case": "Complex decisions, high stakes",
      "fallback": "If supervisor unsure, escalate to user"
    }
  },
  "output_format": {
    "selected": "the chosen output",
    "alternatives": "other outputs considered",
    "agreement_score": "0-1, how much workers agreed",
    "contributing_locations": "which workers influenced result"
  },
  "status": "open"
}
```

**Explanation**: Multiple workers produce multiple outputs. Aggregation distills these into one. The strategy depends on context: voting for simple decisions, union for brainstorming, supervisor selection for complex choices. The agreement score helps downstream processing know how confident to be.

---

### Problem 23: Parallel Execution Coordination

How do we efficiently coordinate parallel LLM requests?

```json
{
  "problem_id": "P023",
  "name": "parallel_execution_coordination",
  "description": "How do we run multiple LLM calls concurrently?",
  "constraints": [
    "Must not exceed rate limits",
    "Should maximize throughput",
    "Must handle partial failures"
  ],
  "execution_model": {
    "concurrency": {
      "max_concurrent_requests": "configurable, default 4",
      "per_endpoint_limit": "respect provider rate limits",
      "backoff_strategy": "exponential with jitter"
    },
    "timeout": {
      "per_request": "30 seconds default",
      "total_batch": "5 minutes default",
      "on_timeout": "return partial results, log warning"
    },
    "failure_handling": {
      "retry_count": 2,
      "retry_delay": "exponential backoff",
      "partial_success": "aggregate whatever succeeded"
    }
  },
  "lua_implementation_notes": {
    "approach": "Use coroutines + socket.select for async",
    "libraries": ["socket", "copas (optional)"],
    "challenge": "LuaJIT single-threaded, need async I/O"
  },
  "status": "open"
}
```

**Explanation**: Lua/LuaJIT is single-threaded, so true parallelism requires async I/O. We can use coroutines with socket.select to multiplex requests. Rate limiting and failure handling are essential for reliability when hitting external APIs.

---

## Dependencies Graph

```
P020 (worker_pool_architecture)
  ├── P021 (location_configuration)
  ├── P022 (result_aggregation)
  └── P023 (parallel_execution_coordination)
```

---

## Pass 1 Summary

Four problems identified:
1. **P020**: Worker pool architecture - managing parallel workers
2. **P021**: Location configuration - defining model+settings combinations
3. **P022**: Result aggregation - combining multiple outputs
4. **P023**: Parallel execution coordination - async LLM requests in Lua

---

---

## Pass 2: Interface Definitions

### P020 Interface: Worker Pool System

**Decision**: A pool manager with health tracking, load balancing, and graceful degradation.

```json
{
  "problem_id": "P020",
  "status": "interface_defined",
  "interface": {
    "Worker": {
      "type": "table",
      "fields": {
        "id": "string",
        "location_id": {
          "type": "string",
          "description": "Reference to location config"
        },
        "status": {
          "type": "string",
          "enum": ["idle", "busy", "degraded", "offline"]
        },
        "current_task": "string | nil",
        "stats": "WorkerStats",
        "last_heartbeat": "number"
      }
    },
    "WorkerStats": {
      "type": "table",
      "fields": {
        "requests_total": "number",
        "requests_success": "number",
        "requests_failed": "number",
        "average_latency_ms": "number",
        "p99_latency_ms": "number",
        "tokens_processed": "number",
        "uptime_ms": "number"
      }
    },
    "PoolManager": {
      "type": "table",
      "fields": {
        "workers": "table<string, Worker>",
        "locations": "table<string, LocationConfig>",
        "queue": "TaskQueue",
        "config": "PoolConfig"
      },
      "methods": {
        "add_worker": {
          "signature": "(location_id: string) -> Worker, error?"
        },
        "remove_worker": {
          "signature": "(worker_id: string) -> boolean"
        },
        "submit": {
          "signature": "(task: Task) -> TaskHandle"
        },
        "broadcast": {
          "signature": "(task: Task) -> TaskHandle[]",
          "description": "Send to all workers"
        },
        "get_worker": {
          "signature": "(strategy: string) -> Worker | nil",
          "description": "Get available worker using strategy"
        },
        "health_check": {
          "signature": "() -> PoolHealth"
        },
        "rebalance": {
          "signature": "() -> void",
          "description": "Redistribute load across workers"
        }
      }
    },
    "PoolConfig": {
      "type": "table",
      "fields": {
        "min_workers": {"type": "number", "default": 1},
        "max_workers": {"type": "number", "default": 8},
        "health_check_interval_ms": {"type": "number", "default": 30000},
        "worker_timeout_ms": {"type": "number", "default": 60000},
        "load_balancing_strategy": {
          "type": "string",
          "enum": ["round_robin", "least_loaded", "random", "location_affinity"],
          "default": "least_loaded"
        },
        "degradation_threshold": {
          "type": "number",
          "default": 0.5,
          "description": "Mark degraded if success rate below this"
        }
      }
    },
    "TaskQueue": {
      "type": "table",
      "fields": {
        "pending": "Task[]",
        "in_progress": "table<string, Task>",
        "completed": "Task[]"
      },
      "methods": {
        "enqueue": {
          "signature": "(task: Task, priority?: number) -> void"
        },
        "dequeue": {
          "signature": "() -> Task | nil"
        },
        "cancel": {
          "signature": "(task_id: string) -> boolean"
        },
        "get_status": {
          "signature": "(task_id: string) -> TaskStatus"
        }
      }
    },
    "Task": {
      "type": "table",
      "fields": {
        "id": "string",
        "type": {
          "type": "string",
          "enum": ["tool_call", "verify", "refine", "analyze"]
        },
        "payload": "any",
        "priority": {"type": "number", "default": 5},
        "timeout_ms": "number | nil",
        "assigned_worker": "string | nil",
        "created_at": "number",
        "started_at": "number | nil",
        "completed_at": "number | nil",
        "result": "any | nil",
        "error": "string | nil"
      }
    },
    "TaskHandle": {
      "type": "table",
      "fields": {
        "task_id": "string",
        "status": "TaskStatus"
      },
      "methods": {
        "await": {
          "signature": "(timeout_ms?: number) -> any, error?"
        },
        "cancel": {
          "signature": "() -> boolean"
        },
        "get_progress": {
          "signature": "() -> number",
          "description": "0-1 completion estimate"
        }
      }
    },
    "TaskStatus": {
      "type": "string",
      "enum": ["pending", "running", "completed", "failed", "cancelled", "timeout"]
    },
    "PoolHealth": {
      "type": "table",
      "fields": {
        "status": {
          "type": "string",
          "enum": ["healthy", "degraded", "critical"]
        },
        "total_workers": "number",
        "healthy_workers": "number",
        "degraded_workers": "number",
        "offline_workers": "number",
        "queue_depth": "number",
        "average_wait_time_ms": "number"
      }
    }
  }
}
```

**Explanation**: The pool manager abstracts worker heterogeneity. Different locations (model + config combinations) appear as interchangeable workers. Health tracking enables automatic failover; load balancing distributes work efficiently. The TaskHandle provides async/await semantics for callers.

---

### P021 Interface: Location Configuration

**Decision**: YAML-based declarative configuration with validation and templating.

```json
{
  "problem_id": "P021",
  "status": "interface_defined",
  "interface": {
    "LocationConfig": {
      "type": "table",
      "fields": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9-]*$"
        },
        "name": "string",
        "description": "string | nil",
        "provider": {
          "type": "ProviderConfig"
        },
        "parameters": {
          "type": "ParameterConfig"
        },
        "tags": "string[]",
        "enabled": {"type": "boolean", "default": true},
        "weight": {
          "type": "number",
          "default": 1.0,
          "description": "Relative selection weight"
        }
      }
    },
    "ProviderConfig": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["ollama", "openai", "anthropic", "local", "custom"]
        },
        "model_id": "string",
        "endpoint": "string",
        "api_key_env": {
          "type": "string | nil",
          "description": "Environment variable name for API key"
        },
        "timeout_ms": {"type": "number", "default": 30000},
        "retry_config": {
          "max_retries": {"type": "number", "default": 2},
          "backoff_base_ms": {"type": "number", "default": 1000}
        }
      }
    },
    "ParameterConfig": {
      "type": "table",
      "fields": {
        "temperature": {
          "type": "number",
          "range": [0, 2],
          "default": 0.7
        },
        "top_p": {
          "type": "number",
          "range": [0, 1],
          "default": 1.0
        },
        "max_tokens": {
          "type": "number",
          "default": 2048
        },
        "system_prompt_prefix": {
          "type": "string | nil",
          "description": "Prepended to all system prompts"
        },
        "stop_sequences": "string[]"
      }
    },
    "LocationRegistry": {
      "type": "table",
      "fields": {
        "locations": "table<string, LocationConfig>",
        "templates": "table<string, LocationTemplate>"
      },
      "methods": {
        "load": {
          "signature": "(path: string) -> void, error?",
          "description": "Load configuration from YAML file"
        },
        "validate": {
          "signature": "(config: LocationConfig) -> boolean, errors?"
        },
        "get": {
          "signature": "(id: string) -> LocationConfig | nil"
        },
        "get_by_tag": {
          "signature": "(tag: string) -> LocationConfig[]"
        },
        "create_from_template": {
          "signature": "(template_id: string, overrides: table) -> LocationConfig"
        },
        "list": {
          "signature": "(filter?: table) -> LocationConfig[]"
        }
      }
    },
    "LocationTemplate": {
      "type": "table",
      "fields": {
        "id": "string",
        "base": "LocationConfig",
        "variables": {
          "type": "table<string, TemplateVariable>",
          "description": "Parameterizable fields"
        }
      }
    },
    "TemplateVariable": {
      "type": "table",
      "fields": {
        "type": {"type": "string", "enum": ["string", "number", "boolean"]},
        "default": "any | nil",
        "required": "boolean",
        "validation": "string | nil"
      }
    },
    "ConfigurationFile": {
      "format": "yaml",
      "example": "locations:\n  - id: precise-cold\n    name: Precise (Low Temperature)\n    provider:\n      type: ollama\n      model_id: nemotron-3-nano\n      endpoint: http://localhost:11434\n    parameters:\n      temperature: 0.2\n    tags: [precise, deterministic]\n\n  - id: creative-hot\n    name: Creative (High Temperature)\n    provider:\n      type: ollama\n      model_id: nemotron-3-nano\n      endpoint: http://localhost:11434\n    parameters:\n      temperature: 0.9\n    tags: [creative, exploratory]\n\ntemplates:\n  - id: ollama-base\n    base:\n      provider:\n        type: ollama\n        endpoint: http://localhost:11434\n        timeout_ms: 30000\n    variables:\n      model_id: {type: string, required: true}\n      temperature: {type: number, default: 0.7}"
    }
  }
}
```

**Explanation**: Locations are the "differing starting points." YAML configuration makes them easy to edit without code changes. Templates allow defining common patterns (e.g., "all Ollama models") with overridable parameters. Tags enable selecting locations by capability (e.g., "give me all creative locations").

---

### P022 Interface: Result Aggregation System

**Decision**: A strategy-based aggregator with multiple algorithms and confidence tracking.

```json
{
  "problem_id": "P022",
  "status": "interface_defined",
  "interface": {
    "AggregationInput": {
      "type": "table",
      "fields": {
        "responses": "WorkerResponse[]",
        "task": "Task",
        "strategy": "string"
      }
    },
    "WorkerResponse": {
      "type": "table",
      "fields": {
        "worker_id": "string",
        "location_id": "string",
        "result": "any",
        "confidence": {
          "type": "number",
          "range": [0, 1]
        },
        "latency_ms": "number",
        "tokens_used": "number"
      }
    },
    "AggregationResult": {
      "type": "table",
      "fields": {
        "selected": "any",
        "alternatives": "Alternative[]",
        "agreement_score": {
          "type": "number",
          "range": [0, 1],
          "description": "How much workers agreed"
        },
        "contributing_locations": "string[]",
        "strategy_used": "string",
        "explanation": "string"
      }
    },
    "Alternative": {
      "type": "table",
      "fields": {
        "result": "any",
        "support": {
          "type": "number",
          "description": "Number or weight of supporting workers"
        },
        "locations": "string[]"
      }
    },
    "AggregationStrategy": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "description": "string",
        "applicable_to": {
          "type": "string[]",
          "description": "Task types this strategy works for"
        },
        "aggregate": {
          "type": "function",
          "signature": "(input: AggregationInput) -> AggregationResult"
        }
      }
    },
    "Strategies": {
      "majority_vote": {
        "description": "Select result with most votes",
        "applicable_to": ["verify", "classify"],
        "config": {
          "tie_breaker": {
            "type": "string",
            "enum": ["highest_confidence", "fastest_response", "random"],
            "default": "highest_confidence"
          }
        },
        "algorithm": "1. Group identical results\n2. Count votes per group\n3. Select group with most votes\n4. On tie, use tie_breaker"
      },
      "weighted_vote": {
        "description": "Weight votes by confidence or location weight",
        "applicable_to": ["verify", "classify"],
        "config": {
          "weight_source": {
            "type": "string",
            "enum": ["confidence", "location_weight", "historical_accuracy"],
            "default": "confidence"
          }
        },
        "algorithm": "1. Group identical results\n2. Sum weights per group\n3. Select group with highest total weight"
      },
      "union_merge": {
        "description": "Combine all unique items",
        "applicable_to": ["analyze", "list_issues"],
        "config": {
          "deduplication": {
            "method": {
              "type": "string",
              "enum": ["exact", "semantic_similarity", "key_field"],
              "default": "semantic_similarity"
            },
            "threshold": {"type": "number", "default": 0.9}
          }
        },
        "algorithm": "1. Collect all items from all responses\n2. Deduplicate using configured method\n3. Return merged list"
      },
      "best_of_n": {
        "description": "Select single best response",
        "applicable_to": ["refine", "generate"],
        "config": {
          "ranking_criteria": {
            "type": "string[]",
            "default": ["confidence", "response_quality", "latency"]
          }
        },
        "algorithm": "1. Score each response on criteria\n2. Select highest scoring response"
      },
      "supervisor_selection": {
        "description": "Present to supervisor for selection",
        "applicable_to": ["*"],
        "config": {
          "present_top_n": {"type": "number", "default": 3}
        },
        "algorithm": "1. Rank responses\n2. Present top N to supervisor\n3. Supervisor selects or requests more options"
      }
    },
    "Aggregator": {
      "type": "table",
      "fields": {
        "strategies": "table<string, AggregationStrategy>",
        "default_strategy": "string"
      },
      "methods": {
        "aggregate": {
          "signature": "(input: AggregationInput) -> AggregationResult"
        },
        "select_strategy": {
          "signature": "(task_type: string, context: table) -> string",
          "description": "Auto-select appropriate strategy"
        },
        "register_strategy": {
          "signature": "(strategy: AggregationStrategy) -> void"
        }
      }
    },
    "SemanticComparator": {
      "type": "table",
      "methods": {
        "compare": {
          "signature": "(a: any, b: any) -> number",
          "description": "Returns similarity 0-1"
        },
        "cluster": {
          "signature": "(items: any[], threshold: number) -> any[][]",
          "description": "Group similar items"
        }
      }
    }
  }
}
```

**Explanation**: Different tasks need different aggregation. Verification benefits from voting; brainstorming benefits from union. The strategy selection can be automatic (based on task type) or explicit. Agreement score tells downstream systems how confident to be in the result.

---

### P023 Interface: Parallel Execution Engine

**Decision**: Coroutine-based async I/O with rate limiting and failure handling.

```json
{
  "problem_id": "P023",
  "status": "interface_defined",
  "interface": {
    "AsyncExecutor": {
      "type": "table",
      "fields": {
        "active_requests": "table<string, Request>",
        "rate_limiters": "table<string, RateLimiter>",
        "config": "ExecutorConfig"
      },
      "methods": {
        "execute": {
          "signature": "(request: Request) -> Promise",
          "description": "Execute single request asynchronously"
        },
        "execute_batch": {
          "signature": "(requests: Request[]) -> Promise[]",
          "description": "Execute multiple requests with concurrency control"
        },
        "execute_parallel": {
          "signature": "(requests: Request[]) -> AggregatedResult",
          "description": "Execute all and aggregate results"
        },
        "cancel": {
          "signature": "(request_id: string) -> boolean"
        },
        "get_stats": {
          "signature": "() -> ExecutorStats"
        }
      }
    },
    "ExecutorConfig": {
      "type": "table",
      "fields": {
        "max_concurrent": {
          "type": "number",
          "default": 4,
          "description": "Maximum simultaneous requests"
        },
        "per_endpoint_limit": {
          "type": "number",
          "default": 2,
          "description": "Max concurrent per endpoint"
        },
        "timeout_ms": {
          "type": "number",
          "default": 30000
        },
        "retry": {
          "max_attempts": {"type": "number", "default": 3},
          "backoff_type": {"type": "string", "enum": ["fixed", "exponential", "exponential_with_jitter"]},
          "base_delay_ms": {"type": "number", "default": 1000},
          "max_delay_ms": {"type": "number", "default": 30000}
        }
      }
    },
    "Request": {
      "type": "table",
      "fields": {
        "id": "string",
        "endpoint": "string",
        "method": {"type": "string", "enum": ["POST", "GET"]},
        "headers": "table<string, string>",
        "body": "string | nil",
        "timeout_ms": "number | nil",
        "priority": {"type": "number", "default": 5}
      }
    },
    "Response": {
      "type": "table",
      "fields": {
        "request_id": "string",
        "status_code": "number",
        "headers": "table<string, string>",
        "body": "string",
        "latency_ms": "number",
        "attempts": "number"
      }
    },
    "Promise": {
      "type": "table",
      "fields": {
        "id": "string",
        "status": {
          "type": "string",
          "enum": ["pending", "resolved", "rejected"]
        },
        "value": "any | nil",
        "error": "any | nil"
      },
      "methods": {
        "then": {
          "signature": "(on_resolve: function, on_reject?: function) -> Promise"
        },
        "await": {
          "signature": "(timeout_ms?: number) -> any, error?",
          "description": "Block until resolved (yields coroutine)"
        },
        "cancel": {
          "signature": "() -> boolean"
        }
      }
    },
    "RateLimiter": {
      "type": "table",
      "fields": {
        "endpoint": "string",
        "requests_per_minute": "number",
        "tokens_per_minute": "number | nil",
        "current_count": "number",
        "window_start": "number"
      },
      "methods": {
        "acquire": {
          "signature": "(tokens?: number) -> boolean, wait_ms?",
          "description": "Returns true if allowed, false with wait time if not"
        },
        "release": {
          "signature": "() -> void"
        },
        "reset": {
          "signature": "() -> void"
        }
      }
    },
    "ExecutorStats": {
      "type": "table",
      "fields": {
        "total_requests": "number",
        "successful_requests": "number",
        "failed_requests": "number",
        "retried_requests": "number",
        "current_active": "number",
        "average_latency_ms": "number",
        "rate_limit_waits": "number",
        "total_tokens_used": "number"
      }
    },
    "LuaImplementation": {
      "approach": "coroutine-based",
      "dependencies": ["socket", "cjson"],
      "optional_dependencies": ["copas"],
      "key_functions": {
        "create_connection": "socket.tcp() + connect()",
        "async_read": "socket.select() for non-blocking reads",
        "async_write": "socket:send() with select() for writability",
        "scheduler": "Coroutine dispatcher using socket.select()"
      },
      "example_flow": [
        "1. Wrap each request in a coroutine",
        "2. Coroutine yields when waiting for I/O",
        "3. Main loop uses socket.select() to find ready sockets",
        "4. Resume coroutines with ready sockets",
        "5. Collect results when coroutines finish"
      ]
    }
  }
}
```

**Explanation**: Lua/LuaJIT is single-threaded, so we use coroutines for async. Each request becomes a coroutine that yields on I/O. The executor multiplexes using socket.select(). Rate limiting prevents API throttling; retry with backoff handles transient failures.

---

## Pass 2 Summary

All four problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P020 | Worker + PoolManager | Health-tracked pool with load balancing |
| P021 | LocationConfig + LocationRegistry | YAML declarative with templates |
| P022 | AggregationStrategy + Aggregator | Strategy-based with multiple algorithms |
| P023 | AsyncExecutor + Promise | Coroutine-based async with rate limiting |

**Status Update**: All problems advanced from `open` to `interface_defined`.

**Cross-Document Links**:
- P020 pool uses P021 locations as worker configurations
- P020 dispatches to P023 executor for actual requests
- P022 receives responses and feeds back to P004 supervisor
- P023 respects P013 bounds (max concurrent requests)

---

## Next Pass Preview

Pass 3 will:
- Implement the pool manager state machine
- Write the YAML configuration parser
- Build voting and semantic comparison algorithms
- Create the coroutine scheduler
