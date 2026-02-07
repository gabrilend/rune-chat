# Summary: The Typo as Signal

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

Using the "beneffit" typo in the original request as a lens for discussing error handling philosophy.

## Key Points

### The Typo as Theme
- "beneffit" appears in original text
- In a document about iterative refinement, this is almost intentional
- First passes contain errors - that's expected, that's the point

### How the System Should Respond
1. Accept the draft with imperfections
2. Run a "spelling/syntax" angle pass
3. Run a "logic/semantics" angle pass
4. Run a "style/idiom" angle pass
5. Merge corrections

### Premature Perfection Blocks Progress
- Ship the typo, fix it later
- The iteration will catch it
- Demanding perfection on pass 1 prevents pass 2 from ever happening

### Error Classification

| Error Type | Severity | Action |
|------------|----------|--------|
| Syntax (typo, missing bracket) | Low | Auto-fix on next pass |
| Logic (wrong algorithm) | High | Flag for deeper review |
| Style (non-idiomatic) | Low | Suggest, don't force |

### Weighted Responses
- Not all errors are equal
- Orbiting angles should weight accordingly
- Syntax errors: cheap to fix, low scrutiny
- Logic errors: expensive to fix, high scrutiny

## Meta-Point

The typo was preserved intentionally in the document - a living example of the principle it describes.

---

## Pass 1: Problem Identification

### Problem 28: Error Classification Engine

How do we automatically classify errors by type and severity?

```json
{
  "problem_id": "P028",
  "name": "error_classification_engine",
  "description": "How do we categorize errors for appropriate handling?",
  "constraints": [
    "Must work across programming languages",
    "Should be fast (not block the pipeline)",
    "Must handle unknown error types gracefully"
  ],
  "classification_schema": {
    "categories": [
      {
        "id": "syntax",
        "name": "Syntax Errors",
        "examples": ["Missing bracket", "Typo in keyword", "Invalid character"],
        "severity": "low",
        "auto_fixable": true
      },
      {
        "id": "type",
        "name": "Type Errors",
        "examples": ["Wrong argument type", "Missing return", "Null reference"],
        "severity": "medium",
        "auto_fixable": "sometimes"
      },
      {
        "id": "logic",
        "name": "Logic Errors",
        "examples": ["Off-by-one", "Wrong condition", "Race condition"],
        "severity": "high",
        "auto_fixable": false
      },
      {
        "id": "design",
        "name": "Design Errors",
        "examples": ["Wrong abstraction", "Missing feature", "API mismatch"],
        "severity": "critical",
        "auto_fixable": false
      },
      {
        "id": "style",
        "name": "Style Issues",
        "examples": ["Naming convention", "Formatting", "Missing comments"],
        "severity": "low",
        "auto_fixable": true
      }
    ]
  },
  "classification_methods": {
    "pattern_matching": "Regex patterns for common error messages",
    "ast_analysis": "For languages with available parsers",
    "llm_classification": "Ask model to categorize unknown errors"
  },
  "status": "open"
}
```

**Explanation**: Not all errors deserve equal attention. Syntax errors are cheap to fix; logic errors require deep thought. The classification engine routes errors to appropriate handlers, preventing over-investment in trivial issues and under-investment in critical ones.

---

### Problem 29: Progressive Tolerance

How do we adjust error tolerance across passes?

```json
{
  "problem_id": "P029",
  "name": "progressive_tolerance",
  "description": "How do error tolerance levels change across passes?",
  "constraints": [
    "Early passes should be lenient",
    "Late passes should be strict",
    "Must define clear thresholds"
  ],
  "tolerance_schedule": {
    "pass_1": {
      "syntax_errors": "accept (will fix later)",
      "type_errors": "accept (will fix later)",
      "logic_errors": "accept (will analyze)",
      "design_errors": "flag (may need rethink)",
      "style_issues": "ignore"
    },
    "pass_4": {
      "syntax_errors": "must be zero",
      "type_errors": "should be zero",
      "logic_errors": "should be addressed",
      "design_errors": "should have plan",
      "style_issues": "accept"
    },
    "pass_8": {
      "syntax_errors": "must be zero",
      "type_errors": "must be zero",
      "logic_errors": "must be zero",
      "design_errors": "must be resolved",
      "style_issues": "should be addressed"
    }
  },
  "violation_actions": {
    "soft_violation": "Log warning, continue",
    "hard_violation": "Block progress, require fix"
  },
  "status": "open"
}
```

