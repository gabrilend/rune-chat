# Summary: On "Arriving On Time"

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

Analysis of the phrase "you'll be sure to arrive on time" and its implications for system design.

## Key Points

### The Halting Problem
- "Arriving" = reaching a correct solution
- "On time" = deterministic termination
- System must not loop endlessly or diverge

### Proposed Halting Conditions
| Approach | Description |
|----------|-------------|
| Agreement threshold | Stop when N consecutive passes match |
| Confidence scoring | Stop when confidence exceeds threshold |
| Maximum iterations | Hard cap with human fallback |

### Observability
- "Many stops along the journey" implies visibility into intermediate states
- Could manifest as: log files, step-by-step UI, structured reasoning traces

### The Alien Tangent
- "I'm not an alien" as metacognitive pause
- Self-aware acknowledgment that the request sounds unusual
- Suggests value in systems that periodically ask "does this still make sense?"

## Design Constraint

The system needs guaranteed termination. Infinite generation is a feature (see "infinite bless"), but infinite *loops* are a bug. The halting condition channels infinity toward convergence.

---

## Pass 1: Problem Identification

### Problem 12: Convergence Detection

How do we know when passes have converged and further iteration is pointless?

```json
{
  "problem_id": "P012",
  "name": "convergence_detection",
  "description": "How do we detect that the system has converged?",
  "constraints": [
    "Must be computable from pass results",
    "Should not require human judgment",
    "Must handle false convergence (local minima)"
  ],
  "detection_methods": {
    "exact_match": {
      "description": "Output of pass N equals output of pass N-1",
      "strength": "Definitive when true",
      "weakness": "Rare for text generation"
    },
    "semantic_similarity": {
      "description": "Embedding distance between passes below threshold",
      "strength": "Handles paraphrasing",
      "weakness": "Requires embedding model, threshold tuning"
    },
    "issue_count_stable": {
      "description": "Number of identified issues unchanged for K passes",
      "strength": "Practical, easy to compute",
      "weakness": "Doesn't catch issue churn (different issues, same count)"
    },
    "confidence_plateau": {
      "description": "Average confidence score stops increasing",
      "strength": "Captures 'good enough' state",
      "weakness": "Confidence may be miscalibrated"
    }
  },
  "recommended": "issue_count_stable with K=3, plus confidence_plateau as secondary signal",
  "status": "open"
}
```

**Explanation**: Convergence detection is crucial for termination. We recommend a hybrid approach: if the issue count is stable for 3 passes AND confidence has plateaued, declare convergence. This avoids both premature termination and infinite loops.

---

### Problem 13: Maximum Iteration Bounds

What are the hard limits to prevent runaway execution?

```json
{
  "problem_id": "P013",
  "name": "maximum_iteration_bounds",
  "description": "What hard limits prevent infinite loops?",
  "constraints": [
    "Must guarantee termination",
    "Should be configurable",
    "Must have sensible defaults"
  ],
  "bounds": {
    "max_passes_per_line": {
      "default": 8,
      "rationale": "Matches the 8-examination structure",
      "configurable": true
    },
    "max_angles_per_pass": {
      "default": 4,
      "rationale": "Correctness, efficiency, style, security",
      "configurable": true
    },
    "max_total_llm_calls": {
      "default": 1000,
      "rationale": "Cost/time circuit breaker",
      "configurable": true
    },
    "max_wall_time_seconds": {
      "default": 3600,
      "rationale": "1 hour hard limit",
      "configurable": true
    }
  },
  "on_limit_reached": {
    "action": "halt_with_partial_results",
    "notification": "Log warning, optionally alert user",
    "state": "Save progress for potential resume"
  },
  "status": "open"
}
```

**Explanation**: Even with convergence detection, we need hard limits. A buggy convergence detector or adversarial input could cause infinite loops. The bounds are safety rails, not normal operating limits.

---

### Problem 14: Observability Infrastructure

How do we make intermediate states visible for debugging and learning?

