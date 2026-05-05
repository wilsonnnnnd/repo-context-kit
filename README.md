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

Run these from the root of the repo you want to work on.

- `init` writes workflow scaffolding files (you should review the diff and commit them).
- `scan` generates/refreshes `.aidw/*` so AI tools have an accurate project map.
- `task generate` / `task run` print scaffolds (they do not auto-edit your codebase).

## Primary Workflow

### 0) One-time setup (per repo)

1. Initialize scaffolding:
   - `npx repo-context-kit init`
2. Review what changed and commit it (typical Git flow):
   - `git status`
   - `git diff`
   - `git add AGENTS.md skill.md .aidw .github .trae task`
   - `git commit -m "Add AI project context"`
3. Generate/refresh project context:
   - `npx repo-context-kit scan`
4. Skim the generated “source of truth” docs:
   - `AGENTS.md`
   - `.aidw/project.md`
   - `.aidw/system-overview.md`

### 1) Turn docs into tasks (or write tasks manually)

- If you already know the work items, create tasks directly:
  - `npx repo-context-kit task new "Describe the change"`
- If you have a PRD/spec/ADR and want an AI to break it down, use the scaffold as a guide:
  - `npx repo-context-kit task generate`
  - Create one `task/T-*.md` per task and keep `task/task.md` (the registry) in sync

### 2) Execute tasks sequentially (the day-to-day loop)

1. Pick the next task:
   - `npx repo-context-kit context next-task`
2. Get bounded context for that task:
   - `npx repo-context-kit context workset T-001` (or add `--deep` if needed)
3. Generate an AI-friendly prompt/checklist:
   - `npx repo-context-kit task prompt T-001 --compact`
4. Implement scoped changes, then run tests:
   - run your normal test command, or
   - use the confirmation gate (`gate confirm ...` / `gate run-test ...`) when you want a safer, allowlisted path
5. Commit + push as you complete tasks.

### 3) Finish the batch

- After all tasks are done and tests are green, open one final PR.
- If you add/edit tasks or change repo structure, re-run `npx repo-context-kit scan` so context stays accurate.

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

- Scan preview and enforcement:
  - `repo-context-kit scan --plan` (preview planned writes; no files are written)
  - `repo-context-kit learn ingest [--dry-run]` (derive lessons from recent failures into lessons.pending.json)
  - `repo-context-kit learn approve` (apply pending lessons into lessons.json)
  - `repo-context-kit check [--explain] [--strict | --warn-only]` (enforce lessons)
- Context utilities:
  - `repo-context-kit context brief`
  - `repo-context-kit context next-task`
  - `repo-context-kit context workset <taskId> [--deep]`
- Task utilities:
  - `repo-context-kit task new "Title"`
  - `repo-context-kit task prompt|checklist|pr <taskId>`
  - `repo-context-kit task pr <taskId> --create` (creates a GitHub PR; requires `GITHUB_TOKEN`)
  - `repo-context-kit github auth set (--token <token> | --stdin)` (stores token in user config, not the repo)
- Semi-auto executor (safe orchestration only):
  - `repo-context-kit execute status|next|run|confirm|sync|reset`
- Internal controls:
  - `repo-context-kit gate status|confirm|run-test`
  - `repo-context-kit loop report|run`
  - `repo-context-kit budget show`
  - `repo-context-kit decision explain`

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