**Explanation**: Pass 1 accepts anything that runs. Pass 8 requires production quality. The schedule encodes this progression, making it explicit when different error types must be resolved.

---

### Problem 30: Auto-Fix Pipeline

How do we automatically fix low-severity errors?

```json
{
  "problem_id": "P030",
  "name": "auto_fix_pipeline",
  "description": "How do we automatically correct trivial errors?",
  "constraints": [
    "Must not introduce new errors",
    "Should be reversible",
    "Must log all changes"
  ],
  "pipeline_stages": {
    "detection": {
      "input": "code + error list",
      "output": "list of fixable errors with locations"
    },
    "fix_generation": {
      "input": "error + surrounding context",
      "output": "proposed fix",
      "methods": ["Pattern-based", "LLM-generated", "Lookup table"]
    },
    "validation": {
      "input": "original code + fix",
      "output": "fixed code (if valid) or rejection",
      "checks": ["Syntax valid", "No new errors", "Semantic preservation"]
    },
    "application": {
      "input": "validated fix",
      "output": "modified code",
      "logging": "Record original, fix, and result"
    }
  },
  "fix_strategies": {
    "typo": "Levenshtein distance to known words",
    "missing_bracket": "AST repair heuristics",
    "formatting": "Run through formatter",
    "import_missing": "Search for likely imports"
  },
  "status": "open"
}
```

**Explanation**: If an error is classified as auto-fixable, this pipeline handles it without human intervention. Each fix is validated before application to prevent cascading problems. All changes are logged for auditability.

---

### Problem 31: Premature Perfection Detection

How do we detect and prevent blocking on trivial issues too early?

```json
{
  "problem_id": "P031",
  "name": "premature_perfection_detection",
  "description": "How do we prevent over-investment in early-pass quality?",
  "constraints": [
    "Must distinguish necessary from premature perfectionism",
    "Should not block critical fixes",
    "Must encourage progress over polish"
  ],
  "detection_signals": {
    "time_on_low_severity": {
      "threshold": "More than 30% of pass time on style issues",
      "action": "Warn, suggest moving on"
    },
    "iteration_on_fixed_issue": {
      "threshold": "Same low-severity issue addressed 3+ times",
      "action": "Mark as 'good enough', proceed"
    },
    "blocking_on_optional": {
      "threshold": "Progress halted for style/comment issues",
      "action": "Override block, log for later"
    }
  },
  "progress_metrics": {
    "track": ["Correctness issues remaining", "Passes completed", "Code stability"],
    "healthy": "Correctness issues decreasing, passes advancing",
    "unhealthy": "Stuck on same issues, no passes completing"
  },
  "intervention": {
    "gentle": "Display message: 'Consider moving to next pass'",
    "firm": "Auto-advance to next pass after timeout",
    "configurable": "User sets intervention aggressiveness"
  },
  "status": "open"
}
```

**Explanation**: "Premature perfection blocks progress" needs enforcement. If the system detects excessive focus on trivial issues early on, it should intervene. The goal is forward motion - polish comes later.

---

## Dependencies Graph

```
P028 (error_classification_engine)
  ├── P029 (progressive_tolerance)
  │     └── P031 (premature_perfection_detection)
  └── P030 (auto_fix_pipeline)
```

---

## Pass 1 Summary

Four problems identified:
1. **P028**: Error classification engine - categorizing errors by type and severity
2. **P029**: Progressive tolerance - adjusting standards across passes
3. **P030**: Auto-fix pipeline - automatically correcting trivial errors
4. **P031**: Premature perfection detection - preventing over-polish early on