```json
{
  "problem_id": "P014",
  "name": "observability_infrastructure",
  "description": "How do we expose the system's internal state?",
  "constraints": [
    "Must not significantly slow execution",
    "Should be optional/configurable",
    "Must handle large volumes of data"
  ],
  "observability_layers": {
    "logging": {
      "level": "debug | info | warn | error",
      "format": "structured JSON",
      "destination": "file, stdout, or remote"
    },
    "tracing": {
      "span_types": ["pass", "angle", "tool_call", "llm_request"],
      "attributes": ["duration", "input_size", "output_size", "status"],
      "format": "OpenTelemetry compatible"
    },
    "state_snapshots": {
      "frequency": "after each pass",
      "content": ["current_code", "issues", "confidence", "decisions"],
      "storage": "append-only log file"
    }
  },
  "query_interface": {
    "description": "Allow querying historical states",
    "example_queries": [
      "Show all issues identified in pass 3",
      "Compare code between pass 1 and pass 5",
      "List all tool calls with errors"
    ]
  },
  "status": "open"
}
```

**Explanation**: "Many stops along the journey" requires infrastructure to record and retrieve those stops. The system should be a glass box, not a black box. This aids debugging, builds trust, and enables learning from the process.

---

### Problem 15: Metacognitive Checks

How does the system periodically ask "does this still make sense?"

```json
{
  "problem_id": "P015",
  "name": "metacognitive_checks",
  "description": "How do we implement self-aware sanity checks?",
  "constraints": [
    "Must not add excessive overhead",
    "Should catch obvious derailment",
    "Must have clear escalation path"
  ],
  "check_types": {
    "goal_alignment": {
      "question": "Is the current work still aligned with the original request?",
      "frequency": "Every N passes or on major decisions",
      "implementation": "Compare current focus to original user input"
    },
    "coherence": {
      "question": "Does the current output make sense?",
      "frequency": "After each generation",
      "implementation": "Check for obvious errors: syntax, contradictions"
    },
    "progress": {
      "question": "Are we making forward progress?",
      "frequency": "Every pass",
      "implementation": "Compare issue count, confidence trends"
    }
  },
  "on_check_failure": {
    "minor": "Log warning, continue with caution",
    "major": "Pause, request supervisor review",
    "critical": "Halt, escalate to user"
  },
  "status": "open"
}
```

**Explanation**: The "alien tangent" in the original request models metacognition - stepping back to assess sanity. The system should do this programmatically. If it detects it's gone off the rails, it should stop rather than continue confidently in the wrong direction.

---

## Dependencies Graph

```
P012 (convergence_detection)
  ├── P013 (maximum_iteration_bounds)
  └── P014 (observability_infrastructure)
        └── P015 (metacognitive_checks)
```

---

## Pass 1 Summary

Four problems identified:
1. **P012**: Convergence detection - knowing when to stop
2. **P013**: Maximum iteration bounds - hard safety limits
3. **P014**: Observability infrastructure - making internals visible
4. **P015**: Metacognitive checks - self-aware sanity validation

---

---

## Pass 2: Interface Definitions

### P012 Interface: Convergence Detection System

**Decision**: Multi-signal convergence detection with configurable thresholds and trend analysis.

