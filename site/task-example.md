# Task Example

Use this as a reference when creating a real implementation task. Replace the sample text with details from the project you are working in.

## Goal

Expose a read-only task template example in the local UI so users and AI assistants can understand how to write implementation-ready tasks.

## Background

The project already supports `repo-context-kit task new "Title"` and stores task details under `task/`. Users need a visible example that shows the expected level of detail without editing files directly from the UI.

## Scope

Allowed to change:

- `site/index.html`
- `bin/ui.js`
- `README.md`
- `test/cli.test.js`

Do not change:

- Task registry behavior
- Generated `.aidw/context/tasks.json`
- Arbitrary shell command execution rules
- File write or delete behavior from the UI

## Requirements

- Add a visible task example entry to the Tasks page.
- Show the example as read-only markdown.
- Keep task creation through the existing whitelisted CLI action.
- Prevent the example from appearing as a real task file.
- Keep file API access restricted to approved paths only.

## Acceptance Criteria

- The Tasks page includes a task example entry.
- Opening the example shows Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, and Definition of Done sections.
- The real task list contains only files from `task/*.md`.
- The file API rejects path traversal and unlisted files.
- Existing task creation behavior still works.

## Test Command

```bash
npm test
```

## Definition of Done

- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.