---

---

## Pass 2: Interface Definitions

### P028 Interface: Error Classification Engine

**Decision**: A multi-method classifier with pattern matching, AST analysis, and LLM fallback.

```json
{
  "problem_id": "P028",
  "status": "interface_defined",
  "interface": {
    "ErrorClassifier": {
      "type": "table",
      "fields": {
        "patterns": "ClassificationPattern[]",
        "ast_rules": "ASTRule[]",
        "llm_config": "LLMClassifierConfig"
      },
      "methods": {
        "classify": {
          "signature": "(error: RawError, context: ClassificationContext) -> ClassifiedError"
        },
        "classify_batch": {
          "signature": "(errors: RawError[], context: ClassificationContext) -> ClassifiedError[]"
        },
        "learn": {
          "signature": "(error: RawError, correct_category: string) -> void",
          "description": "Record correction for pattern improvement"
        }
      }
    },
    "RawError": {
      "type": "table",
      "fields": {
        "message": "string",
        "code": "string | nil",
        "location": {
          "file": "string",
          "line": "number",
          "column": "number | nil"
        },
        "source": {
          "type": "string",
          "description": "Where the error came from: compiler, linter, runtime, etc."
        },
        "stack_trace": "string | nil",
        "surrounding_code": "string | nil"
      }
    },
    "ClassifiedError": {
      "type": "table",
      "fields": {
        "raw": "RawError",
        "category": {
          "type": "ErrorCategory"
        },
        "severity": {
          "type": "string",
          "enum": ["low", "medium", "high", "critical"]
        },
        "auto_fixable": {
          "type": "boolean | string",
          "description": "true, false, or 'maybe'"
        },
        "classification_method": {
          "type": "string",
          "enum": ["pattern", "ast", "llm", "hybrid"]
        },
        "confidence": {
          "type": "number",
          "range": [0, 1]
        },
        "fix_hints": "string[]"
      }
    },
    "ErrorCategory": {
      "type": "table",
      "fields": {
        "id": {
          "type": "string",
          "enum": ["syntax", "type", "logic", "design", "style", "security", "performance"]
        },
        "name": "string",
        "description": "string",
        "typical_causes": "string[]",
        "typical_fixes": "string[]",
        "default_severity": "string",
        "default_auto_fixable": "boolean"
      }
    },
    "ClassificationPattern": {
      "type": "table",
      "fields": {
        "id": "string",
        "category": "string",
        "pattern": {
          "type": "string",
          "description": "Regex pattern to match error messages"
        },
        "captures": {
          "type": "table<string, number>",
          "description": "Named captures and their group numbers"
        },
        "confidence": "number",
        "examples": "string[]"
      }
    },
    "ASTRule": {
      "type": "table",
      "fields": {
        "id": "string",
        "category": "string",
        "condition": {
          "type": "string",
          "description": "AST query expression"
        },
        "context_required": "boolean"
      }
    },
    "LLMClassifierConfig": {
      "type": "table",
      "fields": {
        "enabled": {"type": "boolean", "default": true},
        "use_when": {
          "type": "string",
          "enum": ["always", "low_confidence", "unknown"],
          "default": "low_confidence"
        },
        "confidence_threshold": {
          "type": "number",
          "default": 0.7,
          "description": "Use LLM if pattern confidence below this"
        },
        "prompt_template": "string"
      }
    },
    "ClassificationContext": {
      "type": "table",
      "fields": {
        "language": "string",
        "file_content": "string | nil",
        "previous_errors": "ClassifiedError[]",
        "project_type": "string | nil"
      }
    },
    "PredefinedPatterns": {
      "syntax": [
        {"pattern": "unexpected (token|end|symbol)", "confidence": 0.95},
        {"pattern": "expected .+ (before|after|near)", "confidence": 0.95},
        {"pattern": "(syntax error|parse error)", "confidence": 0.9},
        {"pattern": "unterminated (string|comment)", "confidence": 0.95}
      ],
      "type": [
        {"pattern": "type .+ (is not assignable|cannot be)", "confidence": 0.9},
        {"pattern": "(nil|null|undefined) (value|reference)", "confidence": 0.85},
        {"pattern": "argument .+ (expected|required)", "confidence": 0.85}
      ],
      "logic": [
        {"pattern": "index out of (bounds|range)", "confidence": 0.8},
        {"pattern": "(infinite loop|stack overflow)", "confidence": 0.85},
        {"pattern": "division by zero", "confidence": 0.9}
      ],
      "style": [
        {"pattern": "(naming convention|indent|whitespace)", "confidence": 0.85},
        {"pattern": "unused (variable|import|function)", "confidence": 0.9}
      ]
    }
  }
}
```

