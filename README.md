# repo-context-kit

[![npm version](https://img.shields.io/npm/v/repo-context-kit)](https://www.npmjs.com/package/repo-context-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-blue)](#mcp-runtime-interface)

Bounded AI Development Runtime for AI Coding Tools

repo-context-kit helps AI coding tools work inside controlled, inspectable, replayable development workflows.

- Bounded context (worksets, budgets, caps)
- Deterministic workflows (tasks, confirmations, stable outputs)
- Runtime contracts (validated JSON payloads)
- Risk intelligence (structured risks + explanations)
- Snapshot observability (history, diff, inspection)

## Quick Start

Run these from the root of the repo you want to work on:

```bash
npx repo-context-kit init
npx repo-context-kit scan
npx repo-context-kit auto --goal "Add auth"
```

What happens:

- `init`: writes workflow scaffolding you review and commit.
- `scan`: generates `.aidw/*` indexes so AI tools have an accurate project map.
- `auto`: turns a goal into a task + bounded workset + runtime contract + risks + next actions (no source edits).

## Why

Typical AI coding tools struggle with:

- Context explosion and token overload
- Hallucinated edits without clear scope
- Uncontrolled execution paths
- Non-repeatable sessions
- Hidden reasoning and hard-to-audit decisions

repo-context-kit is designed to solve those with:

- Bounded context selection (worksets, caps, safe indexes)
- Human-controlled execution (confirmation gates)
- Deterministic, inspectable runtime outputs (contracts, snapshots)
- Explicit risk intelligence (structured risks + evidence)

## Workflow

Minimal mental model:

goal → task → workset → runtime contract → risks → snapshots → explainability

Core principle: the AI does not own autonomous execution rights. Humans stay in control of edits, tests, commits, and PRs.

## Doc-Driven Runtime Planning

If you already have a design doc or PRD (the source of truth), you can enter the bounded workflow deterministically (no LLM parsing):

```bash
repo-context-kit auto --from-doc docs/product.md
```

Or generate task files directly from the document:

```bash
repo-context-kit task generate --from-doc docs/product.md --dry-run --json
repo-context-kit task generate --from-doc docs/product.md
```

This is doc-driven bounded planning. It does not auto-edit code, run tests, commit, or open PRs.

## Runtime Architecture

See [docs/runtime-architecture.md](./docs/runtime-architecture.md) for the full diagram and layer breakdown.

High-level layers:

Repo
↓
Scan / Index
↓
Task Runtime
↓
Workset Runtime
↓
Runtime Contract
↓
Risk Intelligence
↓
Snapshots / Explainability
↓
MCP Runtime Interface

## Safety Boundaries

repo-context-kit:

- does NOT auto-edit source code
- does NOT auto-run arbitrary commands
- does NOT bypass confirmation gates
- does NOT execute autonomous coding loops
- does NOT run background agents
- does NOT self-heal repositories

It provides bounded, inspectable scaffolding. You decide what actually runs.

## MCP Runtime Interface

This project ships an MCP stdio server as a runtime interface for bounded AI development workflows.

- Deterministic: tools map to the existing CLI behavior.
- Inspectable: outputs are bounded, structured, and validated.
- Replayable: runtime snapshots support historical inspection and diff.
- Bounded: read-only by default; write/test tools require explicit opt-in flags.

Run (read-only):

```bash
repo-context-kit-mcp --root /path/to/repo
```

Enable write tools:

```bash
repo-context-kit-mcp --root /path/to/repo --enable-write
```

Enable gated test execution (still requires a valid gate token and allowlisted commands):

```bash
repo-context-kit-mcp --root /path/to/repo --enable-write --enable-tests
```

## Runtime Snapshots

CLI snapshot UX (bounded, read-only inspection):

```bash
repo-context-kit runtime snapshot list
repo-context-kit runtime snapshot read <snapshotId>
repo-context-kit runtime snapshot explain <snapshotId>
repo-context-kit runtime snapshot diff <from> <to>
repo-context-kit runtime snapshot retention
```

MCP snapshot APIs (read-only):

- `rck.runtime.snapshot.list`
- `rck.runtime.snapshot.read`
- `rck.runtime.snapshot.diff`
- `rck.runtime.explain`

## Features (Organized)

### Core Workflow

- `init`
- `scan`
- `auto`
- `runtime snapshot`

### Task Runtime

- `task` (task files + prompts/checklists/PR text)
- `context` (bounded worksets)
- `execute` (pause/confirm flow)
- `gate` (allowlisted, token-gated test execution)

### Runtime Intelligence

- `rck.runtime.risks` / risk sections in runtime contracts
- `learn` / `check` (lessons-derived constraints)
- `decision explain` (why the runtime made a decision)
- snapshots + explainability

### MCP Runtime APIs

- `rck.runtime.plan`
- `rck.runtime.inspect`
- `rck.runtime.risks`
- `rck.runtime.validate`
- `rck.runtime.snapshot.*`

## Reference

For a scenario-based runbook (commands, workflows, and troubleshooting), see [OPERATIONS.md](./OPERATIONS.md).

## License

MIT. See [LICENSE](./LICENSE).
