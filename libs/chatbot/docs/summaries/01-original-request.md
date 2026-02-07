# Summary: Original Request

**Pass: 2 of 8**
**Focus: Interface definitions, data shapes**

---

## Source Section

The opening section of the Code Designer Proposal, containing the user's stream-of-consciousness description of the desired system.

## Key Points

1. **Code-designer mode** - A toggleable functionality enabled at program startup

2. **Tool documentation display** - Each tool call shows the first 10 lines of its documentation before execution, grounding the LLM in actual interfaces

3. **Reciprocal processing** - Output is analyzed from an "orbiting angle" - some form of perspective-shifted verification

4. **Multi-pass approach** - Instead of trusting patterns, continually pass through from different angles until all relevant approaches are attempted

5. **Layered LLM architecture** - A "next-higher-up LLM" (supervisor, close to user) generates JSON tool calls; a worker LLM executes them

6. **Line-by-line processing** - Operates on temporary source files, processing each line individually

7. **Bug prevention** - Designed to compensate for faster, less powerful models by using redundancy and multiple perspectives

## Notable Phrases

- "text continuation and all of it's infinite bless"
- "the nature of the solution will seem clear"
- "you'll be sure to arrive on time"
- "approaching from differing locations"

## Tone

Stream-of-consciousness with self-aware interruptions ("hang on, I'm getting ahead of myself"). Philosophical rather than technical. The request describes a feeling or intuition about how the system should work, leaving concrete implementation details open.

---

## Pass 1: Problem Identification

### Problem 1: Mode Activation

The system needs a way to enter "code-designer mode." This implies:
- A flag or command-line argument
- State that persists for the session
- Different behavior when enabled vs disabled

```json
{
  "problem_id": "P001",
  "name": "mode_activation",
  "description": "How does the user enable code-designer mode?",
  "constraints": [
    "Must be toggleable at startup",
    "Should not require code changes to enable",
    "State must be accessible throughout the program"
  ],
  "candidate_solutions": [
    "Command-line flag: --code-designer",
    "Environment variable: CODE_DESIGNER=1",
    "Interactive command: /code-designer on"
  ],
  "status": "open"
}
```

