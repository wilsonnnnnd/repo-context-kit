# GitHub Copilot Repository Instructions

Use `AGENTS.md` as the source of truth. Before answering or editing code, read:

- `AGENTS.md`
- `.aidw/project.md`
- `.aidw/rules.md`
- `.aidw/task-entry.md`
- `.aidw/confirmation-protocol.md`

## Doc to Tasks (when given a comprehensive application document)

When the user provides a comprehensive application document and asks you to break it into small tasks and complete them sequentially:

- Default sources: `.aidw/system-overview.md` and `.aidw/project.md`
- Produce tasks as task files (`task/T-*.md`) and update the registry (`task/task.md`)
  - Prefer generating tasks via: `npx repo-context-kit task new "<title>"`
- Work one task at a time and follow `.aidw/confirmation-protocol.md` gating rules before editing files or running commands

### Pre-Authorization Mode (optional)

If the user explicitly grants blanket authorization (edit files + run tests + commit per task), proceed without asking for confirmations at each step. Stop and ask only when tests fail or when a decision is required.

If tests pass and git is available, create one commit per task before moving to the next task.
