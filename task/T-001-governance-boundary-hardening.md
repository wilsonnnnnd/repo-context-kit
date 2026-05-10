# T-001 Governance Boundary Hardening

## Goal

Close bounded governance escape hatches in task file resolution, design doc loading, and controlled test execution.

## Background

The runtime is designed to be bounded and review-first. Phase 2A addresses edge cases where path traversal or symlink escape could enable silent reads outside repoRoot, and reduces the command execution surface area.

## Scope

Allowed to change:

- `src/scan/task-registry.js`
- `src/gate/run-test.js`
- `src/docs/doc-loader.js`
- `test/cli.test.js`

Do not change:

- No automatic install
- No automatic git operations
- No arbitrary shell execution
- No writes outside managed workflow paths

## Requirements

- Reject task registry file paths that escape `task/` or repoRoot.
- Reject design doc loading that escapes repoRoot via symlinks.
- Remove `shell:true` from controlled test execution.
- Add regression tests for all boundary cases.

## Acceptance Criteria

- Task registry path traversal is rejected with a friendly error.
- Doc-loader rejects symlink escapes and does not crash on broken links.
- gate/run-test executes only allowed commands with `shell:false`.
- `npm test` passes.

## Test Command

```bash
npm test
```

## Definition of Done

- Boundary fixes implemented.
- Tests added/updated.
- Test command passes.

