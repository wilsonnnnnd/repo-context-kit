# repo-context-kit

[![npm version](https://img.shields.io/npm/v/repo-context-kit)](https://www.npmjs.com/package/repo-context-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

A safe AI development runtime that maps your repo, prepares focused AI context, and keeps work reviewable.

## Start

Run these from the repository you want to work on:

```bash
npx repo-context-kit init
npx repo-context-kit scan
npx repo-context-kit bootstrap doctor
npx repo-context-kit task new "Describe the work"
npx repo-context-kit task prompt T-001
npx repo-context-kit task checklist T-001
npx repo-context-kit task pr T-001
npx repo-context-kit scan --check
npx repo-context-kit bootstrap doctor --check
npx repo-context-kit status
```

## The Workflow

init -> scan -> bootstrap doctor -> task prompt -> implement (human-controlled) -> task checklist -> task pr -> scan --check -> bootstrap doctor --check

| Step | Command |
|---|---|
| Initialize workflow files | `repo-context-kit init` |
| Build/refresh repo map | `repo-context-kit scan` |
| Preflight risk gate | `repo-context-kit bootstrap doctor` |
| Prepare AI prompt | `repo-context-kit task prompt T-001` |
| Human-controlled implementation | Manual edits + review |
| Verification checklist | `repo-context-kit task checklist T-001` |
| Prepare review/PR text | `repo-context-kit task pr T-001` |
| CI/local check: scan freshness | `repo-context-kit scan --check` |
| CI/local check: preflight risks | `repo-context-kit bootstrap doctor --check` |

That is the recommended path. Advanced controls stay available, but you do not need to learn them first.

## Preflight Bundle (CI / Local)

The recommended, read-only preflight bundle is:

```bash
repo-context-kit scan --check
repo-context-kit bootstrap doctor --check
```

What they check:

- `scan --check`: validates required generated context artifacts are present and up to date (CI-style freshness gate).
- `bootstrap doctor --check`: validates preflight risk policy (dependency compatibility + project shape signals) and exits based on severity/policy flags.

Doctor is a preflight gate, not an auto-fixer. It does not install, does not write, and does not silently apply changes.

## Task Workflow and Confirmations

The task workflow keeps work reviewable (`task prompt`, `task checklist`, `task pr`). Controlled actions (like running tests through the gate) require explicit human confirmation via the confirmation protocol.

## Friendly Aliases

These commands are the default names shown in help. They keep older commands working while making the common path easier to remember:

| Command | Forwards to |
|---|---|
| `repo-context-kit context next` | `repo-context-kit context next-task` |
| `repo-context-kit context for <taskId>` | `repo-context-kit context workset <taskId>` |
| `repo-context-kit task from-doc <path>` | `repo-context-kit task generate --from-doc <path>` |
| `repo-context-kit task plan --goal "..."` | `repo-context-kit auto --goal "..."` |
| `repo-context-kit status` | A lightweight project status summary |

## What It Does

repo-context-kit gives AI coding tools a bounded way to work in an existing repo:

- It builds a current project map before planning.
- It turns work into explicit task files.
- It prepares focused context instead of dumping the whole repo.
- It keeps safety boundaries and verification steps visible.
- It records enough runtime state for review and debugging.

It does not auto-edit source code, run arbitrary commands, commit, push, or open PRs without explicit user action.

## Common Workflows

Create a task manually:

```bash
repo-context-kit task new "Add password reset"
repo-context-kit task prompt T-001
```

Work from a design doc:

```bash
repo-context-kit task from-doc docs/password-reset.md
repo-context-kit context next
repo-context-kit task prompt T-001
```

Preview the repository map before refreshing it:

```bash
repo-context-kit scan --plan
repo-context-kit scan
```

Prepare review output:

```bash
repo-context-kit task checklist T-001
repo-context-kit task pr T-001
```

## Safety Defaults

The default workflow is intentionally conservative:

- No autonomous source edits.
- No arbitrary shell execution.
- No hidden test runs.
- No generated index files edited by hand.
- No advanced runtime writes without explicit confirmation.

The normal user surface is small: `init`, `scan`, `task`, and `context`.

## Runtime Controls

The runtime has a control plane for confirmations, execution state, context budgeting, learned checks, and decision explanations. These commands are useful when debugging or integrating with tools, but they are not required for day-one usage.

```bash
repo-context-kit gate status
repo-context-kit execute status
repo-context-kit loop report
repo-context-kit budget show
repo-context-kit decision explain
repo-context-kit learn ingest --dry-run
repo-context-kit check --explain
```

Use `repo-context-kit --help --advanced` to see the full command surface.

## Infrastructure

These flows are for repository setup, maintenance, audit, and integrations:

```bash
repo-context-kit bootstrap plan --from-doc docs/new-project.md
repo-context-kit hygiene scan
repo-context-kit runtime snapshot list
repo-context-kit github auth status
repo-context-kit ui
```

Reference docs:
- [docs/doctor.md](./docs/doctor.md)
- [docs/runtime-governance.md](./docs/runtime-governance.md)

## MCP Integration

repo-context-kit also ships an MCP stdio server for AI tools:

```bash
repo-context-kit-mcp --root /path/to/repo
```

It is read-only by default. Write and test tools require explicit opt-in flags and still use runtime gates:

```bash
repo-context-kit-mcp --root /path/to/repo --enable-write
repo-context-kit-mcp --root /path/to/repo --enable-write --enable-tests
```

## Reference

For operational details, troubleshooting, and the full runtime model, see:

- [OPERATIONS.md](./OPERATIONS.md)
- [docs/runtime-architecture.md](./docs/runtime-architecture.md)
- [docs/runtime-governance.md](./docs/runtime-governance.md)

## License

MIT. See [LICENSE](./LICENSE).
