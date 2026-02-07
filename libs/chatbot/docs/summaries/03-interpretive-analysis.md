# Summary: Interpretive Analysis

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

A deeper dive into the original request, extracting four concrete patterns from the philosophical language.

## Key Points

### The "Orbiting Angle" Pattern
- Perspective-shifting verification system
- Multiple prompts asking the same question differently
- Critic models evaluating against different criteria
- Rotating personas or system prompts

### The "Continual Pass-Through" Pattern
- Cross-product verification matrix
- Every combination of (function, term) is evaluated
- Trades speed for thoroughness
- Appropriate for costly-bug domains like code generation

### The Two-Layer Architecture
```
User <-> Supervisor LLM (powerful) <-> Worker LLM (fast)
```
- Supervisor generates structured JSON tool calls
- Worker receives documentation before execution
- Grounds responses in actual interfaces, not training assumptions

### Implementation Sketch
1. `--code-designer` startup flag
2. Tool doc injection (first 10 lines)
3. Multi-pass loop with varied prompts
4. Convergence check with human fallback

## Method

This section demonstrates the interpretive approach it describes: examining the same text from multiple angles to extract meaning.

---

## Pass 1: Problem Identification

### Problem 9: Angle Definition Schema

What constitutes an "angle" and how is it specified?

```json
{
  "problem_id": "P009",
  "name": "angle_definition_schema",
  "description": "How do we formally define an evaluation angle?",
  "constraints": [
    "Must be machine-readable",
    "Should produce different LLM behavior",
    "Must be composable (angles can combine)"
  ],
  "schema": {
    "angle": {
      "id": "string - unique identifier",
      "name": "string - human-readable name",
      "system_prompt_modifier": "string - appended to base system prompt",
      "temperature_override": "number | null",
      "focus_areas": "array of strings - what to pay attention to",
      "output_format": "object - expected response structure"
    }
  },
  "predefined_angles": [
    {
      "id": "correctness",
      "name": "Correctness Check",
      "system_prompt_modifier": "Focus on logical correctness. Identify bugs, edge cases, and incorrect assumptions.",
      "focus_areas": ["logic", "edge_cases", "assumptions"]
    },
    {
      "id": "efficiency",
      "name": "Efficiency Review",
      "system_prompt_modifier": "Focus on performance. Identify unnecessary operations, memory issues, and optimization opportunities.",
      "focus_areas": ["time_complexity", "space_complexity", "redundancy"]
    },
    {
      "id": "style",
      "name": "Style Audit",
      "system_prompt_modifier": "Focus on code style. Check naming, formatting, idioms, and readability.",
      "focus_areas": ["naming", "formatting", "idioms", "comments"]
    },
    {
      "id": "security",
      "name": "Security Scan",
      "system_prompt_modifier": "Focus on security. Identify injection risks, data exposure, and unsafe patterns.",
      "focus_areas": ["injection", "exposure", "validation", "sanitization"]
    }
  ],
  "status": "open"
}
```

**Explanation**: Each angle modifies how the LLM approaches the same code. The schema ensures angles are consistent and comparable. The predefined set covers common concerns, but the system should allow custom angles.

---

### Problem 10: Cross-Product Execution

How do we efficiently execute the (function × term × angle) matrix?

```json
{
  "problem_id": "P010",
  "name": "cross_product_execution",
  "description": "How do we manage the combinatorial explosion of passes?",
  "constraints": [
    "Must complete in reasonable time",
    "Should parallelize where possible",
    "Must aggregate results coherently"
  ],
  "dimensions": {
    "functions": "N functions in the codebase",
    "terms": "M terms/concepts being verified",
    "angles": "A angles (default 4)",
    "passes": "P passes (default 8)"
  },
  "total_operations": "N × M × A × P (potentially very large)",
  "optimization_strategies": [
    {
      "name": "early_exit",
      "description": "Stop passes when consensus reached",
      "savings": "Up to (P-1)/P reduction"
    },
    {
      "name": "parallel_angles",
      "description": "Run all angles concurrently",
      "savings": "A-fold speedup"
    },
    {
      "name": "incremental_processing",
      "description": "Only re-process changed functions",
      "savings": "Proportional to change size"
    },
    {
      "name": "sampling",
      "description": "Randomly sample (function, term) pairs instead of exhaustive",
      "savings": "Configurable, trades thoroughness for speed"
    }
  ],
  "status": "open"
}
```

