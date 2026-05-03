# T-001 Harden Doc-to-tasks Execution Boundaries

## Goal

Upgrade doc-to-tasks execution guidance from soft constraints to hard boundaries: scope-only edits, protected areas (default deny), new branch, per-task commit/push, and final PR after all tasks pass.

## Background

The current doc-to-tasks guidance is helpful but permissive. Tightening boundaries makes automated task loops safer and more predictable, especially around protected areas like secrets/env, deployment, and release workflows.

## Scope

Allowed to change:

- `.trae/skills/doc-to-tasks/SKILL.md`
- `template/.trae/skills/doc-to-tasks/SKILL.md`
- `.github/copilot-instructions.md`
- `template/.github/copilot-instructions.md`
- `.aidw/safety.md`
- `template/.aidw/safety.md`

Do not change:

- `.github/workflows/**` (unless this task is explicitly expanded to allow it)
- any secrets/env files (for example `.env*`, credential files, tokens)

## Requirements

- Add hard boundaries to doc-to-tasks guidance:
  - scope-only edits
  - protected areas (default deny)
  - branch-first workflow
  - per-task commit + push
  - final PR after all tasks complete and tests pass
- Keep wording consistent between Trae skill and Copilot instructions.

## Risk

- Over-restricting could block legitimate workflow changes; allow only via explicit task Scope expansion.

## Test Strategy

- Run `npm test`.

## Acceptance Criteria

- Trae doc-to-tasks skill documents hard boundaries (scope-only, protected areas, branch/commit/push, final PR).
- Copilot instructions document the same hard boundaries.
- `npm test` passes.

## Test Command

```bash
npm test

## Definition of Done

- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.
