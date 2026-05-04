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

### Optional: Semi-Auto Executor (resumable orchestration)

Use when: you want a minimal CLI state machine that tracks pauses and confirmations across steps.

```bash
npx repo-context-kit execute next
npx repo-context-kit execute status
npx repo-context-kit execute confirm <pauseId>
```

When the executor reaches `testing`, run tests via the gate and then sync:

```bash
npx repo-context-kit gate confirm task <taskId> --json
npx repo-context-kit gate confirm tests <taskId>
npx repo-context-kit gate run-test <taskId> --token <token>
npx repo-context-kit execute sync
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

Notes:

- The gate only allows a small test-command allowlist (for safety). Use one of:
  - `npm test`
  - `pnpm test`
  - `yarn test`
  - `pytest`

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

Optional: create a GitHub PR (no git commit/push is performed):

```bash
export GITHUB_TOKEN=...
npx repo-context-kit task pr T-001 --create
```

Optional: store the token in user config (not the repo), then create PR without exporting env vars:

```bash
echo "YOUR_TOKEN" | npx repo-context-kit github auth set --stdin
npx repo-context-kit task pr T-001 --create
```

Notes:

- `--create` calls the GitHub REST API and requires a valid token via `GITHUB_TOKEN` (or `GH_TOKEN`).
- `github auth set` stores the token in a user-level config file outside the repository.
- The repo is derived from `.git/config` (remote `origin`) and the head branch from `.git/HEAD`. If unavailable, pass `--repo owner/name` and/or `--head branch`.

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

## Post-PR Cleanup Rule (task artifacts)

Use when: a PR has been merged and the `task/` artifacts were only used for internal planning.

- Goal: keep `task/` clean so it does not accumulate stale `T-*.md` files over time.
- Timing: apply this only after merge (post-PR), never during active development.

Checklist:

- Confirm the PR is merged into the target branch.
- Create an archive record (one file per workflow run) so the task work is reproducible later:

```bash
mkdir -p archive
${EDITOR:-notepad} archive/Task_at_date.md
```

Suggested minimum fields:

- Date
- Task IDs (or "none" if using the workflow without registry)
- PR link
- Test command(s) + results
- Notes / follow-ups
- Cleanup task artifacts. You have two options:
  - Manual cleanup (post-merge): remove completed `task/T-*.md` files and remove their rows from `task/task.md`.
  - Deterministic per-task cleanup: run the built-in command (requires the task status is `done` or `completed`):

```bash
npx repo-context-kit task cleanup T-001
```

Notes:

- `task cleanup` archives into `task/archive/task-history.md`, deletes one `task/T-###-*.md`, removes one registry row, and regenerates `.aidw/context/tasks.json`.
- `task pr <taskId> --cleanup` generates the PR description first, then attempts cleanup. If the task is not completed, cleanup aborts.
- If you want `.aidw/system-overview.md` and `.aidw/index/*` refreshed too, run a full scan:

- Refresh generated context so `.aidw/context/tasks.json` and `.aidw/system-overview.md` are consistent:

```bash
npx repo-context-kit scan --auto
```

## Release (Changesets)

Use when: you want a traceable npm release with a clear changelog.

Recommended flow:

1) In your feature PR:

- Add a changeset describing the user-facing change.

2) After the PR is merged into `main`:

```bash
npx changeset version
npm test
git add -A
git commit -m "chore(release): vX.Y.Z"
git push
npx changeset publish
```

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