**Explanation**: The cross-product can explode quickly. A codebase with 100 functions, 50 terms, 4 angles, and 8 passes would require 160,000 LLM calls. Optimizations are essential for practical use.

---

### Problem 11: Layer Communication Format

What is the exact JSON format for supervisor-worker messages?

```json
{
  "problem_id": "P011",
  "name": "layer_communication_format",
  "description": "What is the wire format between supervisor and worker?",
  "constraints": [
    "Must be valid JSON",
    "Should be self-describing (includes type info)",
    "Must handle all message types"
  ],
  "message_types": {
    "tool_request": {
      "type": "tool_request",
      "id": "uuid",
      "tool": "string - tool name",
      "arguments": "object - tool arguments",
      "context": "string - why this tool is being called",
      "doc_hint": "string - first 10 lines of tool docs"
    },
    "verify_request": {
      "type": "verify_request",
      "id": "uuid",
      "code": "string - code to verify",
      "angle": "angle object (see P009)",
      "context": "string - what we're verifying for"
    },
    "refine_request": {
      "type": "refine_request",
      "id": "uuid",
      "code": "string - current code",
      "issues": "array - identified problems",
      "guidance": "string - how to fix"
    },
    "response": {
      "type": "response",
      "id": "uuid - matches request",
      "status": "success | error | ambiguous",
      "result": "any - the response payload",
      "observations": "array of strings",
      "confidence": "number 0-1"
    }
  },
  "status": "open"
}
```

**Explanation**: Strict message formats enable reliable communication. The `doc_hint` field in tool requests implements the "first 10 lines of documentation" requirement. The `confidence` field in responses enables the system to know when to seek clarification.

---

## Dependencies Graph

```
P009 (angle_definition)
  └── P010 (cross_product_execution)
        └── P011 (layer_communication_format)
              └── P004 (supervisor_worker_protocol) [from doc 01]
```

---

## Pass 1 Summary

Three problems identified:
1. **P009**: Angle definition schema - formalizing what an "angle" is
2. **P010**: Cross-product execution - managing combinatorial complexity
3. **P011**: Layer communication format - exact JSON wire protocol

---

---

## Pass 2: Interface Definitions

### P009 Interface: Angle Configuration System

**Decision**: Angles are first-class configuration objects with composition support and runtime validation.

