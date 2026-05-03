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

### Hard Boundaries (always on)

- Scope-only: only edit files explicitly allowed by the current task Scope. If Scope is unclear, stop and ask to clarify before editing.
- Protected areas (default deny): do not modify secrets/env, deployment config, or release workflows unless the current task Scope explicitly allows it.
  - Secrets/env: `.env*`, tokens, keys, credential files, CI/CD secret config
  - Deployment: `deploy/`, `infra/`, `k8s/`, `helm/`, `terraform/`, `docker-compose*`, Dockerfiles
  - Release workflows: `.github/workflows/**`
- Branch workflow: create a new branch before starting implementation. Do not work directly on `main`.
- Per-task: after tests pass, commit only task-related files and push the branch.
- Final: after all tasks complete and all tests pass, create a pull request into `main`.

### Pre-Authorization Mode (optional)

If the user explicitly grants blanket authorization (edit files + run tests + commit per task), proceed without asking for confirmations at each step. Stop and ask only when tests fail or when a decision is required.

If tests pass and git is available, create one commit per task before moving to the next task.