**Explanation**: Error classification enables appropriate handling. Syntax errors are cheap to fix; logic errors need thought. The classifier uses patterns first (fast, no API cost), falls back to LLM for ambiguous cases. Confidence scores help downstream systems decide how to handle uncertain classifications.

---

### P029 Interface: Progressive Tolerance System

**Decision**: A pass-indexed tolerance matrix with graduated strictness and soft/hard thresholds.

```json
{
  "problem_id": "P029",
  "status": "interface_defined",
  "interface": {
    "ToleranceMatrix": {
      "type": "table",
      "fields": {
        "passes": "PassTolerance[]",
        "categories": "string[]",
        "violation_actions": "ViolationAction[]"
      }
    },
    "PassTolerance": {
      "type": "table",
      "fields": {
        "pass": "number",
        "tolerances": {
          "type": "table<string, CategoryTolerance>",
          "description": "Per-category tolerance for this pass"
        }
      }
    },
    "CategoryTolerance": {
      "type": "table",
      "fields": {
        "level": {
          "type": "string",
          "enum": ["ignore", "accept", "warn", "should_fix", "must_fix", "block"]
        },
        "max_count": {
          "type": "number | nil",
          "description": "Maximum allowed errors of this category"
        },
        "description": "string"
      }
    },
    "ViolationAction": {
      "type": "table",
      "fields": {
        "level": "string",
        "soft": {
          "type": "string",
          "description": "Action when approaching limit"
        },
        "hard": {
          "type": "string",
          "description": "Action when limit exceeded"
        }
      }
    },
    "ToleranceChecker": {
      "type": "table",
      "fields": {
        "matrix": "ToleranceMatrix",
        "current_pass": "number",
        "error_counts": "table<string, number>"
      },
      "methods": {
        "check": {
          "signature": "(errors: ClassifiedError[], pass: number) -> ToleranceResult"
        },
        "can_proceed": {
          "signature": "(errors: ClassifiedError[], pass: number) -> boolean, blocker?"
        },
        "get_tolerance": {
          "signature": "(category: string, pass: number) -> CategoryTolerance"
        },
        "report": {
          "signature": "() -> ToleranceReport"
        }
      }
    },
    "ToleranceResult": {
      "type": "table",
      "fields": {
        "pass": "number",
        "overall_status": {
          "type": "string",
          "enum": ["compliant", "warning", "violation", "blocked"]
        },
        "by_category": "table<string, CategoryResult>",
        "violations": "Violation[]",
        "actions_required": "string[]"
      }
    },
    "CategoryResult": {
      "type": "table",
      "fields": {
        "category": "string",
        "count": "number",
        "tolerance": "CategoryTolerance",
        "status": {
          "type": "string",
          "enum": ["ok", "warning", "violation"]
        }
      }
    },
    "Violation": {
      "type": "table",
      "fields": {
        "category": "string",
        "tolerance_level": "string",
        "count": "number",
        "max_allowed": "number | nil",
        "severity": "string"
      }
    },
    "ToleranceReport": {
      "type": "table",
      "fields": {
        "pass_number": "number",
        "summary": "string",
        "categories": "CategoryResult[]",
        "progression": {
          "type": "table[]",
          "description": "Tolerance levels by pass"
        },
        "recommendations": "string[]"
      }
    },
    "DefaultMatrix": {
      "passes": [
        {
          "pass": 1,
          "tolerances": {
            "syntax": {"level": "accept", "description": "Will fix later"},
            "type": {"level": "accept", "description": "Will fix later"},
            "logic": {"level": "accept", "description": "Will analyze"},
            "design": {"level": "warn", "description": "May need rethink"},
            "style": {"level": "ignore", "description": "Not important yet"}
          }
        },
        {
          "pass": 4,
          "tolerances": {
            "syntax": {"level": "must_fix", "max_count": 0, "description": "Must be zero"},
            "type": {"level": "should_fix", "max_count": 2, "description": "Should be zero"},
            "logic": {"level": "should_fix", "description": "Should be addressed"},
            "design": {"level": "warn", "description": "Should have plan"},
            "style": {"level": "accept", "description": "Can address"}
          }
        },
        {
          "pass": 8,
          "tolerances": {
            "syntax": {"level": "block", "max_count": 0, "description": "Must be zero"},
            "type": {"level": "block", "max_count": 0, "description": "Must be zero"},
            "logic": {"level": "block", "max_count": 0, "description": "Must be zero"},
            "design": {"level": "must_fix", "description": "Must be resolved"},
            "style": {"level": "should_fix", "description": "Should be addressed"}
          }
        }
      ],
      "violation_actions": [
        {"level": "ignore", "soft": "none", "hard": "none"},
        {"level": "accept", "soft": "log", "hard": "log"},
        {"level": "warn", "soft": "log", "hard": "notify"},
        {"level": "should_fix", "soft": "notify", "hard": "flag"},
        {"level": "must_fix", "soft": "flag", "hard": "block"},
        {"level": "block", "soft": "block", "hard": "abort"}
      ]
    }
  }
}
```