```json
{
  "problem_id": "P009",
  "status": "interface_defined",
  "interface": {
    "AngleSpec": {
      "type": "table",
      "fields": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]*$",
          "description": "Unique snake_case identifier"
        },
        "version": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$",
          "description": "Semantic version for angle evolution"
        },
        "name": {
          "type": "string",
          "max_length": 50,
          "description": "Human-readable display name"
        },
        "description": {
          "type": "string",
          "max_length": 500,
          "description": "What this angle evaluates"
        },
        "system_prompt": {
          "type": "string",
          "description": "Complete system prompt for this angle"
        },
        "temperature": {
          "type": "number",
          "range": [0, 2],
          "default": 0.3,
          "description": "LLM temperature for this angle"
        },
        "focus_areas": {
          "type": "FocusArea[]",
          "min_items": 1,
          "description": "What to examine"
        },
        "output_schema": {
          "type": "JSONSchema",
          "description": "Expected response structure"
        },
        "weight": {
          "type": "number",
          "range": [0, 1],
          "default": 0.25,
          "description": "Importance for aggregation"
        },
        "composable_with": {
          "type": "string[]",
          "description": "IDs of angles this can combine with"
        },
        "conflicts_with": {
          "type": "string[]",
          "description": "IDs of angles that shouldn't run together"
        }
      }
    },
    "FocusArea": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "indicators": {
          "type": "string[]",
          "description": "Patterns/keywords that indicate this area"
        },
        "severity_if_violated": {
          "type": "string",
          "enum": ["low", "medium", "high", "critical"]
        }
      }
    },
    "AngleOutputSchema": {
      "type": "object",
      "required": ["issues", "summary"],
      "properties": {
        "issues": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["description", "severity", "location"],
            "properties": {
              "description": {"type": "string"},
              "severity": {"enum": ["low", "medium", "high", "critical"]},
              "location": {
                "type": "object",
                "properties": {
                  "file": {"type": "string"},
                  "line": {"type": "integer"},
                  "column": {"type": "integer"}
                }
              },
              "suggested_fix": {"type": "string"},
              "confidence": {"type": "number", "minimum": 0, "maximum": 1}
            }
          }
        },
        "summary": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "notes": {"type": "array", "items": {"type": "string"}}
      }
    },
    "AngleRegistry": {
      "type": "table",
      "fields": {
        "angles": "table<string, AngleSpec>",
        "default_set": "string[]",
        "compositions": "CompositeAngle[]"
      },
      "methods": {
        "register": {
          "signature": "(spec: AngleSpec) -> boolean, error?",
          "description": "Add or update an angle, validates schema"
        },
        "get": {
          "signature": "(id: string) -> AngleSpec | nil"
        },
        "compose": {
          "signature": "(ids: string[]) -> CompositeAngle | nil, error?",
          "description": "Create a combined angle from multiple specs"
        },
        "validate_output": {
          "signature": "(angle_id: string, output: any) -> boolean, errors?",
          "description": "Check if output matches angle's schema"
        }
      }
    },
    "CompositeAngle": {
      "type": "table",
      "fields": {
        "id": "string",
        "source_angles": "string[]",
        "merged_focus_areas": "FocusArea[]",
        "combined_prompt": "string",
        "weight_distribution": "table<string, number>"
      }
    }
  },
  "validation_rules": [
    "Angle ID must be unique within registry",
    "Weight must be > 0 if angle is in default_set",
    "Composed angles cannot include conflicting angles",
    "Output must validate against output_schema"
  ]
}
```

**Explanation**: The angle system supports both predefined angles and custom user-defined angles. Composition allows combining multiple perspectives into a single pass (e.g., "correctness + security" for critical code). The output schema ensures responses are parseable and aggregatable.

---

### P010 Interface: Execution Engine

**Decision**: A scheduler that manages the cross-product execution with optimization hooks.

