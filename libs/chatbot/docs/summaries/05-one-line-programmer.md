# Summary: The One-Line Programmer Paradox

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

Unpacking the nested notation "one-line[-program[mer]/r]" and its implications.

## Key Points

### The Notation Decoded
- one-liner: compact code
- one-line program: minimal implementation
- one-line programmer: someone who writes terse code
- /r: regex/replacement, transformation

### The Paradox
**Achieving simplicity requires complexity.**

To write a correct one-liner, you may need to draft many verbose versions first, then compress. The system inverts "generate once, hope it works" into "generate many times, distill the essence."

### Iterative Compression
```
Draft 1: 50 lines, buggy
Draft 2: 40 lines, mostly works
Draft 3: 30 lines, works
...
Draft N: 5 lines, elegant and correct
```

### Reframing Redundancy
- Each pass doesn't just check - it refines
- Redundancy isn't waste
- It's search space exploration
- The minimal correct form emerges from exhaustive iteration

## Implication

The system should expect and embrace verbosity in early passes. Compression is the goal, not the starting point.

---

## Pass 1: Problem Identification

### Problem 16: Refinement Strategy

How do passes refine code rather than just verify it?

```json
{
  "problem_id": "P016",
  "name": "refinement_strategy",
  "description": "How do we structure passes to progressively improve code?",
  "constraints": [
    "Each pass should produce better code than the last",
    "Must preserve correctness while improving other dimensions",
    "Should know when refinement is complete"
  ],
  "refinement_dimensions": [
    {
      "dimension": "correctness",
      "direction": "Fix bugs, handle edge cases",
      "priority": 1
    },
    {
      "dimension": "clarity",
      "direction": "Improve readability, naming, structure",
      "priority": 2
    },
    {
      "dimension": "efficiency",
      "direction": "Reduce complexity, optimize hot paths",
      "priority": 3
    },
    {
      "dimension": "brevity",
      "direction": "Remove redundancy, compress",
      "priority": 4
    }
  ],
  "pass_focus": {
    "early_passes": ["correctness"],
    "middle_passes": ["correctness", "clarity"],
    "late_passes": ["clarity", "efficiency", "brevity"]
  },
  "status": "open"
}
```

**Explanation**: Refinement isn't random improvement - it's structured. Early passes focus on correctness (a buggy one-liner is worthless). Only after correctness is established do we pursue clarity and brevity. This prevents premature optimization.

---

### Problem 17: Compression Metrics

How do we measure whether code is getting more compact without losing meaning?

```json
{
  "problem_id": "P017",
  "name": "compression_metrics",
  "description": "How do we quantify code compression?",
  "constraints": [
    "Must be objective and computable",
    "Should correlate with human judgment of 'elegance'",
    "Must not reward obfuscation"
  ],
  "metrics": {
    "line_count": {
      "description": "Simple count of lines",
      "weight": 0.2,
      "caveat": "Can game by removing newlines"
    },
    "token_count": {
      "description": "Count of lexical tokens",
      "weight": 0.3,
      "caveat": "Better than lines, still gameable"
    },
    "cyclomatic_complexity": {
      "description": "Number of independent paths",
      "weight": 0.2,
      "caveat": "Lower is simpler, but not always better"
    },
    "identifier_clarity": {
      "description": "Ratio of meaningful to short names",
      "weight": 0.15,
      "caveat": "Subjective, needs heuristics"
    },
    "duplication_ratio": {
      "description": "Amount of repeated code",
      "weight": 0.15,
      "caveat": "Some duplication is acceptable"
    }
  },
  "composite_score": "weighted sum, normalized to 0-100",
  "anti_patterns": [
    "Single-letter variables everywhere",
    "Nested ternaries beyond 2 levels",
    "Magic numbers without context"
  ],
  "status": "open"
}
```

**Explanation**: "Compression" could mean many things. We need objective metrics that reward genuine simplification, not code golf tricks. The weighted composite prevents gaming any single metric.

---

### Problem 18: Verbosity Tolerance

How do we allow early passes to be verbose without penalizing the process?