```json
{
  "problem_id": "P012",
  "status": "interface_defined",
  "interface": {
    "ConvergenceState": {
      "type": "table",
      "fields": {
        "is_converged": "boolean",
        "confidence": {
          "type": "number",
          "range": [0, 1],
          "description": "How confident we are in convergence"
        },
        "signals": "ConvergenceSignal[]",
        "passes_since_change": "number",
        "trend": {
          "type": "string",
          "enum": ["converging", "stable", "oscillating", "diverging"]
        },
        "recommendation": {
          "type": "string",
          "enum": ["continue", "stop", "escalate"]
        }
      }
    },
    "ConvergenceSignal": {
      "type": "table",
      "fields": {
        "name": {
          "type": "string",
          "enum": ["exact_match", "semantic_similarity", "issue_count", "confidence_plateau", "modification_rate"]
        },
        "value": "number",
        "threshold": "number",
        "weight": "number",
        "triggered": "boolean"
      }
    },
    "ConvergenceConfig": {
      "type": "table",
      "fields": {
        "signals": {
          "exact_match": {
            "enabled": {"type": "boolean", "default": true},
            "weight": {"type": "number", "default": 0.3}
          },
          "semantic_similarity": {
            "enabled": {"type": "boolean", "default": true},
            "threshold": {"type": "number", "default": 0.95},
            "weight": {"type": "number", "default": 0.25}
          },
          "issue_count": {
            "enabled": {"type": "boolean", "default": true},
            "stable_passes": {"type": "number", "default": 2},
            "weight": {"type": "number", "default": 0.25}
          },
          "confidence_plateau": {
            "enabled": {"type": "boolean", "default": true},
            "min_confidence": {"type": "number", "default": 0.8},
            "plateau_passes": {"type": "number", "default": 2},
            "weight": {"type": "number", "default": 0.2}
          }
        },
        "global_threshold": {
          "type": "number",
          "default": 0.7,
          "description": "Weighted sum must exceed this to declare convergence"
        },
        "min_passes": {
          "type": "number",
          "default": 2,
          "description": "Never converge before this many passes"
        },
        "false_convergence_detection": {
          "enabled": {"type": "boolean", "default": true},
          "lookback_passes": {"type": "number", "default": 3},
          "description": "Detect oscillation that looks like stability"
        }
      }
    },
    "ConvergenceDetector": {
      "type": "table",
      "fields": {
        "config": "ConvergenceConfig",
        "history": "PassResult[]",
        "current_state": "ConvergenceState"
      },
      "methods": {
        "record_pass": {
          "signature": "(result: PassResult) -> void",
          "description": "Add a pass result to history"
        },
        "check": {
          "signature": "() -> ConvergenceState",
          "description": "Evaluate all signals, return current state"
        },
        "should_stop": {
          "signature": "() -> boolean, reason?",
          "description": "Simple boolean check for control flow"
        },
        "explain": {
          "signature": "() -> string",
          "description": "Human-readable explanation of current state"
        }
      }
    },
    "SimilarityCalculator": {
      "methods": {
        "exact": {
          "signature": "(a: string, b: string) -> boolean",
          "description": "Character-by-character equality"
        },
        "normalized": {
          "signature": "(a: string, b: string) -> number",
          "description": "Similarity after whitespace normalization"
        },
        "semantic": {
          "signature": "(a: string, b: string, model: string?) -> number",
          "description": "Embedding-based similarity (requires LLM call)"
        }
      }
    }
  }
}
```

**Explanation**: Convergence is not binary - it's a confidence level derived from multiple signals. The weighted sum approach prevents any single signal from prematurely triggering convergence. False convergence detection catches oscillating patterns that might look stable over short windows.

---

### P013 Interface: Bounds System

**Decision**: A hierarchical bounds system with soft limits (warnings) and hard limits (stops).

