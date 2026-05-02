# Repo Context Kit Confirmation Gate (VSCode Extension)

This folder contains a minimal VSCode extension that provides click-driven commands for the repo-context-kit confirmation gate workflow.

Commands:

- Repo Context Kit: Gate Status
- Repo Context Kit: Confirm Task
- Repo Context Kit: Confirm Tests
- Repo Context Kit: Reset Gate
- Repo Context Kit: Run Task Test Command

The extension shells out to:

```bash
npx repo-context-kit gate ...
```

It is designed to be used with the task-driven workflow:

- Draft task → confirm task (stores token) → confirm tests → run task test command
- Optional: inspect derived constraints/patterns with `repo-context-kit loop report`
