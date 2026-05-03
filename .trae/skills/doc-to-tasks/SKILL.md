---
name: "doc-to-tasks"
description: "Turns a comprehensive application document into repo-context-kit task files and guides sequential execution. Invoke when the user asks to split a doc into tasks and complete them one by one."
---

# Doc to Tasks

## Default Inputs

Read, in this order:

1. `AGENTS.md`
2. `.aidw/project.md`
3. `.aidw/rules.md`
4. `.aidw/task-entry.md`
5. `.aidw/confirmation-protocol.md`
6. `.aidw/system-overview.md`

If the user provides additional docs (PRD/spec/ADR), treat them as additional sources, but keep `.aidw/*` as the repository source of truth.

## Output Contract

Produce a task breakdown that is actionable and reviewable:

- Each subtask becomes one task file under `task/T-*.md`.
- The task registry `task/task.md` must be updated (prefer CLI generation).
- Tasks must be dependency-ordered and small enough to implement and verify.
- Every task must include: Goal, Scope, Requirements, Acceptance Criteria, and a Test Command (or an explicit reason for `no_tests_available`).

## Procedure

1. Summarize the application at a high level (1 paragraph) using `.aidw/system-overview.md` + `.aidw/project.md`.
2. Produce a task breakdown list with:
   - Title
   - Goal (one sentence)
   - Dependencies (task IDs when known)
   - Test strategy (how it will be verified)
3. Create tasks as files:
   - Prefer: `npx repo-context-kit task new "<title>"`
   - Then edit the generated `task/T-*.md` file to fill in the required sections.
4. Execute sequentially:
   - Use `repo-context-kit context next-task` to pick the next task.
   - Use `repo-context-kit context workset <taskId>` to get bounded implementation context.
   - Follow `.aidw/confirmation-protocol.md` before editing files or running commands.
5. Testing:
   - Prefer gate flow: `gate confirm task <taskId>` → `gate confirm tests <taskId>` → `gate run-test <taskId> --token <token>`.
   - If tests are skipped, record the reason category and remaining risks.

## Pre-Authorization Mode (optional)

If the user explicitly grants blanket authorization (edit files + run tests + commit per task), you may proceed without asking for confirmations at each step.

Still:

- keep each change bounded to the current task
- run the task's test command after implementation
- stop and ask only when tests fail or when a decision is required

### Commit Per Task

If a git workspace is available and tests pass, create a commit for the current task before moving to the next task.

- commit message format: `<taskId>: <taskTitle>`
- include only files relevant to the task

## Guardrails

- Reuse existing modules before creating new ones.
- Keep changes minimal and backward compatible unless the task explicitly allows breaking changes.
- Do not hand-edit generated context files under `.aidw/` (except where rules explicitly allow).