```json
{
  "problem_id": "P013",
  "status": "interface_defined",
  "interface": {
    "BoundsConfig": {
      "type": "table",
      "fields": {
        "passes": {
          "type": "BoundSpec",
          "fields": {
            "soft_limit": {"type": "number", "default": 6},
            "hard_limit": {"type": "number", "default": 8}
          }
        },
        "angles_per_pass": {
          "type": "BoundSpec",
          "fields": {
            "soft_limit": {"type": "number", "default": 4},
            "hard_limit": {"type": "number", "default": 8}
          }
        },
        "llm_calls": {
          "type": "BoundSpec",
          "fields": {
            "soft_limit": {"type": "number", "default": 500},
            "hard_limit": {"type": "number", "default": 1000}
          }
        },
        "tokens": {
          "type": "BoundSpec",
          "fields": {
            "soft_limit": {"type": "number", "default": 500000},
            "hard_limit": {"type": "number", "default": 1000000}
          }
        },
        "wall_time_ms": {
          "type": "BoundSpec",
          "fields": {
            "soft_limit": {"type": "number", "default": 1800000},
            "hard_limit": {"type": "number", "default": 3600000}
          }
        },
        "cost_dollars": {
          "type": "BoundSpec",
          "fields": {
            "soft_limit": {"type": "number", "default": 1.0},
            "hard_limit": {"type": "number", "default": 5.0}
          }
        }
      }
    },
    "BoundSpec": {
      "type": "table",
      "fields": {
        "soft_limit": {
          "type": "number",
          "description": "Warn when exceeded"
        },
        "hard_limit": {
          "type": "number",
          "description": "Stop when exceeded"
        },
        "current": {
          "type": "number",
          "description": "Current value"
        },
        "on_soft_exceeded": {
          "type": "string",
          "enum": ["log", "warn_user", "request_approval"],
          "default": "log"
        },
        "on_hard_exceeded": {
          "type": "string",
          "enum": ["stop", "stop_and_save", "escalate"],
          "default": "stop_and_save"
        }
      }
    },
    "BoundsChecker": {
      "type": "table",
      "fields": {
        "config": "BoundsConfig",
        "violations": "BoundsViolation[]"
      },
      "methods": {
        "check": {
          "signature": "(current: BoundsSnapshot) -> BoundsCheckResult"
        },
        "increment": {
          "signature": "(metric: string, amount: number) -> BoundsCheckResult"
        },
        "can_proceed": {
          "signature": "() -> boolean"
        },
        "get_report": {
          "signature": "() -> BoundsReport"
        },
        "reset": {
          "signature": "() -> void"
        }
      }
    },
    "BoundsSnapshot": {
      "type": "table",
      "fields": {
        "passes": "number",
        "angles_this_pass": "number",
        "total_llm_calls": "number",
        "total_tokens": "number",
        "elapsed_ms": "number",
        "estimated_cost": "number"
      }
    },
    "BoundsCheckResult": {
      "type": "table",
      "fields": {
        "can_proceed": "boolean",
        "soft_violations": "string[]",
        "hard_violations": "string[]",
        "utilization": {
          "type": "table<string, number>",
          "description": "Percent of each limit used"
        }
      }
    },
    "BoundsViolation": {
      "type": "table",
      "fields": {
        "metric": "string",
        "type": {"type": "string", "enum": ["soft", "hard"]},
        "limit": "number",
        "actual": "number",
        "timestamp": "number",
        "action_taken": "string"
      }
    }
  }
}
```

**Explanation**: Two-tier limits allow the system to warn before stopping. Soft limits trigger notifications; hard limits halt execution. Cost tracking (in dollars) enables budget management for paid APIs. The BoundsReport provides post-mortem analysis of resource usage.

---

### P014 Interface: Observability Infrastructure

**Decision**: Three-layer observability (logging, tracing, snapshots) with unified query interface.