```json
{
  "problem_id": "P018",
  "name": "verbosity_tolerance",
  "description": "How do we accept verbose early drafts?",
  "constraints": [
    "Must not reject drafts for being long",
    "Should track compression trajectory",
    "Must alert if compression stalls"
  ],
  "tolerance_policy": {
    "pass_1": {
      "max_expansion": "unlimited",
      "expectation": "Correctness over brevity"
    },
    "pass_2_3": {
      "max_expansion": "2x original",
      "expectation": "May grow while fixing bugs"
    },
    "pass_4_5": {
      "max_expansion": "1.5x original",
      "expectation": "Should start shrinking"
    },
    "pass_6_7": {
      "max_expansion": "1x original",
      "expectation": "Must be same size or smaller"
    },
    "pass_8": {
      "max_expansion": "0.8x original",
      "expectation": "Should be noticeably compressed"
    }
  },
  "stall_detection": {
    "trigger": "No compression for 2 consecutive passes after pass 4",
    "action": "Flag for review, suggest refactoring strategies"
  },
  "status": "open"
}
```

**Explanation**: The paradox says we must allow verbosity before achieving brevity. This policy encodes that: early passes can expand, but by pass 8, we expect compression. Stall detection catches cases where compression isn't happening.

---

### Problem 19: Essence Extraction

How do we identify the "essence" that must be preserved through compression?

```json
{
  "problem_id": "P019",
  "name": "essence_extraction",
  "description": "How do we identify what must be preserved vs. what can be removed?",
  "constraints": [
    "Must preserve behavior",
    "Should preserve intent/readability where possible",
    "Must identify truly redundant code"
  ],
  "essence_types": {
    "behavioral": {
      "description": "What the code does (inputs → outputs)",
      "preservation": "mandatory",
      "verification": "test cases, property checks"
    },
    "contractual": {
      "description": "Promises to callers (types, invariants)",
      "preservation": "mandatory",
      "verification": "type checking, assertions"
    },
    "intentional": {
      "description": "Why the code exists (comments, naming)",
      "preservation": "preferred",
      "verification": "human review"
    },
    "structural": {
      "description": "How the code is organized",
      "preservation": "flexible",
      "verification": "style guide compliance"
    }
  },
  "compression_candidates": [
    "Redundant null checks",
    "Unused variables",
    "Dead code paths",
    "Overly defensive error handling",
    "Verbose logging in production code"
  ],
  "status": "open"
}
```

**Explanation**: Not everything can be compressed away. Behavioral essence is sacred - compression that changes behavior is a bug. Contractual essence (types, APIs) is also mandatory. Intent and structure are softer - they can be refactored if the result is clearer.

---

## Dependencies Graph

```
P016 (refinement_strategy)
  └── P017 (compression_metrics)
        └── P018 (verbosity_tolerance)
              └── P019 (essence_extraction)
```

---

## Pass 1 Summary

Four problems identified:
1. **P016**: Refinement strategy - structured progression from correct to elegant
2. **P017**: Compression metrics - objective measures of code simplicity
3. **P018**: Verbosity tolerance - allowing early expansion before compression
4. **P019**: Essence extraction - identifying what must be preserved

---

---

## Pass 2: Interface Definitions

### P016 Interface: Refinement Engine

**Decision**: A dimension-aware refinement pipeline with pass-specific focus configuration.

