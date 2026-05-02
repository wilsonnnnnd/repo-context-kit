# repo-context-kit

[![npm version](https://img.shields.io/npm/v/repo-context-kit)](https://www.npmjs.com/package/repo-context-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/wilsonnnnnd/repo-context-kit?style=social)](https://github.com/wilsonnnnnd/repo-context-kit)

`repo-context-kit` prepares an existing repository for AI-assisted development.

It provides a single, shared project context (rules + structure + tasks) so tools like Codex, Trae, GitHub Copilot, and Claude can work consistently without re-explaining the repo in every chat.

## What It Does

- Unified entry: `AGENTS.md` (the workflow controller for AI tools)
- Scan + indexes: generates `.aidw/project.md`, `.aidw/system-overview.md`, and bounded indexes under `.aidw/index/`
- Task workflow: creates markdown tasks under `task/` and keeps a registry in `task/task.md`
- Local UI: runs only whitelisted repo-context-kit actions and reads managed files (read-only)

## Quick Start

Run in an existing repo:

```bash
npx repo-context-kit init
npx repo-context-kit scan
```

Then commit the generated workflow files:

```bash
git add AGENTS.md skill.md .aidw .github .trae
git commit -m "Add AI project context"
```

## Recommended Task-Driven Workflow

Use progressive context commands as the default workflow when handing a task to an AI coding tool:

```bash
npx repo-context-kit context brief
npx repo-context-kit context next-task
npx repo-context-kit context workset T-001
npx repo-context-kit task prompt T-001
npx repo-context-kit task checklist T-001
npx repo-context-kit task pr T-001
```

Use `--deep` only when the default workset is not enough:

```bash
npx repo-context-kit context workset T-001 --deep
npx repo-context-kit task prompt T-001 --deep
npx repo-context-kit task checklist T-001 --deep
npx repo-context-kit task pr T-001 --deep
```

These commands are bounded. They reuse the same progressive workset logic, avoid dumping full generated indexes, and do not execute tasks, tests, git commands, GitHub actions, or AI agents.

## Core Commands

- `npx repo-context-kit init` - install workflow + template files into the current repo (use `--force` to refresh known managed files)
- `npx repo-context-kit scan` - refresh generated project context and indexes
- `npx repo-context-kit scan --check` - CI-friendly staleness check (no writes)
- `npx repo-context-kit task new "Title"` - create a new numbered task file and append to `task/task.md`
- `npx repo-context-kit context brief|next-task|workset` - bounded, token-efficient context outputs (workset defaults to digest; use `--full` to disable digest)
- `npx repo-context-kit task prompt|checklist|pr` - bounded, task-aware outputs built on the same workset
- `npx repo-context-kit ui` - local web console (localhost-only; whitelisted actions; read-only files)

## Unified AI Tool Entry

Use `AGENTS.md` as the single source of truth. Tool-specific files should be adapters only.

Most tools should be told to read:

- `AGENTS.md`
- `.aidw/project.md`
- `.aidw/rules.md`
- `.aidw/task-entry.md`
- `.aidw/confirmation-protocol.md`

## Notes

- Do not hand-edit generated `.aidw/index/*` files.
- Re-run `scan` after structural changes so context stays accurate.

## License

MIT. See [LICENSE](./LICENSE).
