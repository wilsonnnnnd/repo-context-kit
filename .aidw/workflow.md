# AI Development Workflow

## Flow

1. Read `AGENTS.md`, then `.aidw/project.md`, `.aidw/rules.md`, and `.aidw/system-overview.md`.
2. Read the current task file (when one exists).
   - For low token use, prefer digest outputs and `task prompt --compact`; expand only when needed.
3. Identify likely affected files before editing.
4. Make the smallest safe change.
5. Run the task’s test command (prefer the confirmation gate when available).
   - Note: gate execution only allows a small test-command allowlist (npm/pnpm/yarn test, pytest).
6. Report what changed, files changed, tests run, and remaining risks.

## Context Budget Policy

- Default: start with digest + compact outputs.
- Upgrade only when it changes decisions (recent test failures, high risk areas, unknown/missing files, stale scan, or warnings).
- Full: only on explicit request (`--full-*` / `--manifest`) or for review-heavy work.

## Rules

- Keep scope tight; avoid unrelated changes and refactors.
- Do not rename public APIs unless the task requires it.
- Do not edit generated files manually.
- Do not add dependencies unless required by the task.
- Do not touch auth/db/migrations/config unless explicitly in scope.