```json
{
  "problem_id": "P016",
  "status": "interface_defined",
  "interface": {
    "RefinementDimension": {
      "type": "table",
      "fields": {
        "id": {
          "type": "string",
          "enum": ["correctness", "clarity", "efficiency", "brevity"]
        },
        "name": "string",
        "description": "string",
        "priority": {
          "type": "number",
          "range": [1, 10],
          "description": "Higher = more important"
        },
        "indicators": {
          "type": "table",
          "description": "How to measure this dimension"
        },
        "improvers": {
          "type": "string[]",
          "description": "Techniques to improve this dimension"
        }
      }
    },
    "RefinementPass": {
      "type": "table",
      "fields": {
        "pass_number": "number",
        "primary_focus": "string[]",
        "secondary_focus": "string[]",
        "prohibited_changes": "string[]",
        "prompt_template": "string",
        "acceptance_criteria": "AcceptanceCriteria"
      }
    },
    "AcceptanceCriteria": {
      "type": "table",
      "fields": {
        "must_not_regress": "string[]",
        "must_improve": "string[]",
        "may_trade_off": {
          "type": "table",
          "description": "Dimension pairs that can be traded"
        }
      }
    },
    "RefinementConfig": {
      "type": "table",
      "fields": {
        "dimensions": "RefinementDimension[]",
        "pass_schedule": "RefinementPass[]",
        "defaults": {
          "early_passes": {
            "range": [1, 3],
            "focus": ["correctness"],
            "description": "Get it working first"
          },
          "middle_passes": {
            "range": [4, 5],
            "focus": ["correctness", "clarity"],
            "description": "Make it understandable"
          },
          "late_passes": {
            "range": [6, 8],
            "focus": ["clarity", "efficiency", "brevity"],
            "description": "Make it elegant"
          }
        }
      }
    },
    "RefinementResult": {
      "type": "table",
      "fields": {
        "pass_number": "number",
        "input_code": "string",
        "output_code": "string",
        "changes_made": "Change[]",
        "dimension_scores": "table<string, number>",
        "regressions": "Regression[]",
        "improvements": "Improvement[]"
      }
    },
    "Change": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["add", "remove", "modify", "move", "rename"]
        },
        "location": {"line": "number", "column": "number"},
        "before": "string | nil",
        "after": "string | nil",
        "reason": "string",
        "dimension": "string"
      }
    },
    "Regression": {
      "type": "table",
      "fields": {
        "dimension": "string",
        "before_score": "number",
        "after_score": "number",
        "severity": {"type": "string", "enum": ["minor", "major", "blocking"]},
        "description": "string"
      }
    },
    "Improvement": {
      "type": "table",
      "fields": {
        "dimension": "string",
        "before_score": "number",
        "after_score": "number",
        "description": "string"
      }
    },
    "RefinementEngine": {
      "type": "table",
      "methods": {
        "refine": {
          "signature": "(code: string, pass: RefinementPass, context: table) -> RefinementResult"
        },
        "evaluate_dimensions": {
          "signature": "(code: string) -> table<string, number>"
        },
        "check_acceptance": {
          "signature": "(before: table<string, number>, after: table<string, number>, criteria: AcceptanceCriteria) -> boolean, Regression[]"
        },
        "suggest_focus": {
          "signature": "(scores: table<string, number>) -> string[]",
          "description": "Recommend which dimensions need attention"
        }
      }
    }
  }
}
```

**Explanation**: Refinement is multi-dimensional, not single-minded. The engine tracks all four dimensions (correctness, clarity, efficiency, brevity) but focuses on different ones at different passes. Regressions are detected and flagged - improving brevity at the cost of correctness is blocked.

---

### P017 Interface: Code Metrics System

**Decision**: A pluggable metrics framework with composite scoring and anti-gaming measures.