```json
{
  "problem_id": "P010",
  "status": "interface_defined",
  "interface": {
    "ExecutionPlan": {
      "type": "table",
      "fields": {
        "id": "string",
        "created_at": "number",
        "items": "ExecutionItem[]",
        "strategy": {
          "type": "string",
          "enum": ["exhaustive", "sampled", "incremental", "adaptive"]
        },
        "estimated_operations": "number",
        "actual_operations": "number | nil",
        "status": {
          "type": "string",
          "enum": ["planning", "executing", "paused", "completed", "failed"]
        }
      }
    },
    "ExecutionItem": {
      "type": "table",
      "fields": {
        "id": "string",
        "function_ref": {
          "type": "table",
          "fields": {
            "file": "string",
            "name": "string",
            "start_line": "number",
            "end_line": "number"
          }
        },
        "term": {
          "type": "string | nil",
          "description": "Specific term being verified, if applicable"
        },
        "angle_id": "string",
        "pass_number": "number",
        "status": {
          "type": "string",
          "enum": ["pending", "running", "completed", "skipped", "failed"]
        },
        "result": "AngleOutput | nil",
        "skip_reason": "string | nil"
      }
    },
    "Scheduler": {
      "type": "table",
      "fields": {
        "current_plan": "ExecutionPlan | nil",
        "workers": "Worker[]",
        "metrics": "SchedulerMetrics"
      },
      "methods": {
        "create_plan": {
          "signature": "(targets: FunctionRef[], angles: string[], config: SchedulerConfig) -> ExecutionPlan",
          "description": "Generate execution plan for given targets"
        },
        "execute": {
          "signature": "(plan: ExecutionPlan) -> ExecutionResult",
          "description": "Run the plan, returns aggregated results"
        },
        "pause": {
          "signature": "() -> void"
        },
        "resume": {
          "signature": "() -> void"
        },
        "get_progress": {
          "signature": "() -> ProgressReport"
        }
      }
    },
    "SchedulerConfig": {
      "type": "table",
      "fields": {
        "max_passes": {
          "type": "number",
          "default": 8
        },
        "max_concurrent": {
          "type": "number",
          "default": 4,
          "description": "Parallel executions"
        },
        "early_exit": {
          "type": "EarlyExitConfig",
          "fields": {
            "enabled": {"type": "boolean", "default": true},
            "consensus_threshold": {
              "type": "number",
              "default": 0.9,
              "description": "Agreement level to trigger early exit"
            },
            "stable_passes": {
              "type": "number",
              "default": 2,
              "description": "Consecutive stable passes required"
            }
          }
        },
        "sampling": {
          "type": "SamplingConfig",
          "fields": {
            "enabled": {"type": "boolean", "default": false},
            "rate": {"type": "number", "range": [0.1, 1.0]},
            "seed": {"type": "number | nil"}
          }
        },
        "timeout_per_item_ms": {
          "type": "number",
          "default": 30000
        },
        "total_timeout_ms": {
          "type": "number",
          "default": 3600000
        }
      }
    },
    "SchedulerMetrics": {
      "type": "table",
      "fields": {
        "total_items": "number",
        "completed_items": "number",
        "skipped_items": "number",
        "failed_items": "number",
        "total_tokens_used": "number",
        "total_duration_ms": "number",
        "early_exits": "number",
        "retries": "number"
      }
    },
    "ProgressReport": {
      "type": "table",
      "fields": {
        "percent_complete": "number",
        "current_item": "ExecutionItem | nil",
        "estimated_remaining_ms": "number | nil",
        "issues_found_so_far": "number",
        "convergence_trend": {
          "type": "string",
          "enum": ["improving", "stable", "diverging", "unknown"]
        }
      }
    }
  },
  "optimization_hooks": {
    "before_item": "Can skip item based on heuristics",
    "after_pass": "Can trigger early exit if converged",
    "on_failure": "Can retry with different parameters",
    "on_timeout": "Can adjust strategy mid-execution"
  }
}
```

**Explanation**: The execution engine treats the cross-product as a schedulable plan. Each item (function × angle × pass) is tracked individually. Optimization hooks allow the scheduler to adapt: skip redundant checks, exit early on convergence, retry failures. The metrics enable cost analysis and performance tuning.

---

### P011 Interface: Wire Protocol

**Decision**: Versioned JSON protocol with envelope structure and validation.

