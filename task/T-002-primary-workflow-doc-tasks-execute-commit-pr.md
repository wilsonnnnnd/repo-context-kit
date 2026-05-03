# T-002 Primary Workflow: Doc → Tasks → Execute → Commit → PR

## Goal

Make the product surface converge on one primary workflow: Doc → Tasks → Execute → Commit → PR, while repositioning other capabilities as Internal Engine or Advanced.

## Background

The current README highlights multiple concepts and flows. This change simplifies the user mental model to a single primary workflow without breaking existing CLI commands.

## Scope

Allowed to change:

- `README.md`
- `bin/cli.js` (help text only)
- `bin/task.js` (light CLI stubs only)
- `test/cli.test.js`
- `task/task.md`
- `task/T-002-primary-workflow-doc-tasks-execute-commit-pr.md`

Do not change:

- Existing command behavior (no removals, no breaking changes)
- `.github/workflows/**`

## Requirements

- README:
  - Use the one-line positioning sentence as the first user-facing line.
  - Show only the primary workflow at the top.
  - Provide the 4-command quick start: init, scan, task generate, task run.
  - Add `## Internal Engine` and `## Advanced Commands` sections.
- CLI:
  - Add `repo-context-kit task generate` and `repo-context-kit task run` as guidance-only scaffolding (no auto-edit claims).

## Risk

- README/test coupling: update tests that assert README structure.

## Test Strategy

- Run `npm test`.

## Acceptance Criteria

- README starts with the positioning sentence and highlights only the primary workflow at the top.
- README contains `## Internal Engine` and `## Advanced Commands`.
- `repo-context-kit task generate` exists and prints scaffold output.
- `repo-context-kit task run` exists and prints scaffold output.
- `npm test` passes.

## Test Command

```bash
npm test
```

## Definition of Done

- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.