```json
{
  "problem_id": "P017",
  "status": "interface_defined",
  "interface": {
    "Metric": {
      "type": "table",
      "fields": {
        "id": "string",
        "name": "string",
        "description": "string",
        "type": {
          "type": "string",
          "enum": ["count", "ratio", "complexity", "pattern"]
        },
        "calculate": {
          "type": "function",
          "signature": "(code: string, ast?: table) -> number"
        },
        "weight": {
          "type": "number",
          "range": [0, 1]
        },
        "lower_is_better": "boolean",
        "anti_gaming": {
          "type": "string[]",
          "description": "Patterns that indicate gaming this metric"
        }
      }
    },
    "MetricsConfig": {
      "type": "table",
      "fields": {
        "metrics": {
          "line_count": {
            "weight": 0.15,
            "lower_is_better": true,
            "anti_gaming": ["Lines with multiple statements", "Minified code"]
          },
          "token_count": {
            "weight": 0.25,
            "lower_is_better": true,
            "anti_gaming": ["Single-letter variables", "Operator chaining"]
          },
          "cyclomatic_complexity": {
            "weight": 0.2,
            "lower_is_better": true,
            "anti_gaming": ["Inlining all conditions", "Removing error handling"]
          },
          "identifier_quality": {
            "weight": 0.2,
            "lower_is_better": false,
            "anti_gaming": ["Overly long names", "Hungarian notation abuse"]
          },
          "duplication_ratio": {
            "weight": 0.2,
            "lower_is_better": true,
            "anti_gaming": ["Premature abstraction"]
          }
        },
        "composite": {
          "formula": "weighted_sum",
          "normalization": "z_score",
          "output_range": [0, 100]
        }
      }
    },
    "MetricsResult": {
      "type": "table",
      "fields": {
        "individual": {
          "type": "table<string, MetricValue>",
          "description": "Each metric's result"
        },
        "composite_score": {
          "type": "number",
          "range": [0, 100]
        },
        "gaming_warnings": {
          "type": "string[]",
          "description": "Detected gaming attempts"
        },
        "comparison": {
          "type": "table | nil",
          "fields": {
            "previous_score": "number",
            "delta": "number",
            "improved_metrics": "string[]",
            "worsened_metrics": "string[]"
          }
        }
      }
    },
    "MetricValue": {
      "type": "table",
      "fields": {
        "raw": "number",
        "normalized": "number",
        "weighted": "number",
        "percentile": {
          "type": "number | nil",
          "description": "Compared to historical baseline"
        }
      }
    },
    "MetricsEngine": {
      "type": "table",
      "methods": {
        "calculate": {
          "signature": "(code: string, language: string) -> MetricsResult"
        },
        "compare": {
          "signature": "(before: MetricsResult, after: MetricsResult) -> ComparisonResult"
        },
        "detect_gaming": {
          "signature": "(code: string, metrics: MetricsResult) -> string[]"
        },
        "register_metric": {
          "signature": "(metric: Metric) -> void"
        },
        "set_baseline": {
          "signature": "(results: MetricsResult[]) -> void",
          "description": "Set historical baseline for percentile calculation"
        }
      }
    },
    "LanguageAdapter": {
      "type": "table",
      "fields": {
        "language": "string",
        "tokenizer": {
          "signature": "(code: string) -> Token[]"
        },
        "parser": {
          "signature": "(code: string) -> AST | nil, error?"
        },
        "complexity_calculator": {
          "signature": "(ast: AST) -> number"
        }
      },
      "supported_languages": ["lua", "python", "javascript", "go", "rust"]
    }
  }
}
```

**Explanation**: Metrics must be objective but also not gameable. The anti-gaming checks flag code that optimizes metrics at the expense of actual quality. Language adapters allow the system to work across different programming languages with appropriate tokenizers and parsers.

---

### P018 Interface: Verbosity Tolerance System

**Decision**: A pass-indexed tolerance schedule with trajectory tracking.

