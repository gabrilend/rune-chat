# Summary: "Text Continuation and All of Its Infinite Bless"

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

Exploration of this phrase as the possible philosophical core of the entire proposal.

## Key Points

### The Core Insight
- "Text continuation" = literally what LLMs do (next token prediction)
- "Infinite bless" = generative abundance, the well never runs dry
- Perhaps something sacred about the process

### Embrace Continuation
- Don't force complete, correct answers in one shot
- Let the model keep going
- Each continuation adds information

### Reframing Errors
- Errors are not failures
- They are **incomplete continuations**
- Given more passes, the correct form emerges

### Practical Implication
Don't truncate aggressively. Let models ramble, then extract.

```
Pass 1: Generate freely (chaff + wheat)
Pass 2: Identify the wheat
Pass 3: Refine the wheat
Pass 4: Verify the wheat
```

### The Central Tension
- The blessing is infinite (generation never exhausts)
- The constraint is attention (finite context, time, compute)
- The system's job: direct infinity toward convergence

## Philosophy

This section suggests the system should work *with* the generative nature of LLMs rather than against it. Abundance is the feature; curation is the task.

---

## Pass 1: Problem Identification

### Problem 24: Generation vs. Truncation Policy

When do we let the model continue vs. when do we cut it off?

```json
{
  "problem_id": "P024",
  "name": "generation_truncation_policy",
  "description": "How do we balance letting models generate freely vs. limiting output?",
  "constraints": [
    "Must prevent infinite generation",
    "Should not cut off valuable content",
    "Must be context-sensitive"
  ],
  "policy_dimensions": {
    "max_tokens": {
      "default": 2048,
      "early_passes": 4096,
      "late_passes": 1024,
      "rationale": "Early passes explore, late passes compress"
    },
    "stop_sequences": {
      "code_generation": ["```", "# End of code"],
      "analysis": ["## Conclusion", "In summary"],
      "custom": "user-configurable"
    },
    "continuation_triggers": {
      "incomplete_thought": "If output ends mid-sentence, continue",
      "explicit_marker": "If output contains 'continued...', continue",
      "confidence_low": "If model says 'I'm not sure', prompt for elaboration"
    }
  },
  "adaptive_policy": {
    "description": "Adjust limits based on observed output quality",
    "increase_limit_if": "Output consistently hits max_tokens with incomplete thoughts",
    "decrease_limit_if": "Output contains significant padding/repetition"
  },
  "status": "open"
}
```

**Explanation**: The "infinite bless" must be channeled. We let early passes run long (exploration) and late passes run short (compression). Stop sequences help models self-terminate. Adaptive policies prevent both truncation of good content and tolerance of rambling.

---

### Problem 25: Chaff/Wheat Separation

How do we identify valuable content within verbose output?

```json
{
  "problem_id": "P025",
  "name": "chaff_wheat_separation",
  "description": "How do we extract valuable content from verbose generation?",
  "constraints": [
    "Must preserve all valuable content",
    "Should discard truly redundant content",
    "Must handle ambiguous cases gracefully"
  ],
  "classification_heuristics": {
    "wheat_indicators": [
      "Directly answers the question",
      "Contains code that compiles/runs",
      "Introduces new information",
      "Fixes identified issues"
    ],
    "chaff_indicators": [
      "Repeats earlier content",
      "Hedging without substance ('It depends...')",
      "Explains what it's about to do instead of doing it",
      "Off-topic tangents"
    ],
    "ambiguous": [
      "Context-setting preambles (sometimes needed)",
      "Caveats and warnings (sometimes valuable)",
      "Alternative approaches (keep if high quality)"
    ]
  },
  "extraction_methods": {
    "code_extraction": "Parse code blocks, validate syntax",
    "answer_extraction": "Identify sentences that directly respond to query",
    "llm_assisted": "Ask a second LLM to summarize/extract key points"
  },
  "status": "open"
}
```

**Explanation**: LLMs often produce a mix of valuable insight and filler. Rather than demanding perfection, we accept the mix and filter afterward. The heuristics guide automatic classification; ambiguous cases can be kept for later passes to evaluate.

---

### Problem 26: Error as Incomplete Continuation

How do we treat errors as opportunities for more generation rather than failures?

```json
{
  "problem_id": "P026",
  "name": "error_as_incomplete_continuation",
  "description": "How do we frame errors as prompts for continuation?",
  "constraints": [
    "Must not ignore genuine errors",
    "Should encourage iterative fixing",
    "Must track error resolution progress"
  ],
  "error_response_flow": {
    "on_error": [
      "1. Capture error details",
      "2. Append error to context",
      "3. Prompt for continuation with error awareness",
      "4. Track if same error recurs"
    ],
    "continuation_prompt_template": "The previous attempt produced this error: {error}. Please continue, addressing this issue.",
    "recurrence_policy": {
      "max_recurrences": 3,
      "on_max_reached": "Escalate to different angle or supervisor"
    }
  },
  "error_categories": {
    "syntax_error": {
      "continuation_strategy": "Show error, ask to fix",
      "expected_resolution": "1-2 continuations"
    },
    "logic_error": {
      "continuation_strategy": "Explain the bug, ask to rethink",
      "expected_resolution": "2-4 continuations"
    },
    "design_error": {
      "continuation_strategy": "Question assumptions, suggest alternatives",
      "expected_resolution": "May require angle change"
    }
  },
  "status": "open"
}
```

**Explanation**: Instead of "this code has a bug, failed," we say "this code has a bug, let's continue fixing it." The error becomes part of the context for the next generation. Recurrence tracking prevents infinite loops on unfixable errors.

---

### Problem 27: Attention Budget Management

How do we allocate finite context/compute across infinite generation possibilities?

```json
{
  "problem_id": "P027",
  "name": "attention_budget_management",
  "description": "How do we allocate limited resources across generation?",
  "constraints": [
    "Context window is finite",
    "Compute/cost is finite",
    "Must prioritize high-value generation"
  ],
  "budget_dimensions": {
    "context_tokens": {
      "total_available": "model-dependent (4k, 8k, 32k, etc.)",
      "allocation": {
        "system_prompt": "10%",
        "tool_docs": "15%",
        "code_context": "40%",
        "conversation_history": "25%",
        "generation_space": "10%"
      }
    },
    "compute_cost": {
      "tracking": "Count tokens in/out per request",
      "budget": "Configurable per session",
      "on_budget_exceeded": "Warn user, request approval to continue"
    },
    "time": {
      "wall_clock_budget": "Configurable",
      "per_pass_allocation": "Budget / expected_passes",
      "adaptive": "If early passes fast, allow later passes more time"
    }
  },
  "prioritization": {
    "high_priority": ["Fixing correctness issues", "User-requested changes"],
    "medium_priority": ["Style improvements", "Optimization"],
    "low_priority": ["Comments", "Documentation generation"]
  },
  "status": "open"
}
```

**Explanation**: "Infinite bless" meets finite reality. We have limited context windows, limited budgets, limited time. The system must allocate these wisely, prioritizing correctness over polish, and tracking spend to avoid surprises.

---

## Dependencies Graph

```
P024 (generation_truncation_policy)
  └── P025 (chaff_wheat_separation)
        └── P026 (error_as_incomplete_continuation)
              └── P027 (attention_budget_management)
