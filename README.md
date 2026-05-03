# repo-context-kit

[![npm version](https://img.shields.io/npm/v/repo-context-kit)](https://www.npmjs.com/package/repo-context-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/wilsonnnnnd/repo-context-kit?style=social)](https://github.com/wilsonnnnnd/repo-context-kit)

Turn project docs into executable tasks, run them sequentially, commit each step, and open one final PR.

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
2. Generate tasks (docs → `task/T-*.md` + `task/task.md`)
3. Execute tasks sequentially
4. For each task:
   - implement
   - run tests
   - commit + push
5. After all tasks:
   - create one final PR

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
- Internal controls:
  - `repo-context-kit gate status|confirm|run-test`
  - `repo-context-kit loop report|run`
  - `repo-context-kit budget show`

For a scenario-based runbook (commands, workflows, and troubleshooting), see [OPERATIONS.md](./OPERATIONS.md).

## License

MIT. See [LICENSE](./LICENSE).