```json
{
  "problem_id": "P011",
  "status": "interface_defined",
  "interface": {
    "MessageEnvelope": {
      "type": "table",
      "fields": {
        "protocol_version": {
          "type": "string",
          "value": "1.0.0",
          "description": "Protocol version for compatibility"
        },
        "message_id": {
          "type": "string",
          "format": "uuid",
          "description": "Unique identifier for this message"
        },
        "correlation_id": {
          "type": "string | nil",
          "description": "Links response to request"
        },
        "timestamp": {
          "type": "number",
          "description": "Unix timestamp with milliseconds"
        },
        "sender": {
          "type": "string",
          "enum": ["supervisor", "worker", "system"]
        },
        "message_type": {
          "type": "string",
          "enum": ["tool_request", "verify_request", "refine_request", "analyze_request", "response", "error", "heartbeat"]
        },
        "payload": {
          "type": "any",
          "description": "Type-specific content"
        }
      }
    },
    "Payloads": {
      "tool_request": {
        "tool_name": {
          "type": "string",
          "description": "Name of tool to execute"
        },
        "arguments": {
          "type": "table",
          "description": "Tool arguments"
        },
        "documentation_hint": {
          "type": "string",
          "max_length": 1000,
          "description": "First 10 lines of tool docs"
        },
        "execution_context": {
          "type": "string",
          "description": "Why this tool is being called"
        },
        "constraints": {
          "type": "table",
          "fields": {
            "timeout_ms": "number",
            "max_output_size": "number"
          }
        }
      },
      "verify_request": {
        "code": {
          "type": "string",
          "description": "Code to verify"
        },
        "angle_spec": {
          "type": "AngleSpec",
          "description": "Full angle configuration"
        },
        "context": {
          "type": "table",
          "fields": {
            "file_path": "string",
            "function_name": "string | nil",
            "line_range": {"start": "number", "end": "number"},
            "previous_issues": "Issue[]",
            "pass_number": "number"
          }
        }
      },
      "refine_request": {
        "code": {
          "type": "string",
          "description": "Current code state"
        },
        "issues": {
          "type": "Issue[]",
          "description": "Problems to address"
        },
        "constraints": {
          "type": "table",
          "fields": {
            "must_preserve": "string[]",
            "must_not_introduce": "string[]",
            "style_guide": "string | nil"
          }
        },
        "guidance": {
          "type": "string",
          "description": "Supervisor's hints for fixing"
        }
      },
      "analyze_request": {
        "code": {
          "type": "string"
        },
        "questions": {
          "type": "string[]",
          "description": "Specific questions to answer about the code"
        },
        "depth": {
          "type": "string",
          "enum": ["shallow", "normal", "deep"]
        }
      },
      "response": {
        "status": {
          "type": "string",
          "enum": ["success", "partial", "error", "needs_clarification"]
        },
        "result": {
          "type": "any",
          "description": "Request-type-specific result"
        },
        "observations": {
          "type": "string[]",
          "description": "Notable findings during execution"
        },
        "metrics": {
          "type": "table",
          "fields": {
            "tokens_in": "number",
            "tokens_out": "number",
            "duration_ms": "number",
            "model_used": "string"
          }
        },
        "warnings": {
          "type": "string[]",
          "description": "Non-fatal issues encountered"
        }
      },
      "error": {
        "code": {
          "type": "string",
          "enum": ["INVALID_REQUEST", "TOOL_FAILED", "TIMEOUT", "RATE_LIMITED", "INTERNAL_ERROR", "AMBIGUOUS_INPUT"]
        },
        "message": {
          "type": "string"
        },
        "details": {
          "type": "any | nil"
        },
        "recoverable": {
          "type": "boolean"
        },
        "suggested_action": {
          "type": "string | nil",
          "enum": ["retry", "retry_with_backoff", "escalate", "abort"]
        }
      }
    },
    "Validators": {
      "validate_envelope": {
        "signature": "(msg: any) -> boolean, errors?",
        "checks": [
          "Required fields present",
          "Protocol version supported",
          "Message type recognized",
          "Timestamp not in future"
        ]
      },
      "validate_payload": {
        "signature": "(msg_type: string, payload: any) -> boolean, errors?",
        "description": "Type-specific payload validation"
      }
    },
    "Serialization": {
      "encode": {
        "signature": "(envelope: MessageEnvelope) -> string",
        "description": "JSON encode with optional compression"
      },
      "decode": {
        "signature": "(data: string) -> MessageEnvelope | nil, error?",
        "description": "JSON decode with validation"
      }
    }
  },
  "protocol_constraints": [
    "All messages must have envelope wrapper",
    "Response correlation_id must match request message_id",
    "Error responses must include code and message",
    "Heartbeat messages keep connection alive during long operations"
  ]
}
```

**Explanation**: The wire protocol is the contract between supervisor and worker. The envelope structure ensures all messages are traceable (message_id, correlation_id) and versionable. Typed payloads with validation prevent malformed messages from causing silent failures. The error payload includes recovery hints for resilient operation.

---

## Pass 2 Summary

All three problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P009 | AngleSpec + AngleRegistry | First-class angle objects with composition |
| P010 | ExecutionPlan + Scheduler | Schedulable cross-product with optimization hooks |
| P011 | MessageEnvelope + Payloads | Versioned protocol with validation |

**Status Update**: All problems advanced from `open` to `interface_defined`.

**Cross-Document Links**:
- P009 (angles) is used by P003 from doc 01 (reciprocal processing)
- P010 (scheduler) coordinates P005 from doc 01 (line processing loop)
- P011 (protocol) implements P004 from doc 01 (supervisor-worker communication)

---

## Next Pass Preview

Pass 3 will:
- Implement the angle composition algorithm
- Create the scheduler state machine
- Write protocol serialization/deserialization in Lua
- Add validation functions for all message types