**Explanation**: The mode activation problem is foundational. Every other feature depends on knowing whether we're in code-designer mode. The solution must be simple (users shouldn't struggle to enable it) and unambiguous (the program must know definitively whether it's on or off).

---

### Problem 2: Tool Documentation Retrieval

Each tool must expose its documentation in a parseable format. The first 10 lines are displayed before execution.

```json
{
  "problem_id": "P002",
  "name": "tool_doc_retrieval",
  "description": "How do we get the first 10 lines of documentation for a tool?",
  "constraints": [
    "Tools are external scripts in scripts/ directory",
    "Documentation format must be consistent",
    "Retrieval must not execute the tool"
  ],
  "current_state": {
    "tools_have": "--tool-info flag returning JSON",
    "tools_lack": "Extended documentation beyond parameter spec"
  },
  "candidate_solutions": [
    "Add --tool-docs flag to each tool script",
    "Embed docs as comments, parse first 10 comment lines",
    "Separate .md file per tool: scripts/read_file.md"
  ],
  "status": "open"
}
```

**Explanation**: The existing tools return `--tool-info` JSON with name, description, and parameters. But "first 10 lines of documentation" suggests something more narrative - a guide, not just a schema. We need to decide where this documentation lives and how it's formatted.

---

### Problem 3: Reciprocal Processing Architecture

Output must be analyzed from an "orbiting angle." This requires a second processing step that examines the first step's output.

```json
{
  "problem_id": "P003",
  "name": "reciprocal_processing",
  "description": "How do we analyze LLM output from a different perspective?",
  "constraints": [
    "Must not simply repeat the same prompt",
    "Perspective shift must be meaningful",
    "Results must feed back into the process"
  ],
  "unknowns": [
    "What constitutes an 'angle'?",
    "How many angles are needed?",
    "How do we know when angles are exhausted?"
  ],
  "candidate_solutions": [
    "Predefined angle set: [correctness, efficiency, style, security]",
    "Dynamic angles based on code content",
    "User-defined angle configuration"
  ],
  "status": "open"
}
```

**Explanation**: This is the most abstract problem. "Orbiting angle" is poetic, not technical. We must translate it into concrete operations. One interpretation: each "angle" is a different evaluation criterion, implemented as a different prompt or system message to the LLM.

---

### Problem 4: Supervisor-Worker Communication

The layered architecture requires a protocol between the supervisor LLM (powerful, near user) and worker LLM (fast, executes tools).

```json
{
  "problem_id": "P004",
  "name": "supervisor_worker_protocol",
  "description": "How do supervisor and worker LLMs communicate?",
  "constraints": [
    "Supervisor generates structured requests",
    "Worker must understand and execute requests",
    "Results must flow back to supervisor"
  ],
  "data_structures": {
    "supervisor_request": {
      "type": "tool_call | verify | refine",
      "tool": "string (if type=tool_call)",
      "arguments": "object",
      "context": "string - what the supervisor wants accomplished"
    },
    "worker_response": {
      "status": "success | error | needs_clarification",
      "result": "any",
      "observations": "array of strings - what the worker noticed"
    }
  },
  "status": "open"
}
```

**Explanation**: The supervisor doesn't execute tools directly; it delegates to a worker. This separation allows the supervisor to be a more powerful (slower, more expensive) model focused on planning, while the worker is a faster (cheaper) model focused on execution. The protocol must be unambiguous so both sides understand each other.

---

### Problem 5: Line-by-Line Processing Loop

Source files are processed one line at a time. Each line goes through the multi-pass verification.

```json
{
  "problem_id": "P005",
  "name": "line_processing_loop",
  "description": "How do we iterate through source lines with multi-pass verification?",
  "constraints": [
    "Each line processed independently",
    "Context from previous lines may be needed",
    "Must handle multi-line constructs (functions, blocks)"
  ],
  "open_questions": [
    "Is 'line' a physical line or logical statement?",
    "How much context is passed between lines?",
    "What triggers advancement to the next line?"
  ],
  "pseudocode": [
    "for each line in source_file:",
    "  for each pass in 1..8:",
    "    for each angle in angles:",
    "      result = evaluate(line, angle, context)",
    "      update(context, result)",
    "    if converged(results): break",
    "  commit(line)"
  ],
  "status": "open"
}
```

**Explanation**: The nested loop structure (lines × passes × angles) could be expensive. We need convergence checks to exit early when further iteration adds no value. The definition of "line" also matters - a function definition spanning 10 physical lines might be one logical unit.

---

## Dependencies Graph

```
P001 (mode_activation)
  └── P002 (tool_doc_retrieval)
        └── P004 (supervisor_worker_protocol)
              └── P003 (reciprocal_processing)
                    └── P005 (line_processing_loop)
```

Everything flows from mode activation. Each subsequent problem assumes the previous is solved.

---

## Pass 1 Summary

Five core problems identified:
1. **P001**: How to activate code-designer mode
2. **P002**: How to retrieve tool documentation
3. **P003**: How to implement perspective-shifted verification
4. **P004**: How supervisor and worker LLMs communicate
5. **P005**: How to process lines with multi-pass verification

All problems are currently **open**. Pass 2 will begin proposing concrete solutions.

---

---

## Pass 2: Interface Definitions

### P001 Interface: Mode Configuration

**Decision**: Use a combination approach - environment variable for scripts, command-line for interactive use, runtime toggle for flexibility.

```json
{
  "problem_id": "P001",
  "status": "interface_defined",
  "interface": {
    "ModeConfig": {
      "type": "table",
      "fields": {
        "enabled": {
          "type": "boolean",
          "description": "Whether code-designer mode is active",
          "default": false
        },
        "source": {
          "type": "string",
          "enum": ["cli", "env", "runtime", "config_file"],
          "description": "How the mode was activated"
        },
        "activated_at": {
          "type": "number",
          "description": "Unix timestamp when mode was enabled"
        }
      }
    },
    "functions": {
      "is_code_designer_mode": {
        "signature": "() -> boolean",
        "description": "Check if mode is currently enabled"
      },
      "enable_code_designer": {
        "signature": "(source: string) -> ModeConfig",
        "description": "Enable the mode, return new config"
      },
      "disable_code_designer": {
        "signature": "() -> ModeConfig",
        "description": "Disable the mode, return new config"
      }
    }
  },
  "lua_sketch": "-- Global state\nlocal mode_config = {\n  enabled = false,\n  source = nil,\n  activated_at = nil\n}\n\nfunction is_code_designer_mode()\n  return mode_config.enabled\nend"
}
```

**Explanation**: The interface separates the boolean state (`enabled`) from metadata (`source`, `activated_at`). This allows debugging ("how did we get into this mode?") and auditing. The functions provide a clean API that hides the global state behind accessors.

---

### P002 Interface: Tool Documentation

**Decision**: Each tool has a companion `.md` file. The tool registry loads and caches documentation.

```json
{
  "problem_id": "P002",
  "status": "interface_defined",
  "interface": {
    "ToolDoc": {
      "type": "table",
      "fields": {
        "tool_name": {
          "type": "string",
          "description": "Matches the tool script name"
        },
        "summary": {
          "type": "string",
          "description": "One-line description"
        },
        "full_text": {
          "type": "string",
          "description": "Complete documentation content"
        },
        "first_n_lines": {
          "type": "function",
          "signature": "(n: number) -> string",
          "description": "Return first N lines of documentation"
        },
        "sections": {
          "type": "table",
          "description": "Parsed sections: {usage, parameters, examples, notes}"
        }
      }
    },
    "ToolRegistry": {
      "type": "table",
      "fields": {
        "tools": {
          "type": "table<string, ToolDoc>",
          "description": "Map of tool_name -> documentation"
        }
      },
      "methods": {
        "load": {
          "signature": "(tool_name: string) -> ToolDoc | nil, error",
          "description": "Load documentation for a tool"
        },
        "get_preview": {
          "signature": "(tool_name: string, lines: number) -> string",
          "description": "Get first N lines for display before execution"
        },
        "list_tools": {
          "signature": "() -> string[]",
          "description": "List all available tools"
        }
      }
    }
  },
  "file_structure": {
    "scripts/": {
      "read_file.lua": "tool implementation",
      "read_file.md": "tool documentation",
      "write_file.lua": "tool implementation",
      "write_file.md": "tool documentation"
    }
  },
  "doc_format": "# Tool: {name}\n\n## Summary\n{one-liner}\n\n## Parameters\n{param table}\n\n## Examples\n{usage examples}\n\n## Notes\n{caveats, edge cases}"
}
```

**Explanation**: Separating documentation into `.md` files allows rich formatting and easy editing without touching code. The `first_n_lines` method directly implements the "show first 10 lines" requirement. Caching in the registry prevents re-reading files on every tool call.

---

### P003 Interface: Angle System

**Decision**: Angles are defined as configuration objects with prompts and evaluation criteria.

```json
{
  "problem_id": "P003",
  "status": "interface_defined",
  "interface": {
    "Angle": {
      "type": "table",
      "fields": {
        "id": {
          "type": "string",
          "description": "Unique identifier: correctness, efficiency, style, security"
        },
        "name": {
          "type": "string",
          "description": "Human-readable name"
        },
        "system_prompt": {
          "type": "string",
          "description": "Injected into LLM context to shift perspective"
        },
        "evaluation_criteria": {
          "type": "string[]",
          "description": "What this angle looks for"
        },
        "weight": {
          "type": "number",
          "range": [0, 1],
          "description": "Importance relative to other angles"
        }
      }
    },
    "AngleResult": {
      "type": "table",
      "fields": {
        "angle_id": "string",
        "issues_found": {
          "type": "Issue[]",
          "description": "Problems identified from this angle"
        },
        "suggestions": {
          "type": "string[]",
          "description": "Improvement recommendations"
        },
        "confidence": {
          "type": "number",
          "range": [0, 1],
          "description": "How confident the angle is in its assessment"
        },
        "pass_number": "number"
      }
    },
    "Issue": {
      "type": "table",
      "fields": {
        "severity": {
          "type": "string",
          "enum": ["low", "medium", "high", "critical"]
        },
        "location": {
          "type": "table",
          "fields": {"line": "number", "column": "number | nil"}
        },
        "description": "string",
        "suggested_fix": "string | nil"
      }
    }
  },
  "default_angles": [
    {
      "id": "correctness",
      "name": "Correctness Check",
      "system_prompt": "You are reviewing code for correctness. Focus on: bugs, edge cases, error handling, logic errors. Ignore style and performance.",
      "weight": 0.4
    },
    {
      "id": "efficiency",
      "name": "Efficiency Check",
      "system_prompt": "You are reviewing code for efficiency. Focus on: algorithmic complexity, unnecessary work, memory usage. Ignore style.",
      "weight": 0.25
    },
    {
      "id": "style",
      "name": "Style Check",
      "system_prompt": "You are reviewing code for style. Focus on: readability, naming, idioms, consistency. Ignore correctness.",
      "weight": 0.15
    },
    {
      "id": "security",
      "name": "Security Check",
      "system_prompt": "You are reviewing code for security. Focus on: injection, validation, authentication, data exposure. Ignore style.",
      "weight": 0.2
    }
  ]
}
```

**Explanation**: Each angle is fully specified by its system prompt - this is how we achieve "perspective shift." The weights allow prioritization (correctness matters more than style). The `AngleResult` captures not just issues but confidence, enabling downstream aggregation logic.

---

### P004 Interface: Supervisor-Worker Protocol

**Decision**: JSON-based message passing with typed request/response envelopes.

```json
{
  "problem_id": "P004",
  "status": "interface_defined",
  "interface": {
    "SupervisorRequest": {
      "type": "table",
      "fields": {
        "request_id": {
          "type": "string",
          "description": "UUID for tracking"
        },
        "type": {
          "type": "string",
          "enum": ["tool_call", "verify", "refine", "analyze"],
          "description": "What kind of work is requested"
        },
        "payload": {
          "type": "table",
          "description": "Type-specific data"
        },
        "context": {
          "type": "table",
          "fields": {
            "original_request": "string",
            "current_code": "string | nil",
            "pass_number": "number",
            "angle_id": "string | nil",
            "history": "WorkerResponse[]"
          }
        },
        "constraints": {
          "type": "table",
          "fields": {
            "max_tokens": "number",
            "timeout_ms": "number",
            "must_preserve": "string[] | nil"
          }
        }
      }
    },
    "WorkerResponse": {
      "type": "table",
      "fields": {
        "request_id": "string",
        "status": {
          "type": "string",
          "enum": ["success", "partial", "error", "needs_input"]
        },
        "result": {
          "type": "any",
          "description": "The produced output (code, analysis, etc.)"
        },
        "observations": {
          "type": "string[]",
          "description": "Notable things the worker discovered"
        },
        "metrics": {
          "type": "table",
          "fields": {
            "tokens_used": "number",
            "duration_ms": "number",
            "model": "string"
          }
        },
        "error": {
          "type": "table | nil",
          "fields": {
            "code": "string",
            "message": "string",
            "recoverable": "boolean"
          }
        }
      }
    },
    "PayloadTypes": {
      "tool_call": {
        "tool_name": "string",
        "arguments": "table"
      },
      "verify": {
        "code": "string",
        "angle_id": "string",
        "criteria": "string[]"
      },
      "refine": {
        "code": "string",
        "issues": "Issue[]",
        "preserve": "string[]"
      },
      "analyze": {
        "code": "string",
        "questions": "string[]"
      }
    }
  }
}
```

**Explanation**: The protocol is stateless - each request contains all needed context. The `request_id` enables correlation and debugging. Typed payloads (`PayloadTypes`) ensure the worker knows exactly what's expected for each request type. The response includes metrics for cost tracking and debugging.

---

### P005 Interface: Processing Loop

**Decision**: A state machine with explicit phases and transitions.

```json
{
  "problem_id": "P005",
  "status": "interface_defined",
  "interface": {
    "ProcessingState": {
      "type": "table",
      "fields": {
        "source_file": "string",
        "lines": "Line[]",
        "current_line_idx": "number",
        "current_pass": "number",
        "current_angle_idx": "number",
        "accumulated_results": "AngleResult[]",
        "status": {
          "type": "string",
          "enum": ["initializing", "processing", "converged", "max_iterations", "error", "complete"]
        }
      }
    },
    "Line": {
      "type": "table",
      "fields": {
        "number": "number",
        "original_content": "string",
        "current_content": "string",
        "is_modified": "boolean",
        "pass_history": "PassResult[]"
      }
    },
    "PassResult": {
      "type": "table",
      "fields": {
        "pass_number": "number",
        "angles_run": "AngleResult[]",
        "modifications": "Modification[]",
        "converged": "boolean"
      }
    },
    "Modification": {
      "type": "table",
      "fields": {
        "before": "string",
        "after": "string",
        "reason": "string",
        "angle_id": "string"
      }
    },
    "StateMachine": {
      "transitions": {
        "initializing": ["processing", "error"],
        "processing": ["processing", "converged", "max_iterations", "error"],
        "converged": ["complete"],
        "max_iterations": ["complete"],
        "error": ["complete"]
      },
      "events": {
        "line_loaded": "initializing -> processing",
        "angle_complete": "processing -> processing",
        "all_angles_complete": "processing -> processing (next pass) | converged",
        "max_passes_reached": "processing -> max_iterations",
        "error_occurred": "* -> error",
        "cleanup_done": "converged | max_iterations | error -> complete"
      }
    },
    "ConvergenceCriteria": {
      "type": "table",
      "fields": {
        "min_passes": {
          "type": "number",
          "default": 2,
          "description": "Minimum passes before convergence allowed"
        },
        "issue_stability": {
          "type": "number",
          "default": 2,
          "description": "Consecutive passes with same issue count"
        },
        "content_stability": {
          "type": "number",
          "default": 2,
          "description": "Consecutive passes with no modifications"
        }
      }
    }
  }
}
```

**Explanation**: The state machine makes transitions explicit and auditable. Each line tracks its own history, enabling rollback if needed. Convergence requires both issue stability (no new problems found) and content stability (no more changes being made). The minimum passes requirement prevents premature declaration of convergence.

---

## Pass 2 Summary

All five problems now have defined interfaces:

| Problem | Interface | Key Decision |
|---------|-----------|--------------|
| P001 | ModeConfig + functions | Multi-source activation (CLI, env, runtime) |
| P002 | ToolDoc + ToolRegistry | Companion .md files per tool |
| P003 | Angle + AngleResult + Issue | System prompt defines perspective shift |
| P004 | SupervisorRequest + WorkerResponse | Stateless JSON protocol with typed payloads |
| P005 | ProcessingState + StateMachine | Explicit state machine with convergence criteria |

**Status Update**: All problems advanced from `open` to `interface_defined`.

---

## Dependencies Graph (Updated)

```
P001 (mode_activation) [interface_defined]
  └── P002 (tool_doc_retrieval) [interface_defined]
        └── P004 (supervisor_worker_protocol) [interface_defined]
              └── P003 (reciprocal_processing) [interface_defined]
                    └── P005 (line_processing_loop) [interface_defined]
```

---

## Next Pass Preview

Pass 3 will:
- Implement skeleton Lua code for P001 and P002
- Write validation logic for protocol messages
- Define angle prompt templates
- Create state machine transition handlers