```json
{
  "problem_id": "P018",
  "status": "interface_defined",
  "interface": {
    "ToleranceSchedule": {
      "type": "table",
      "fields": {
        "pass_tolerances": {
          "type": "PassTolerance[]",
          "description": "One entry per pass number"
        },
        "trajectory_expectations": {
          "type": "TrajectoryExpectation[]"
        }
      }
    },
    "PassTolerance": {
      "type": "table",
      "fields": {
        "pass": "number",
        "max_expansion_ratio": {
          "type": "number",
          "description": "Max size relative to original (1.0 = same size)"
        },
        "expectation": {
          "type": "string",
          "enum": ["may_expand", "should_stabilize", "should_shrink", "must_shrink"]
        },
        "violation_action": {
          "type": "string",
          "enum": ["ignore", "warn", "flag", "block"]
        }
      }
    },
    "TrajectoryExpectation": {
      "type": "table",
      "fields": {
        "pass_range": {"start": "number", "end": "number"},
        "expected_trend": {
          "type": "string",
          "enum": ["expanding", "stable", "compressing"]
        },
        "max_variance": {
          "type": "number",
          "description": "Allowed deviation from trend"
        }
      }
    },
    "ToleranceChecker": {
      "type": "table",
      "fields": {
        "schedule": "ToleranceSchedule",
        "original_size": "number",
        "history": "SizePoint[]"
      },
      "methods": {
        "record": {
          "signature": "(pass: number, size: number) -> ToleranceResult"
        },
        "check_trajectory": {
          "signature": "() -> TrajectoryStatus"
        },
        "is_stalled": {
          "signature": "() -> boolean, string?",
          "description": "Returns true and reason if compression stalled"
        },
        "get_recommendation": {
          "signature": "() -> string"
        }
      }
    },
    "SizePoint": {
      "type": "table",
      "fields": {
        "pass": "number",
        "size": "number",
        "ratio_to_original": "number",
        "delta_from_previous": "number"
      }
    },
    "ToleranceResult": {
      "type": "table",
      "fields": {
        "pass": "number",
        "size": "number",
        "ratio": "number",
        "tolerance": "PassTolerance",
        "within_tolerance": "boolean",
        "violation_type": {
          "type": "string | nil",
          "enum": ["too_large", "wrong_direction"]
        },
        "action_taken": "string | nil"
      }
    },
    "TrajectoryStatus": {
      "type": "table",
      "fields": {
        "current_trend": {
          "type": "string",
          "enum": ["expanding", "stable", "compressing"]
        },
        "expected_trend": "string",
        "on_track": "boolean",
        "deviation": "number",
        "passes_until_expected_compression": "number | nil"
      }
    },
    "DefaultSchedule": {
      "pass_tolerances": [
        {"pass": 1, "max_expansion_ratio": 999, "expectation": "may_expand", "violation_action": "ignore"},
        {"pass": 2, "max_expansion_ratio": 2.0, "expectation": "may_expand", "violation_action": "warn"},
        {"pass": 3, "max_expansion_ratio": 2.0, "expectation": "may_expand", "violation_action": "warn"},
        {"pass": 4, "max_expansion_ratio": 1.5, "expectation": "should_stabilize", "violation_action": "flag"},
        {"pass": 5, "max_expansion_ratio": 1.5, "expectation": "should_stabilize", "violation_action": "flag"},
        {"pass": 6, "max_expansion_ratio": 1.2, "expectation": "should_shrink", "violation_action": "flag"},
        {"pass": 7, "max_expansion_ratio": 1.0, "expectation": "should_shrink", "violation_action": "warn"},
        {"pass": 8, "max_expansion_ratio": 0.9, "expectation": "must_shrink", "violation_action": "block"}
      ],
      "trajectory_expectations": [
        {"pass_range": {"start": 1, "end": 3}, "expected_trend": "expanding", "max_variance": 0.5},
        {"pass_range": {"start": 4, "end": 5}, "expected_trend": "stable", "max_variance": 0.2},
        {"pass_range": {"start": 6, "end": 8}, "expected_trend": "compressing", "max_variance": 0.3}
      ]
    },
    "StallDetection": {
      "config": {
        "min_passes_to_detect": 2,
        "compression_threshold": 0.05,
        "description": "Stalled if < 5% compression for 2+ passes after pass 4"
      },
      "interventions": [
        "Suggest refactoring patterns",
        "Identify largest remaining redundancies",
        "Propose aggressive simplifications"
      ]
    }
  }
}
```

**Explanation**: The paradox says we allow early verbosity but expect eventual compression. The tolerance schedule encodes this precisely. Pass 1 has no size limit; pass 8 requires actual shrinkage. Stall detection catches cases where the system is stuck and can't compress further.

---

### P019 Interface: Essence Preservation System

**Decision**: A hierarchical essence model with mandatory/preferred/flexible preservation rules.