```

---

## Pass 1 Summary

Four problems identified:
1. **P024**: Generation truncation policy - when to stop generating
2. **P025**: Chaff/wheat separation - extracting value from verbose output
3. **P026**: Error as incomplete continuation - reframing errors productively
4. **P027**: Attention budget management - allocating finite resources

---

---

## Pass 2: Interface Definitions

### P024 Interface: Generation Policy System

**Decision**: A context-aware policy engine that adjusts limits based on pass, content type, and observed behavior.

```json
{
  "problem_id": "P024",
  "status": "interface_defined",
  "interface": {
    "GenerationPolicy": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "conditions": "PolicyCondition[]",
        "limits": "GenerationLimits",
        "stop_behavior": "StopBehavior",
        "continuation_rules": "ContinuationRule[]"
      }
    },
    "PolicyCondition": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["pass_range", "task_type", "content_pattern", "history_based"]
        },
        "value": "any"
      }
    },
    "GenerationLimits": {
      "type": "table",
      "fields": {
        "max_tokens": {
          "type": "number",
          "description": "Maximum tokens to generate"
        },
        "min_tokens": {
          "type": "number",
          "default": 0,
          "description": "Minimum before considering early stop"
        },
        "timeout_ms": "number"
      }
    },
    "StopBehavior": {
      "type": "table",
      "fields": {
        "stop_sequences": "string[]",
        "stop_on_repetition": {
          "type": "RepetitionConfig",
          "fields": {
            "enabled": "boolean",
            "min_pattern_length": {"type": "number", "default": 10},
            "max_repetitions": {"type": "number", "default": 3}
          }
        },
        "stop_on_coherence_drop": {
          "type": "CoherenceConfig",
          "fields": {
            "enabled": "boolean",
            "threshold": {"type": "number", "default": 0.5}
          }
        }
      }
    },
    "ContinuationRule": {
      "type": "table",
      "fields": {
        "trigger": {
          "type": "string",
          "enum": ["incomplete_thought", "explicit_marker", "confidence_low", "user_request"]
        },
        "action": {
          "type": "string",
          "enum": ["continue", "prompt_for_more", "request_clarification"]
        },
        "prompt_template": "string | nil"
      }
    },
    "PolicyEngine": {
      "type": "table",
      "fields": {
        "policies": "GenerationPolicy[]",
        "default_policy": "GenerationPolicy",
        "adaptive_config": "AdaptiveConfig"
      },
      "methods": {
        "select_policy": {
          "signature": "(context: GenerationContext) -> GenerationPolicy"
        },
        "should_stop": {
          "signature": "(output: string, policy: GenerationPolicy) -> boolean, reason?"
        },
        "should_continue": {
          "signature": "(output: string, policy: GenerationPolicy) -> boolean, prompt?"
        },
        "adapt": {
          "signature": "(history: GenerationHistory) -> void",
          "description": "Adjust policies based on observed patterns"
        }
      }
    },
    "GenerationContext": {
      "type": "table",
      "fields": {
        "pass_number": "number",
        "task_type": "string",
        "angle_id": "string | nil",
        "previous_output": "string | nil",
        "available_budget": "number"
      }
    },
    "AdaptiveConfig": {
      "type": "table",
      "fields": {
        "enabled": {"type": "boolean", "default": true},
        "increase_limit_if": {
          "description": "Conditions to increase token limits",
          "conditions": [
            "Output consistently hits max_tokens",
            "Incomplete thoughts detected > 50% of time"
          ]
        },
        "decrease_limit_if": {
          "description": "Conditions to decrease token limits",
          "conditions": [
            "Significant repetition detected",
            "Padding/filler > 30% of output"
          ]
        },
        "adjustment_step": {"type": "number", "default": 256}
      }
    },
    "DefaultPolicies": [
      {
        "id": "early_pass_exploratory",
        "name": "Early Pass - Exploratory",
        "conditions": [{"type": "pass_range", "value": [1, 3]}],
        "limits": {"max_tokens": 4096, "min_tokens": 100},
        "stop_behavior": {
          "stop_sequences": ["```\n\n```", "---END---"],
          "stop_on_repetition": {"enabled": true}
        },
        "continuation_rules": [
          {"trigger": "incomplete_thought", "action": "continue"}
        ]
      },
      {
        "id": "late_pass_focused",
        "name": "Late Pass - Focused",
        "conditions": [{"type": "pass_range", "value": [6, 8]}],
        "limits": {"max_tokens": 1024, "min_tokens": 50},
        "stop_behavior": {
          "stop_sequences": ["Done.", "Complete."],
          "stop_on_repetition": {"enabled": true}
        },
        "continuation_rules": []
      }
    ]
  }
}
```

**Explanation**: Generation policy controls how much output we allow. Early passes run long (exploration); late passes run short (compression). Adaptive policies adjust based on observed behavior - if outputs keep hitting limits, increase them; if they're padding, decrease them.

---

### P025 Interface: Content Extraction System

**Decision**: A multi-stage extraction pipeline with configurable heuristics and LLM-assisted classification.

```json
{
  "problem_id": "P025",
  "status": "interface_defined",
  "interface": {
    "ExtractionPipeline": {
      "type": "table",
      "fields": {
        "stages": "ExtractionStage[]",
        "config": "ExtractionConfig"
      },
      "methods": {
        "extract": {
          "signature": "(input: string, type: string) -> ExtractionResult"
        },
        "classify": {
          "signature": "(segment: string) -> ContentClassification"
        },
        "filter": {
          "signature": "(segments: Segment[], filter: SegmentFilter) -> Segment[]"
        }
      }
    },
    "ExtractionStage": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "order": "number",
        "extractor": {
          "type": "function",
          "signature": "(input: string, config: table) -> Segment[]"
        }
      }
    },
    "Segment": {
      "type": "table",
      "fields": {
        "id": "string",
        "content": "string",
        "type": {
          "type": "string",
          "enum": ["code", "explanation", "question", "suggestion", "filler", "unknown"]
        },
        "classification": "ContentClassification",
        "source": {
          "type": "table",
          "fields": {
            "start_offset": "number",
            "end_offset": "number",
            "line_start": "number",
            "line_end": "number"
          }
        },
        "metadata": "table"
      }
    },
    "ContentClassification": {
      "type": "table",
      "fields": {
        "is_wheat": "boolean",
        "confidence": {
          "type": "number",
          "range": [0, 1]
        },
        "wheat_indicators": "string[]",
        "chaff_indicators": "string[]",
        "ambiguity_reason": "string | nil"
      }
    },
    "ExtractionConfig": {
      "type": "table",
      "fields": {
        "wheat_indicators": {
          "type": "IndicatorSet",
          "default": {
            "patterns": [
              "Directly answers the question",
              "Contains valid code",
              "Introduces new information",
              "Provides concrete fix"
            ],
            "keywords": ["solution", "fix", "here is", "the issue is"],
            "structural": ["code_block", "numbered_list", "definition"]
          }
        },
        "chaff_indicators": {
          "type": "IndicatorSet",
          "default": {
            "patterns": [
              "Repeats earlier content",
              "Excessive hedging",
              "Explains what it will do instead of doing it",
              "Off-topic tangent"
            ],
            "keywords": ["it depends", "however", "on the other hand", "as I mentioned"],
            "structural": ["long_preamble", "excessive_caveats"]
          }
        },
        "ambiguous_handling": {
          "type": "string",
          "enum": ["keep", "discard", "llm_classify"],
          "default": "keep"
        },
        "min_segment_length": {"type": "number", "default": 10}
      }
    },
    "IndicatorSet": {
      "type": "table",
      "fields": {
        "patterns": "string[]",
        "keywords": "string[]",
        "structural": "string[]",
        "weights": "table<string, number>"
      }
    },
    "ExtractionResult": {
      "type": "table",
      "fields": {
        "wheat": "Segment[]",
        "chaff": "Segment[]",
        "ambiguous": "Segment[]",
        "stats": {
          "type": "table",
          "fields": {
            "total_segments": "number",
            "wheat_ratio": "number",
            "chaff_ratio": "number",
            "ambiguous_ratio": "number",
            "total_input_tokens": "number",
            "total_wheat_tokens": "number"
          }
        }
      }
    },
    "SegmentFilter": {
      "type": "table",
      "fields": {
        "types": "string[]",
        "min_confidence": "number",
        "max_segments": "number | nil"
      }
    },
    "CodeExtractor": {
      "type": "table",
      "description": "Specialized extractor for code blocks",
      "methods": {
        "extract_blocks": {
          "signature": "(input: string) -> CodeBlock[]"
        },
        "validate_syntax": {
          "signature": "(code: string, language: string) -> boolean, errors?"
        },
        "merge_blocks": {
          "signature": "(blocks: CodeBlock[]) -> string",
          "description": "Combine multiple code blocks intelligently"
        }
      }
    },
    "CodeBlock": {
      "type": "table",
      "fields": {
        "content": "string",
        "language": "string | nil",
        "is_complete": "boolean",
        "syntax_valid": "boolean | nil"
      }
    }
  }
}
```

**Explanation**: LLM output is a mix of valuable content (wheat) and filler (chaff). The extraction pipeline separates them using pattern matching and optional LLM classification. The wheat/chaff ratio is a quality signal - high chaff suggests the generation policy needs adjustment.

---

### P026 Interface: Error Continuation System

**Decision**: An error-aware continuation framework that treats errors as prompts for further generation.

```json
{
  "problem_id": "P026",
  "status": "interface_defined",
  "interface": {
    "ErrorContext": {
      "type": "table",
      "fields": {
        "error": "Error",
        "original_code": "string",
        "attempted_fix": "string | nil",
        "attempt_number": "number",
        "history": "ErrorAttempt[]"
      }
    },
    "Error": {
      "type": "table",
      "fields": {
        "id": "string",
        "category": {
          "type": "string",
          "enum": ["syntax", "type", "logic", "runtime", "design"]
        },
        "message": "string",
        "location": {
          "file": "string",
          "line": "number",
          "column": "number | nil"
        },
        "severity": {
          "type": "string",
          "enum": ["warning", "error", "fatal"]
        },
        "source": {
          "type": "string",
          "enum": ["compiler", "linter", "runtime", "llm", "human"]
        }
      }
    },
    "ErrorAttempt": {
      "type": "table",
      "fields": {
        "attempt_number": "number",
        "error": "Error",
        "fix_attempted": "string",
        "result": {
          "type": "string",
          "enum": ["fixed", "different_error", "same_error", "worse"]
        },
        "new_errors": "Error[]"
      }
    },
    "ContinuationStrategy": {
      "type": "table",
      "fields": {
        "error_category": "string",
        "max_attempts": "number",
        "prompt_template": "string",
        "escalation": {
          "type": "string",
          "enum": ["retry", "different_angle", "supervisor", "user"]
        }
      }
    },
    "ContinuationEngine": {
      "type": "table",
      "fields": {
        "strategies": "table<string, ContinuationStrategy>",
        "recurrence_tracker": "RecurrenceTracker"
      },
      "methods": {
        "continue_from_error": {
          "signature": "(context: ErrorContext) -> ContinuationResult"
        },
        "build_prompt": {
          "signature": "(error: Error, history: ErrorAttempt[], strategy: ContinuationStrategy) -> string"
        },
        "should_escalate": {
          "signature": "(context: ErrorContext) -> boolean, target?"
        },
        "track_recurrence": {
          "signature": "(error: Error) -> RecurrenceStatus"
        }
      }
    },
    "ContinuationResult": {
      "type": "table",
      "fields": {
        "action": {
          "type": "string",
          "enum": ["continue", "escalate", "abort"]
        },
        "prompt": "string | nil",
        "escalation_target": "string | nil",
        "reason": "string"
      }
    },
    "RecurrenceTracker": {
      "type": "table",
      "fields": {
        "seen_errors": "table<string, number>",
        "patterns": "RecurrencePattern[]"
      },
      "methods": {
        "record": {
          "signature": "(error: Error) -> void"
        },
        "get_count": {
          "signature": "(error: Error) -> number"
        },
        "detect_loop": {
          "signature": "() -> boolean, pattern?"
        },
        "reset": {
          "signature": "() -> void"
        }
      }
    },
    "RecurrencePattern": {
      "type": "table",
      "fields": {
        "errors": "string[]",
        "count": "number",
        "is_loop": "boolean"
      }
    },
    "RecurrenceStatus": {
      "type": "table",
      "fields": {
        "error_hash": "string",
        "occurrence_count": "number",
        "is_recurring": "boolean",
        "in_loop": "boolean"
      }
    },
    "DefaultStrategies": {
      "syntax": {
        "max_attempts": 3,
        "prompt_template": "The code has a syntax error: {error}. Here is the current code:\n\n```\n{code}\n```\n\nPlease fix this syntax error.",
        "escalation": "retry"
      },
      "type": {
        "max_attempts": 3,
        "prompt_template": "There is a type error: {error}.\n\nCode:\n```\n{code}\n```\n\nPlease correct the types.",
        "escalation": "different_angle"
      },
      "logic": {
        "max_attempts": 4,
        "prompt_template": "The code has a logic error: {error}.\n\nPrevious attempts:\n{history}\n\nPlease reconsider the algorithm and fix the issue.",
        "escalation": "supervisor"
      },
      "design": {
        "max_attempts": 2,
        "prompt_template": "There appears to be a design issue: {error}.\n\nThe current approach may need rethinking. Consider:\n- Alternative data structures\n- Different algorithm\n- Changed assumptions",
        "escalation": "user"
      }
    }
  }
}
```

**Explanation**: Errors are incomplete continuations, not failures. Each error category has a strategy: syntax errors get quick retries; logic errors need deeper analysis; design errors may need human input. The recurrence tracker prevents infinite loops on unfixable errors.

---

### P027 Interface: Budget Management System

**Decision**: A multi-dimensional budget tracker with allocation policies and alerting.

```json
{
  "problem_id": "P027",
  "status": "interface_defined",
  "interface": {
    "Budget": {
      "type": "table",
      "fields": {
        "id": "string",
        "dimension": {
          "type": "string",
          "enum": ["context_tokens", "output_tokens", "cost", "time", "requests"]
        },
        "total": "number",
        "used": "number",
        "reserved": "number",
        "available": "number"
      }
    },
    "BudgetAllocation": {
      "type": "table",
      "fields": {
        "allocations": {
          "system_prompt": {
            "type": "AllocationRule",
            "default_percent": 10
          },
          "tool_docs": {
            "type": "AllocationRule",
            "default_percent": 15
          },
          "code_context": {
            "type": "AllocationRule",
            "default_percent": 40
          },
          "conversation_history": {
            "type": "AllocationRule",
            "default_percent": 25
          },
          "generation_space": {
            "type": "AllocationRule",
            "default_percent": 10
          }
        }
      }
    },
    "AllocationRule": {
      "type": "table",
      "fields": {
        "percent": "number",
        "min_tokens": "number | nil",
        "max_tokens": "number | nil",
        "priority": {
          "type": "number",
          "description": "Lower = more important, cut last"
        },
        "compressible": "boolean"
      }
    },
    "BudgetManager": {
      "type": "table",
      "fields": {
        "budgets": "table<string, Budget>",
        "allocation": "BudgetAllocation",
        "alerts": "Alert[]",
        "history": "SpendRecord[]"
      },
      "methods": {
        "allocate": {
          "signature": "(context_size: number, model: string) -> AllocationResult"
        },
        "spend": {
          "signature": "(dimension: string, amount: number, source: string) -> SpendResult"
        },
        "reserve": {
          "signature": "(dimension: string, amount: number, purpose: string) -> Reservation | nil"
        },
        "release": {
          "signature": "(reservation_id: string) -> void"
        },
        "check": {
          "signature": "(dimension: string) -> BudgetStatus"
        },
        "get_report": {
          "signature": "() -> BudgetReport"
        },
        "estimate_cost": {
          "signature": "(tokens_in: number, tokens_out: number, model: string) -> number"
        }
      }
    },
    "AllocationResult": {
      "type": "table",
      "fields": {
        "allocations": "table<string, number>",
        "total_available": "number",
        "warnings": "string[]"
      }
    },
    "SpendResult": {
      "type": "table",
      "fields": {
        "success": "boolean",
        "remaining": "number",
        "alert": "Alert | nil"
      }
    },
    "BudgetStatus": {
      "type": "table",
      "fields": {
        "dimension": "string",
        "total": "number",
        "used": "number",
        "available": "number",
        "percent_used": "number",
        "status": {
          "type": "string",
          "enum": ["healthy", "warning", "critical", "exhausted"]
        }
      }
    },
    "Alert": {
      "type": "table",
      "fields": {
        "id": "string",
        "dimension": "string",
        "level": {
          "type": "string",
          "enum": ["info", "warning", "critical"]
        },
        "threshold_percent": "number",
        "current_percent": "number",
        "message": "string",
        "timestamp": "number"
      }
    },
    "SpendRecord": {
      "type": "table",
      "fields": {
        "timestamp": "number",
        "dimension": "string",
        "amount": "number",
        "source": "string",
        "cumulative": "number"
      }
    },
    "Reservation": {
      "type": "table",
      "fields": {
        "id": "string",
        "dimension": "string",
        "amount": "number",
        "purpose": "string",
        "created_at": "number",
        "expires_at": "number | nil"
      }
    },
    "BudgetReport": {
      "type": "table",
      "fields": {
        "budgets": "table<string, BudgetStatus>",
        "total_cost": "number",
        "cost_by_source": "table<string, number>",
        "efficiency_metrics": {
          "type": "table",
          "fields": {
            "wheat_tokens_per_dollar": "number",
            "issues_found_per_1k_tokens": "number",
            "convergence_cost": "number"
          }
        },
        "recommendations": "string[]"
      }
    },
    "PricingConfig": {
      "type": "table",
      "fields": {
        "models": {
          "type": "table<string, ModelPricing>"
        }
      }
    },
    "ModelPricing": {
      "type": "table",
      "fields": {
        "input_per_1k": "number",
        "output_per_1k": "number",
        "currency": "string"
      }
    },
    "AlertConfig": {
      "type": "table",
      "fields": {
        "thresholds": {
          "warning": {"type": "number", "default": 0.7},
          "critical": {"type": "number", "default": 0.9}
        },
        "on_warning": {
          "type": "string",
          "enum": ["log", "notify", "slow_down"],
          "default": "log"
        },
        "on_critical": {
          "type": "string",
          "enum": ["log", "notify", "pause", "request_approval"],
          "default": "notify"
        },
        "on_exhausted": {
          "type": "string",
          "enum": ["stop", "request_approval"],
          "default": "stop"
        }
      }
    }
  }
}
```

**Explanation**: "Infinite bless" meets finite reality. The budget manager tracks multiple dimensions: tokens, cost, time. Allocations ensure each component gets appropriate space. Alerts warn before exhaustion. Efficiency metrics help tune the system - high wheat/dollar is good.

---

## Pass 2 Summary

All four problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P024 | GenerationPolicy + PolicyEngine | Context-aware limits with adaptation |
| P025 | ExtractionPipeline + Segment | Multi-stage wheat/chaff separation |
| P026 | ContinuationStrategy + ContinuationEngine | Error-category-specific continuation |
| P027 | Budget + BudgetManager | Multi-dimensional tracking with alerts |

**Status Update**: All problems advanced from `open` to `interface_defined`.

**Cross-Document Links**:
- P024 policy uses P013 bounds as hard limits
- P025 extraction feeds P016 refinement (wheat becomes input)
- P026 continuation uses P022 aggregation (try different locations)
- P027 budget integrates with P010 scheduler (cost-aware execution)

---

## Next Pass Preview

Pass 3 will:
- Implement the adaptive policy adjustment logic
- Build the wheat/chaff classifier with LLM fallback
- Create the error continuation prompt templates
- Design the budget allocation optimizer
