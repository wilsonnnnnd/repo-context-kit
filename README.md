# repo-context-kit

[![npm version](https://img.shields.io/npm/v/repo-context-kit)](https://www.npmjs.com/package/repo-context-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/wilsonnnnnd/repo-context-kit?style=social)](https://github.com/wilsonnnnnd/repo-context-kit)

Turn project docs into structured tasks and safe execution scaffolds (you stay in control of edits, tests, commits, and PRs).

`repo-context-kit` prepares an existing repository for AI-assisted development by turning project documentation into structured tasks that an AI tool (or human) can execute safely.

## Quick Start (4 commands)

```bash
npx repo-context-kit init
npx repo-context-kit scan
npx repo-context-kit task generate
npx repo-context-kit task run
```

## Primary Workflow

1. Read project docs (`AGENTS.md`, `.aidw/project.md`, `.aidw/system-overview.md`)
2. Generate tasks and scaffolds (docs → `task/T-*.md` + `task/task.md`)
3. Execute tasks sequentially (manually or with your AI tool)
4. For each task, you:
   - implement scoped changes
   - run tests (recommended: via the confirmation gate)
   - commit + push
5. After all tasks:
   - open one final PR

## What You Get

- A shared project context for AI tools: `AGENTS.md`, `.aidw/project.md`, `.aidw/system-overview.md`
- A structured task system: `task/T-*.md` + registry `task/task.md`
- A simple execution mental model: docs → tasks → sequential execution → commits → one PR

## Internal Engine

These mechanisms power the workflow but are not user workflows:

- Context: prepares task-specific context for an AI tool
- Gate: controls whether execution is allowed
- Loop: handles failure and retry decisions
- Budget: controls context size
- Safety: protects sensitive areas (secrets/env, deployment, workflows, etc.)

## Advanced Commands

Commands that exist for power users and internal control, but are not part of the primary workflow:

- Context utilities:
  - `repo-context-kit context brief`
  - `repo-context-kit context next-task`
  - `repo-context-kit context workset <taskId> [--deep]`
- Task utilities:
  - `repo-context-kit task new "Title"`
  - `repo-context-kit task prompt|checklist|pr <taskId>`
- Semi-auto executor (safe orchestration only):
  - `repo-context-kit execute status|next|run|confirm|sync|reset`
- Internal controls:
  - `repo-context-kit gate status|confirm|run-test`
  - `repo-context-kit loop report|run`
  - `repo-context-kit budget show`

For a scenario-based runbook (commands, workflows, and troubleshooting), see [OPERATIONS.md](./OPERATIONS.md).

## Semi-Auto Executor Flow

The `execute` command provides a small, resumable orchestration state machine:

Task → Context → Pause → Confirm → Continue

It does not modify code, run tests, commit, or open PRs. It only reads tasks, generates bounded context summaries, and writes executor/loop state under `.aidw/`.

Example flow:

```bash
repo-context-kit execute next
repo-context-kit execute confirm <pauseId>
repo-context-kit execute confirm <pauseId>
repo-context-kit execute confirm <pauseId>

repo-context-kit gate confirm task <taskId> --json
repo-context-kit gate confirm tests <taskId>
repo-context-kit gate run-test <taskId> --token <token>

repo-context-kit execute sync
```

## License

MIT. See [LICENSE](./LICENSE).
