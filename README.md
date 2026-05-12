# repo-context-kit

Compact deterministic repository runtime for AI coding agents.

repo-context-kit is MCP-native first: MCP transport + runtime/v1 JSON state + minimal CLI fallback.

Primary interfaces:

1. MCP (`repo-context-kit-mcp`)
2. runtime/v1 JSON (`.aidw/runtime/*.json`)
3. minimal CLI (`init`, `scan`, `context`, `task`, `gate`, `check`, `metrics`)

It provides bounded repository context, runtime task state, verification framing, and confirmation-gated execution for AI coding agents.

## MCP

```bash
repo-context-kit-mcp --root <repo>
```

The MCP server is read-only by default. Write, test, and external-side-effect tiers require explicit opt-in and still honor the confirmation gate.

## Runtime

JSON is the source of truth:

- `.aidw/runtime/task.json`
- `.aidw/runtime/context.json`
- `.aidw/runtime/execution.json`
- `.aidw/runtime/verification.json`

Markdown is a readable view only.

## Usage

```bash
repo-context-kit init
repo-context-kit scan [--check]
repo-context-kit context brief
repo-context-kit context next-task
repo-context-kit context workset <taskId>
repo-context-kit task prompt <taskId>
repo-context-kit task checklist <taskId>
repo-context-kit task pr <taskId>
repo-context-kit gate status
repo-context-kit gate confirm task <taskId>
repo-context-kit gate confirm tests <taskId>
repo-context-kit gate run-test <taskId> --token <token>
repo-context-kit check
repo-context-kit metrics
```