```json
{
  "problem_id": "P019",
  "status": "interface_defined",
  "interface": {
    "Essence": {
      "type": "table",
      "fields": {
        "id": "string",
        "category": {
          "type": "string",
          "enum": ["behavioral", "contractual", "intentional", "structural"]
        },
        "description": "string",
        "preservation_level": {
          "type": "string",
          "enum": ["mandatory", "preferred", "flexible"]
        },
        "verification_method": {
          "type": "string",
          "enum": ["test", "type_check", "assertion", "human_review", "diff"]
        },
        "representation": {
          "type": "any",
          "description": "The actual essence data (tests, types, comments, etc.)"
        }
      }
    },
    "EssenceExtractor": {
      "type": "table",
      "methods": {
        "extract": {
          "signature": "(code: string, language: string) -> EssenceSet"
        },
        "extract_behavioral": {
          "signature": "(code: string) -> BehavioralEssence[]",
          "description": "Identify input/output relationships"
        },
        "extract_contractual": {
          "signature": "(code: string) -> ContractualEssence[]",
          "description": "Identify type signatures, invariants"
        },
        "extract_intentional": {
          "signature": "(code: string) -> IntentionalEssence[]",
          "description": "Extract comments, naming patterns"
        },
        "extract_structural": {
          "signature": "(code: string) -> StructuralEssence[]",
          "description": "Identify organization patterns"
        }
      }
    },
    "EssenceSet": {
      "type": "table",
      "fields": {
        "behavioral": "BehavioralEssence[]",
        "contractual": "ContractualEssence[]",
        "intentional": "IntentionalEssence[]",
        "structural": "StructuralEssence[]"
      }
    },
    "BehavioralEssence": {
      "type": "table",
      "fields": {
        "function_name": "string",
        "inputs": "TypeSpec[]",
        "outputs": "TypeSpec[]",
        "side_effects": "string[]",
        "test_cases": {
          "type": "TestCase[]",
          "description": "Concrete input/output examples"
        },
        "preservation_level": "mandatory"
      }
    },
    "ContractualEssence": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["signature", "invariant", "precondition", "postcondition"]
        },
        "specification": "string",
        "location": {"file": "string", "line": "number"},
        "preservation_level": "mandatory"
      }
    },
    "IntentionalEssence": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["doc_comment", "inline_comment", "naming_pattern"]
        },
        "content": "string",
        "location": {"file": "string", "line": "number"},
        "preservation_level": "preferred"
      }
    },
    "StructuralEssence": {
      "type": "table",
      "fields": {
        "type": {
          "type": "string",
          "enum": ["module_boundary", "abstraction_layer", "dependency_direction"]
        },
        "description": "string",
        "preservation_level": "flexible"
      }
    },
    "TestCase": {
      "type": "table",
      "fields": {
        "input": "any",
        "expected_output": "any",
        "description": "string | nil"
      }
    },
    "EssenceVerifier": {
      "type": "table",
      "methods": {
        "verify": {
          "signature": "(original_essence: EssenceSet, new_code: string) -> VerificationResult"
        },
        "check_behavioral": {
          "signature": "(essence: BehavioralEssence[], code: string) -> boolean, Violation[]"
        },
        "check_contractual": {
          "signature": "(essence: ContractualEssence[], code: string) -> boolean, Violation[]"
        },
        "diff_intentional": {
          "signature": "(essence: IntentionalEssence[], code: string) -> Diff[]"
        }
      }
    },
    "VerificationResult": {
      "type": "table",
      "fields": {
        "preserved": "boolean",
        "mandatory_violations": "Violation[]",
        "preferred_changes": "Change[]",
        "structural_changes": "Change[]",
        "can_proceed": "boolean"
      }
    },
    "Violation": {
      "type": "table",
      "fields": {
        "essence_id": "string",
        "category": "string",
        "description": "string",
        "severity": {
          "type": "string",
          "enum": ["blocking", "warning"]
        },
        "suggested_fix": "string | nil"
      }
    },
    "CompressionCandidate": {
      "type": "table",
      "fields": {
        "location": {"file": "string", "line_start": "number", "line_end": "number"},
        "type": {
          "type": "string",
          "enum": ["redundant_check", "unused_variable", "dead_code", "verbose_pattern"]
        },
        "safe_to_remove": "boolean",
        "essence_impact": "string[]",
        "estimated_savings": "number"
      }
    }
  }
}
```

**Explanation**: Not everything can be compressed. Behavioral essence (what the code does) is sacred. Contractual essence (types, APIs) is also mandatory. Intentional essence (comments, names) is preferred but negotiable. Structural essence (organization) is flexible. The verifier blocks changes that would violate mandatory essence.

---

## Pass 2 Summary

All four problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P016 | RefinementDimension + RefinementEngine | Dimension-aware with pass-specific focus |
| P017 | Metric + MetricsEngine | Pluggable metrics with anti-gaming |
| P018 | ToleranceSchedule + ToleranceChecker | Pass-indexed tolerance with trajectory |
| P019 | Essence + EssenceExtractor + EssenceVerifier | Hierarchical preservation rules |

**Status Update**: All problems advanced from `open` to `interface_defined`.

**Cross-Document Links**:
- P016 uses P003 angles to drive refinement passes
- P017 feeds P012 convergence detection (metrics stability = convergence)
- P018 integrates with P013 bounds (size is a bounded resource)
- P019 constrains P030 auto-fix (can't auto-fix essence violations)

---

## Next Pass Preview

Pass 3 will:
- Implement the refinement prompt templates
- Build the metric calculators for Lua
- Create the trajectory visualization
- Write the essence extraction parsers