```json
{
  "problem_id": "P014",
  "status": "interface_defined",
  "interface": {
    "LogEntry": {
      "type": "table",
      "fields": {
        "timestamp": "number",
        "level": {
          "type": "string",
          "enum": ["debug", "info", "warn", "error"]
        },
        "source": {
          "type": "string",
          "description": "Component that generated log"
        },
        "message": "string",
        "context": {
          "type": "table",
          "description": "Structured data relevant to entry"
        },
        "trace_id": {
          "type": "string | nil",
          "description": "Links to trace if applicable"
        }
      }
    },
    "TraceSpan": {
      "type": "table",
      "fields": {
        "trace_id": "string",
        "span_id": "string",
        "parent_span_id": "string | nil",
        "name": "string",
        "kind": {
          "type": "string",
          "enum": ["pass", "angle", "tool_call", "llm_request", "validation"]
        },
        "start_time": "number",
        "end_time": "number | nil",
        "status": {
          "type": "string",
          "enum": ["running", "completed", "error"]
        },
        "attributes": {
          "type": "table",
          "description": "Key-value pairs"
        },
        "events": "TraceEvent[]"
      }
    },
    "TraceEvent": {
      "type": "table",
      "fields": {
        "timestamp": "number",
        "name": "string",
        "attributes": "table"
      }
    },
    "StateSnapshot": {
      "type": "table",
      "fields": {
        "id": "string",
        "timestamp": "number",
        "trigger": {
          "type": "string",
          "enum": ["pass_complete", "manual", "checkpoint", "error"]
        },
        "state": {
          "type": "table",
          "fields": {
            "current_pass": "number",
            "current_code": "string",
            "issues": "Issue[]",
            "decisions": "Decision[]",
            "bounds_snapshot": "BoundsSnapshot",
            "convergence_state": "ConvergenceState"
          }
        },
        "diff_from_previous": {
          "type": "table | nil",
          "description": "What changed since last snapshot"
        }
      }
    },
    "Decision": {
      "type": "table",
      "fields": {
        "timestamp": "number",
        "type": {
          "type": "string",
          "enum": ["proceed", "stop", "escalate", "retry", "skip"]
        },
        "reason": "string",
        "inputs": "table",
        "made_by": {
          "type": "string",
          "enum": ["system", "supervisor", "user"]
        }
      }
    },
    "ObservabilityStore": {
      "type": "table",
      "fields": {
        "logs": "LogEntry[]",
        "traces": "table<string, TraceSpan[]>",
        "snapshots": "StateSnapshot[]"
      },
      "methods": {
        "log": {
          "signature": "(level: string, message: string, context?: table) -> void"
        },
        "start_span": {
          "signature": "(name: string, kind: string, parent?: string) -> TraceSpan"
        },
        "end_span": {
          "signature": "(span_id: string, status?: string) -> void"
        },
        "snapshot": {
          "signature": "(trigger: string) -> StateSnapshot"
        },
        "query": {
          "signature": "(query: ObservabilityQuery) -> QueryResult"
        }
      }
    },
    "ObservabilityQuery": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["logs", "traces", "snapshots"]
        },
        "filters": {
          "time_range": {"start": "number", "end": "number"},
          "level": "string | nil",
          "source": "string | nil",
          "trace_id": "string | nil"
        },
        "limit": "number",
        "offset": "number"
      }
    }
  },
  "storage_backends": [
    {
      "id": "file",
      "description": "Append-only JSON lines file",
      "config": {"path": "string", "rotation_size_mb": "number"}
    },
    {
      "id": "memory",
      "description": "In-memory with ring buffer",
      "config": {"max_entries": "number"}
    },
    {
      "id": "sqlite",
      "description": "SQLite database for complex queries",
      "config": {"db_path": "string"}
    }
  ]
}
```

**Explanation**: The three layers serve different needs: logs for debugging, traces for performance analysis, snapshots for state inspection. The query interface allows answering questions like "show me all issues found in pass 3" or "what was the code state when this error occurred?"

---

### P015 Interface: Metacognitive System

**Decision**: Scheduled checks with severity-based escalation and intervention registry.

