# repo-context-kit Operations Guide

This document is a scenario-based runbook for using `repo-context-kit` in real workflows.

## Core Principles

- Prefer bounded context outputs over full-repo dumps.
- Keep scope tight and changes reviewable.
- Use the confirmation gate for running tests when available.
- Re-run `scan` after task or structure changes so context stays accurate.

## One-Time Setup (per repo)

```bash
npx repo-context-kit init
npx repo-context-kit scan
```

Then commit the workflow files:

```bash
git add AGENTS.md skill.md .aidw .github .trae task
git commit -m "Add AI project context"
```

## Daily Workflow (task loop)

### 1) Pick the next task

```bash
npx repo-context-kit context next-task
```

### 2) Get bounded implementation context

```bash
npx repo-context-kit context workset T-001
```

If you need more context (still bounded):

```bash
npx repo-context-kit context workset T-001 --deep
```

### 3) Generate an AI prompt (token-efficient default)

```bash
npx repo-context-kit task prompt T-001 --compact
```

### 4) Run tests safely (recommended)

```bash
npx repo-context-kit gate confirm task T-001 --json
npx repo-context-kit gate confirm tests T-001
npx repo-context-kit gate run-test T-001 --token <token>
```

### 5) Check loop constraints

```bash
npx repo-context-kit loop report --task T-001
```

## Commands by Scenario

### Initialize / Refresh Context

Use when: first time setup, after large refactors, after tasks change, or when AI context seems stale.

- Init workflow files:

```bash
npx repo-context-kit init
```

- Refresh generated context and indexes:

```bash
npx repo-context-kit scan
```

- CI-friendly check (no writes):

```bash
npx repo-context-kit scan --check
```

### Context (minimal-first)

Use when: you want bounded, token-efficient context for an AI tool.

- Project-level brief context:

```bash
npx repo-context-kit context brief
```

- Select next task (status/dep aware):

```bash
npx repo-context-kit context next-task
```

- Bounded task workset:

```bash
npx repo-context-kit context workset T-001
```

### Task Utilities

Use when: creating and working with task files.

- Create a new task file and append to the registry:

```bash
npx repo-context-kit task new "Describe the change"
```

- Create a prompt/checklist/PR text for a task:

```bash
npx repo-context-kit task prompt T-001 --compact
npx repo-context-kit task checklist T-001
npx repo-context-kit task pr T-001
```

### Budget Mode (control context size)

Use when: you want automatic context expansion only when it changes decisions.

- Show effective mode:

```bash
npx repo-context-kit budget show
```

- Enable automatic policy per command:

```bash
npx repo-context-kit context workset T-001 --budget auto
```

### Local UI

Use when: you want a local, read-only console for managed files and whitelisted actions.

```bash
npx repo-context-kit ui
```

## Doc-to-Tasks Workflow (AI-driven task breakdown)

Use when: you have a comprehensive application document and want the AI to break it into multiple `task/T-*.md` files and then execute them sequentially.

- Default sources: `.aidw/system-overview.md` + `.aidw/project.md`
- Output: multiple `task/T-*.md` files + updated `task/task.md`
- Execution: one task at a time via `context next-task` and `context workset <taskId>`

### Hard Boundaries (recommended)

- Scope-only edits: only edit files explicitly allowed by the current task Scope.
- Protected areas (default deny): secrets/env, deployment config, and release workflows unless task Scope explicitly allows.
- Branch workflow: do not work directly on `main`.
- Per-task: test → commit only task files → push.
- Final: after all tasks are complete and all tests pass, create one PR into `main`.

## Confirmation Protocol (manual input friendly)

Some hosts render buttons for confirmation; others require manual input.

When manual input is needed, use explicit, unambiguous phrases such as:

- `Confirm task (proceed)`
- `Adjust task (go to clarify)`
- `Cancel`

For test execution prompts:

- `Run tests`
- `Skip tests (reason: no_tests_available)`
- `Skip tests (reason: too_expensive_now)`

## Troubleshooting

### `scan --check` fails (context outdated)

Run:

```bash
npx repo-context-kit scan
```

Then re-check:

```bash
npx repo-context-kit scan --check
```

### Task registry mismatch or missing tasks

- Ensure `task/task.md` exists.
- Ensure task files under `task/` match the registry rows.
- If tasks were edited/added, re-run `scan` so `.aidw/context/tasks.json` is up to date.
