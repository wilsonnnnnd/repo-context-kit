# Runtime Architecture (Bounded)

This document explains how repo-context-kit works as a bounded AI development runtime. It is not an autonomous coding agent.

## Workflow Diagram

```
goal
  ↓
task (human-reviewable markdown)
  ↓
workset (bounded context selection)
  ↓
runtime contract (validated, deterministic JSON)
  ↓
risks (structured risk intelligence)
  ↓
snapshots (append-only, bounded history)
  ↓
explainability (why / evidence / next actions)
  ↓
MCP runtime interface (read-only by default)
```

## Runtime Layers

```
Repo root
├─ init            (scaffolding you review + commit)
├─ scan            (.aidw indexes: files, symbols, summaries)
├─ task runtime    (task registry + task files)
├─ workset runtime (bounded selection + manifests + caps)
├─ contract        (stable payload for tools/integrations)
├─ intelligence    (risks, lessons, decision explain)
└─ observability   (snapshots, diff, retention warnings)
```

## Snapshot Lifecycle

```
contract (bounded)
  ↓
write snapshot (append-only)
  ↓
list / read / explain / diff
  ↓
human review + debugging + audit
```

Snapshot rules:

- No source code storage
- Prompt is truncated
- Workset text is truncated
- Deterministic ordering

## MCP Interaction Flow

```
AI tool (MCP client)
  ↕
repo-context-kit-mcp (stdio)
  ↕
repo-context-kit CLI modules (read-only by default)
  ↕
bounded outputs (contracts / risks / snapshots / explanations)
```

MCP safety model:

- Default: read-only tools only
- `--enable-write`: exposes write-limited tools (task/pause/snapshot writes), still no source edits
- `--enable-tests`: allows allowlisted test execution, still token-gated

## Bounded Execution Model

repo-context-kit is designed for:

- Deterministic workflows
- Human confirmation points
- Inspectable outputs (contracts, risks, snapshots)

repo-context-kit is not designed for:

- Autonomous code editing
- Arbitrary shell execution
- Background agent daemons
- Self-healing repositories