**Explanation**: Early passes are lenient; late passes are strict. The matrix encodes this progression explicitly. Pass 1 accepts syntax errors (will fix later); pass 8 blocks on them. This prevents premature perfectionism while ensuring final quality.

---

### P030 Interface: Auto-Fix Pipeline

**Decision**: A multi-stage fix pipeline with validation and rollback capability.

```json
{
  "problem_id": "P030",
  "status": "interface_defined",
  "interface": {
    "AutoFixer": {
      "type": "table",
      "fields": {
        "strategies": "table<string, FixStrategy>",
        "validators": "Validator[]",
        "config": "AutoFixConfig"
      },
      "methods": {
        "can_fix": {
          "signature": "(error: ClassifiedError) -> boolean, confidence?"
        },
        "generate_fix": {
          "signature": "(error: ClassifiedError, context: FixContext) -> Fix | nil"
        },
        "apply_fix": {
          "signature": "(fix: Fix) -> FixResult"
        },
        "validate_fix": {
          "signature": "(fix: Fix, before: string, after: string) -> ValidationResult"
        },
        "rollback": {
          "signature": "(fix_id: string) -> boolean"
        }
      }
    },
    "FixStrategy": {
      "type": "table",
      "fields": {
        "id": "string",
        "applies_to": "string[]",
        "method": {
          "type": "string",
          "enum": ["pattern", "lookup", "llm", "ast_transform"]
        },
        "generator": {
          "type": "function",
          "signature": "(error: ClassifiedError, context: FixContext) -> Fix | nil"
        },
        "confidence": "number"
      }
    },
    "Fix": {
      "type": "table",
      "fields": {
        "id": "string",
        "error_id": "string",
        "strategy_id": "string",
        "location": {
          "file": "string",
          "line_start": "number",
          "line_end": "number"
        },
        "original": "string",
        "replacement": "string",
        "confidence": "number",
        "explanation": "string",
        "created_at": "number"
      }
    },
    "FixContext": {
      "type": "table",
      "fields": {
        "file_content": "string",
        "error": "ClassifiedError",
        "surrounding_code": {
          "before": "string",
          "after": "string"
        },
        "symbols_in_scope": "string[]",
        "language": "string"
      }
    },
    "FixResult": {
      "type": "table",
      "fields": {
        "success": "boolean",
        "fix": "Fix",
        "new_content": "string | nil",
        "validation": "ValidationResult",
        "applied_at": "number | nil",
        "error": "string | nil"
      }
    },
    "ValidationResult": {
      "type": "table",
      "fields": {
        "passed": "boolean",
        "checks": "ValidationCheck[]",
        "new_errors": "RawError[]",
        "warnings": "string[]"
      }
    },
    "ValidationCheck": {
      "type": "table",
      "fields": {
        "name": "string",
        "passed": "boolean",
        "details": "string | nil"
      }
    },
    "Validator": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "check": {
          "type": "function",
          "signature": "(original: string, fixed: string, error: ClassifiedError) -> boolean, string?"
        }
      }
    },
    "AutoFixConfig": {
      "type": "table",
      "fields": {
        "enabled": {"type": "boolean", "default": true},
        "min_confidence": {
          "type": "number",
          "default": 0.8,
          "description": "Don't apply fixes below this confidence"
        },
        "require_validation": {
          "type": "boolean",
          "default": true
        },
        "validation_checks": {
          "syntax_valid": {"type": "boolean", "default": true},
          "no_new_errors": {"type": "boolean", "default": true},
          "preserves_behavior": {"type": "boolean", "default": true}
        },
        "rollback_on_failure": {
          "type": "boolean",
          "default": true
        },
        "logging": {
          "log_all_fixes": {"type": "boolean", "default": true},
          "log_rejections": {"type": "boolean", "default": true}
        }
      }
    },
    "FixStrategies": {
      "typo_correction": {
        "applies_to": ["syntax"],
        "method": "lookup",
        "description": "Levenshtein distance to known keywords/identifiers",
        "implementation": "1. Extract misspelled word\n2. Find closest match in symbol table\n3. Replace if distance <= 2"
      },
      "missing_bracket": {
        "applies_to": ["syntax"],
        "method": "ast_transform",
        "description": "Use AST repair heuristics",
        "implementation": "1. Parse to error point\n2. Infer expected bracket type\n3. Insert at appropriate location"
      },
      "unused_variable": {
        "applies_to": ["style"],
        "method": "pattern",
        "description": "Remove or prefix with underscore",
        "implementation": "1. Find declaration\n2. If no uses, remove or rename to _var"
      },
      "missing_import": {
        "applies_to": ["type"],
        "method": "lookup",
        "description": "Search for likely imports",
        "implementation": "1. Identify undefined symbol\n2. Search known modules for export\n3. Add import statement"
      },
      "format_fix": {
        "applies_to": ["style"],
        "method": "external",
        "description": "Run through language formatter",
        "implementation": "1. Invoke language-specific formatter\n2. Return formatted output"
      }
    },
    "FixLog": {
      "type": "table",
      "fields": {
        "entries": "FixLogEntry[]"
      },
      "methods": {
        "record": {
          "signature": "(fix: Fix, result: FixResult) -> void"
        },
        "get_history": {
          "signature": "(file: string) -> FixLogEntry[]"
        },
        "find_rollback_point": {
          "signature": "(fix_id: string) -> string | nil",
          "description": "Get original content before fix"
        }
      }
    },
    "FixLogEntry": {
      "type": "table",
      "fields": {
        "fix": "Fix",
        "result": "FixResult",
        "original_content": "string",
        "timestamp": "number"
      }
    }
  }
}
```