```json
{
  "problem_id": "P015",
  "status": "interface_defined",
  "interface": {
    "MetacognitiveCheck": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "question": {
          "type": "string",
          "description": "The sanity check question"
        },
        "check_type": {
          "type": "string",
          "enum": ["goal_alignment", "coherence", "progress", "resource", "safety"]
        },
        "frequency": {
          "type": "string",
          "enum": ["every_pass", "every_n_passes", "on_event", "periodic_time"]
        },
        "frequency_param": {
          "type": "number | string",
          "description": "N for every_n_passes, ms for periodic_time, event name for on_event"
        },
        "evaluator": {
          "type": "string",
          "enum": ["rule_based", "llm_based", "hybrid"]
        },
        "severity_levels": {
          "type": "table",
          "fields": {
            "pass": "string",
            "minor": "string",
            "major": "string",
            "critical": "string"
          }
        }
      }
    },
    "CheckResult": {
      "type": "table",
      "fields": {
        "check_id": "string",
        "timestamp": "number",
        "passed": "boolean",
        "severity": {
          "type": "string | nil",
          "enum": ["minor", "major", "critical"],
          "description": "Only set if not passed"
        },
        "details": "string",
        "evidence": {
          "type": "table",
          "description": "Supporting data for the result"
        },
        "recommended_action": {
          "type": "string",
          "enum": ["continue", "pause", "review", "escalate", "abort"]
        }
      }
    },
    "MetacognitiveEngine": {
      "type": "table",
      "fields": {
        "checks": "MetacognitiveCheck[]",
        "results_history": "CheckResult[]",
        "intervention_registry": "Intervention[]"
      },
      "methods": {
        "register_check": {
          "signature": "(check: MetacognitiveCheck) -> void"
        },
        "run_scheduled": {
          "signature": "(event: string, context: table) -> CheckResult[]",
          "description": "Run all checks scheduled for this event"
        },
        "run_all": {
          "signature": "(context: table) -> CheckResult[]",
          "description": "Run all checks regardless of schedule"
        },
        "get_health": {
          "signature": "() -> HealthStatus"
        },
        "intervene": {
          "signature": "(result: CheckResult) -> Intervention"
        }
      }
    },
    "HealthStatus": {
      "type": "table",
      "fields": {
        "overall": {
          "type": "string",
          "enum": ["healthy", "degraded", "critical"]
        },
        "checks_passed": "number",
        "checks_failed": "number",
        "active_issues": "CheckResult[]",
        "last_check_time": "number"
      }
    },
    "Intervention": {
      "type": "table",
      "fields": {
        "id": "string",
        "triggered_by": "string",
        "action": {
          "type": "string",
          "enum": ["log", "notify", "pause", "rollback", "escalate", "abort"]
        },
        "details": "string",
        "requires_acknowledgment": "boolean",
        "acknowledged_at": "number | nil",
        "acknowledged_by": "string | nil"
      }
    },
    "PredefinedChecks": [
      {
        "id": "goal_alignment_check",
        "name": "Goal Alignment",
        "question": "Is the current work still aligned with the original user request?",
        "check_type": "goal_alignment",
        "frequency": "every_n_passes",
        "frequency_param": 2,
        "evaluator": "llm_based",
        "implementation": "Compare current focus (file, function, issue type) against original request. Flag if working on unrelated areas."
      },
      {
        "id": "progress_check",
        "name": "Progress Check",
        "question": "Are we making forward progress?",
        "check_type": "progress",
        "frequency": "every_pass",
        "evaluator": "rule_based",
        "implementation": "Check issue_count trend. Fail if issues increasing for 3+ passes."
      },
      {
        "id": "coherence_check",
        "name": "Coherence Check",
        "question": "Does the current output make sense?",
        "check_type": "coherence",
        "frequency": "on_event",
        "frequency_param": "code_generated",
        "evaluator": "hybrid",
        "implementation": "Syntax check (rule) + semantic reasonableness (LLM)."
      },
      {
        "id": "resource_check",
        "name": "Resource Check",
        "question": "Are we within resource bounds?",
        "check_type": "resource",
        "frequency": "periodic_time",
        "frequency_param": 60000,
        "evaluator": "rule_based",
        "implementation": "Check bounds utilization. Warn at 80%, fail at 100%."
      }
    ]
  }
}
```

**Explanation**: Metacognitive checks are the system's self-awareness. Each check asks a specific question and triggers appropriate interventions when the answer is concerning. The intervention registry tracks what actions were taken and whether they were acknowledged - important for post-mortems.

---

## Pass 2 Summary

All four problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P012 | ConvergenceState + ConvergenceDetector | Multi-signal weighted convergence |
| P013 | BoundsConfig + BoundsChecker | Two-tier soft/hard limits |
| P014 | LogEntry + TraceSpan + StateSnapshot | Three-layer observability |
| P015 | MetacognitiveCheck + MetacognitiveEngine | Scheduled checks with interventions |

**Status Update**: All problems advanced from `open` to `interface_defined`.

**Cross-Document Links**:
- P012 feeds into P005 (controls when line processing stops)
- P013 integrates with P010 (scheduler respects bounds)
- P014 captures P011 messages (all protocol messages logged)
- P015 uses P014 data (checks query observability store)

---

## Next Pass Preview

Pass 3 will:
- Implement the convergence detection algorithm
- Build the bounds checking state machine
- Create the observability query engine
- Write metacognitive check evaluators
