# Instructions for Readers

## What These Documents Are

Each `.md` file in this collection is a **guide to the program**. Not documentation *about* code
that exists elsewhere - the code lives *here*, embedded as data within the explanatory text.

Problems are discussed and dealt with one by one. Solutions emerge through description.

## The Format

Code appears inline as data, wrapped in JSON or fenced blocks:

```json
{
  "function": "verify_output",
  "purpose": "Checks generated code against multiple criteria",
  "parameters": {
    "code": "string - the generated source",
    "angles": "array - perspectives to evaluate from"
  },
  "returns": "object - { valid: bool, issues: array, suggestions: array }"
}
```

Each code block is accompanied by textbook-style descriptions:
- What it is
- Why it does what it does
- How it connects to adjacent components
- What problems it solves

## The 64-Pass Architecture

We work through the documents one-by-one until completing one pass of refinement.

Then we do 56 more. **Total: 64 passes.**

### Why 64?

- 8 documents × 8 examinations each = 64
- Each segment gets examined 8 times (pronounced: thrice/nice/fiest)
- Progressive expansion at each pass
- Eventually, no further specification is possible beyond code itself

### What Happens at Each Pass

| Pass Range | Focus |
|------------|-------|
| 1-8 | Initial structure, problem identification |
| 9-16 | Interface definitions, data shapes |
| 17-24 | Algorithm sketches, flow descriptions |
| 25-32 | Implementation details, edge cases |
| 33-40 | Error handling, validation logic |
| 41-48 | Integration points, tool interfaces |
| 49-56 | Optimization, refinement |
| 57-64 | Final code, complete explanations |

## Code as Data

Code is stored as data. This is intentional.

When the LLM scans through these documents, it can:
- Parse the embedded code structures
- Extract tool-style description outputs
- Use them to develop the processing host
- Pick up relevant parts contextually

The code is not meant to be copied into `.lua` files and run directly (yet). It is meant to be **read, processed, and understood** as part of the documentation flow.

## How to Read These Documents

1. **Sequentially first** - Read 01 through 08 in order to understand the full vision
2. **Then iteratively** - Each pass adds detail; re-read with fresh eyes
3. **Treat code as prose** - The JSON blocks are sentences in a technical language
4. **Explain your decisions** - When you reach code, describe what each part does and why

## The Goal

By pass 64, every component will be:
- Fully specified
- Exhaustively explained
- Tested against multiple angles
- Ready to crystallize into executable form

The documentation *becomes* the program. The program *is* the documentation.

---

## Current Status

- [x] Pass 0: Initial proposal captured
- [x] Pass 0: Sections identified and summarized
- [ ] Pass 1: Begin refinement of 01-original-request.md
- [ ] Passes 2-64: Pending

## File Manifest

```
docs/
├── instructions.md          (this file)
├── code-designer-proposal.md (source document)
└── summaries/
    ├── 01-original-request.md
    ├── 02-clarifying-questions.md
    ├── 03-interpretive-analysis.md
    ├── 04-arriving-on-time.md
    ├── 05-one-line-programmer.md
    ├── 06-differing-locations.md
    ├── 07-text-continuation.md
    └── 08-typo-as-signal.md
```