**Explanation**: Auto-fix handles trivial errors without human intervention. Each fix is validated before application (syntax check, no new errors). The fix log enables rollback if a fix causes problems downstream. Only high-confidence fixes are applied automatically.

---

### P031 Interface: Progress Health System

**Decision**: A dashboard-oriented health monitor with trend analysis and intervention recommendations.

```json
{
  "problem_id": "P031",
  "status": "interface_defined",
  "interface": {
    "ProgressMonitor": {
      "type": "table",
      "fields": {
        "metrics": "ProgressMetrics",
        "history": "ProgressSnapshot[]",
        "signals": "HealthSignal[]",
        "config": "MonitorConfig"
      },
      "methods": {
        "record": {
          "signature": "(snapshot: ProgressSnapshot) -> void"
        },
        "get_health": {
          "signature": "() -> HealthStatus"
        },
        "get_trend": {
          "signature": "(metric: string, window?: number) -> Trend"
        },
        "detect_problems": {
          "signature": "() -> Problem[]"
        },
        "recommend": {
          "signature": "() -> Recommendation[]"
        }
      }
    },
    "ProgressMetrics": {
      "type": "table",
      "fields": {
        "passes_completed": "number",
        "issues_open": "number",
        "issues_resolved": "number",
        "code_stability": {
          "type": "number",
          "description": "Passes since last code change"
        },
        "convergence_score": "number",
        "time_on_current_pass": "number",
        "time_on_low_severity": "number"
      }
    },
    "ProgressSnapshot": {
      "type": "table",
      "fields": {
        "timestamp": "number",
        "pass_number": "number",
        "metrics": "ProgressMetrics",
        "state": {
          "current_issues": "ClassifiedError[]",
          "code_hash": "string",
          "decisions_made": "number"
        }
      }
    },
    "HealthStatus": {
      "type": "table",
      "fields": {
        "overall": {
          "type": "string",
          "enum": ["healthy", "degraded", "stalled", "critical"]
        },
        "signals": "HealthSignal[]",
        "metrics_status": "table<string, MetricStatus>",
        "last_updated": "number"
      }
    },
    "MetricStatus": {
      "type": "table",
      "fields": {
        "name": "string",
        "value": "number",
        "trend": "Trend",
        "status": {
          "type": "string",
          "enum": ["good", "warning", "bad"]
        }
      }
    },
    "HealthSignal": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "condition": {
          "type": "string",
          "description": "When this signal fires"
        },
        "status": {
          "type": "string",
          "enum": ["inactive", "warning", "active"]
        },
        "severity": {
          "type": "string",
          "enum": ["low", "medium", "high"]
        },
        "message": "string"
      }
    },
    "Trend": {
      "type": "table",
      "fields": {
        "direction": {
          "type": "string",
          "enum": ["improving", "stable", "degrading"]
        },
        "rate": {
          "type": "number",
          "description": "Change per pass"
        },
        "confidence": "number"
      }
    },
    "Problem": {
      "type": "table",
      "fields": {
        "id": "string",
        "type": {
          "type": "string",
          "enum": ["stall", "oscillation", "premature_perfection", "runaway_expansion", "no_progress"]
        },
        "severity": "string",
        "description": "string",
        "detected_at": "number",
        "evidence": "any"
      }
    },
    "Recommendation": {
      "type": "table",
      "fields": {
        "id": "string",
        "problem_id": "string | nil",
        "type": {
          "type": "string",
          "enum": ["proceed", "pause", "refocus", "escalate", "intervene"]
        },
        "action": "string",
        "rationale": "string",
        "urgency": {
          "type": "string",
          "enum": ["low", "medium", "high", "immediate"]
        }
      }
    },
    "MonitorConfig": {
      "type": "table",
      "fields": {
        "snapshot_frequency": {
          "type": "string",
          "enum": ["every_pass", "every_n_passes", "on_change"],
          "default": "every_pass"
        },
        "trend_window": {
          "type": "number",
          "default": 3,
          "description": "Passes to consider for trend"
        },
        "problem_detection": {
          "stall_threshold": {
            "type": "number",
            "default": 2,
            "description": "Passes without progress before stall"
          },
          "oscillation_threshold": {
            "type": "number",
            "default": 3,
            "description": "Repeated patterns before oscillation"
          },
          "premature_perfection_threshold": {
            "type": "number",
            "default": 0.3,
            "description": "Time on low-severity before warning"
          }
        }
      }
    },
    "PredefinedSignals": [
      {
        "id": "progress_stalled",
        "name": "Progress Stalled",
        "condition": "issue_count unchanged for 2+ passes",
        "severity": "high",
        "message": "No progress being made - consider changing approach"
      },
      {
        "id": "premature_perfection",
        "name": "Premature Perfection",
        "condition": ">30% time on style issues before pass 4",
        "severity": "medium",
        "message": "Focusing on polish too early - prioritize correctness"
      },
      {
        "id": "oscillating",
        "name": "Oscillating",
        "condition": "Same issue fixed and reintroduced 3+ times",
        "severity": "high",
        "message": "Stuck in a loop - need different approach"
      },
      {
        "id": "runaway_expansion",
        "name": "Runaway Expansion",
        "condition": "Code size increasing after pass 4",
        "severity": "medium",
        "message": "Should be compressing, not expanding"
      }
    ],
    "Dashboard": {
      "type": "table",
      "description": "Visual representation of progress",
      "components": [
        {
          "name": "Pass Progress Bar",
          "shows": "Current pass / Total passes"
        },
        {
          "name": "Issue Trend Chart",
          "shows": "Issues over time by category"
        },
        {
          "name": "Code Size Graph",
          "shows": "Size trajectory vs tolerance envelope"
        },
        {
          "name": "Health Indicators",
          "shows": "Active signals and their status"
        },
        {
          "name": "Recommendations Panel",
          "shows": "Current recommended actions"
        }
      ]
    }
  }
}
```

**Explanation**: "Premature perfection blocks progress" needs detection. The monitor tracks multiple signals: stalls (no progress), oscillation (fixing and re-breaking), premature perfection (polishing too early). Recommendations guide the system back on track when problems are detected.

---

## Pass 2 Summary

All four problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P028 | ErrorClassifier + ClassificationPattern | Multi-method with LLM fallback |
| P029 | ToleranceMatrix + ToleranceChecker | Pass-indexed graduated strictness |
| P030 | AutoFixer + Fix + Validator | Validated pipeline with rollback |
| P031 | ProgressMonitor + HealthSignal | Trend-aware with intervention |

**Status Update**: All problems advanced from `open` to `interface_defined`.

**Cross-Document Links**:
- P028 feeds P029 (classifications determine tolerance checking)
- P029 gates P030 (only auto-fix if tolerance allows)
- P030 logs feed P014 observability
- P031 aggregates all metrics for P015 metacognitive checks

---

## Pass 2 Complete - All Documents

| Doc | Problems | Status |
|-----|----------|--------|
| 01 | P001-P005 (5) | interface_defined |
| 02 | P006-P008 (3) | interface_defined |
| 03 | P009-P011 (3) | interface_defined |
| 04 | P012-P015 (4) | interface_defined |
| 05 | P016-P019 (4) | interface_defined |
| 06 | P020-P023 (4) | interface_defined |
| 07 | P024-P027 (4) | interface_defined |
| 08 | P028-P031 (4) | interface_defined |
| **Total** | **31 problems** | **All interface_defined** |

Pass 2 complete across all documents.

---

## Next Pass Preview

Pass 3 will:
- Implement the classification pattern matcher
- Build the tolerance matrix interpolation logic
- Create the auto-fix generators for each strategy
- Design the dashboard rendering system

---

## Total Problems Identified (All Documents)

| Doc | Problems |
|-----|----------|
| 01 | P001-P005 (5) |
| 02 | P006-P008 (3) |
| 03 | P009-P011 (3) |
| 04 | P012-P015 (4) |
| 05 | P016-P019 (4) |
| 06 | P020-P023 (4) |
| 07 | P024-P027 (4) |
| 08 | P028-P031 (4) |
| **Total** | **31 problems** |

Pass 1 complete across all documents.
