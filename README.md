# repo-context-kit

[![npm version](https://img.shields.io/npm/v/repo-context-kit)](https://www.npmjs.com/package/repo-context-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/wilsonnnnnd/repo-context-kit?style=social)](https://github.com/wilsonnnnnd/repo-context-kit)

`repo-context-kit` prepares an existing repository for AI-assisted development.

It gives Codex, Trae, GitHub Copilot, Claude, and other coding assistants one shared project context instead of making you repeat the same architecture notes, rules, and task instructions in every chat.

## What It Does

`repo-context-kit` provides three main capabilities:

- Prompt workflow: creates a unified AI instruction entry point through `AGENTS.md`
- File map: scans the repository and generates project indexes under `.aidw/index/`
- Task workflow: creates implementation-ready task files and indexes task readiness
- Project memory: stores durable project context, rules, notes, and task guidance under `.aidw/`

The goal is simple: AI tools should understand the project before suggesting implementation.

## How it works

`repo-context-kit` connects project context, tasks, scan output, and the local UI into one AI workflow:

```text
init -> scan -> review .aidw/project.md -> create tasks -> use AI -> re-scan
```

`init` installs the shared AI workflow files. `scan` reads the repository and keeps `.aidw/` accurate for AI tools.

`.aidw/` is the project memory layer:

- `.aidw/project.md` stores the main AI-readable project context and manual notes
- `.aidw/index/*` stores generated file, symbol, entrypoint, and structure indexes
- `.aidw/context/tasks.json` stores generated task metadata
- `.aidw/system-overview.md` summarizes available AI context sources

Run `scan` after structural, task, or package metadata changes so AI context does not go stale. Use `scan --check` in CI to detect stale context without writing files.

Tasks are created with `repo-context-kit task new "Title"`. The task registry lives in `task/task.md`, detailed task files live under `task/`, and `scan` merges them into `.aidw/context/tasks.json`.

Generated `.aidw/` files should not be hand-edited. The local UI runs only whitelisted repo-context-kit commands and views managed files read-only.

## Quick Start

Run this inside an existing project:

```bash
npx repo-context-kit init
npx repo-context-kit scan
```

Then commit the generated files:

```bash
git add AGENTS.md skill.md .aidw .github .trae
git commit -m "Add AI project context"
```

After that, use the same instruction in any AI coding tool:

```text
Please follow this repository's AGENTS.md.

My request:
...
```

## Typical Workflow

1. Initialize the AI workflow files:

```bash
npx repo-context-kit init
```

2. Scan the project:

```bash
npx repo-context-kit scan
```

3. Review `.aidw/project.md`.

4. Add stable project-specific notes under `## Manual Notes`.

5. Ask your AI tool to follow `AGENTS.md`.

6. Re-run `scan` after important structure changes:

```bash
npx repo-context-kit scan
```

## Unified AI Tool Entry

`AGENTS.md` is the single source of truth for AI coding tools.

Tool-specific files are only adapters. They point back to `AGENTS.md` instead of duplicating rules.

| Tool | Entry File |
| --- | --- |
| Codex | `AGENTS.md` |
| Trae | `.trae/rules/project_rules.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| GitHub Copilot agent | `.github/agents/project-prompt.agent.md` |
| Claude-style skill workflows | `skill.md` |

All adapters tell the tool to read:

- `AGENTS.md`
- `.aidw/project.md`
- `.aidw/rules.md`
- `.aidw/task-entry.md`

This keeps the workflow consistent across tools.

## How To Use With Codex

After running `init` and `scan`, open the repository in Codex and say:

```text
Please follow this repository's AGENTS.md.
Read .aidw/project.md, .aidw/rules.md, and .aidw/task-entry.md first.

My request:
...
```

Codex should use `AGENTS.md` as the workflow controller.

For vague requests, it should ask clarification questions first. For clear requests, it should generate a structured implementation prompt or implement only when explicitly asked.

## How To Use With Trae

`init` creates:

```text
.trae/rules/project_rules.md
```

That file points Trae back to `AGENTS.md`.

In Trae, use:

```text
Please follow the project rules and AGENTS.md.

My request:
...
```

You only need to maintain `AGENTS.md` and `.aidw/`. The Trae rules file should stay short.

## How To Use With GitHub Copilot

`init` creates:

```text
.github/copilot-instructions.md
.github/agents/project-prompt.agent.md
```

Copilot reads `.github/copilot-instructions.md` as repository instructions.

Use Copilot Chat like this:

```text
Follow this repository's instructions and AGENTS.md.

My request:
...
```

For Copilot agent workflows, use the generated `project-prompt` agent as the project-aware prompt assistant.

## Prompt Workflow

The generated workflow is designed to keep AI output controlled and useful.

`AGENTS.md` tells AI tools to classify requests into three paths:

- Vague request: inspect likely areas, ask focused clarification questions, then stop
- Clear request: generate one structured implementation prompt
- Review request: review and refine an existing prompt, plan, or implementation

The default workflow avoids jumping straight into code unless the user explicitly asks for implementation.

Generated prompts should include:

- task goal
- files to inspect
- constraints
- implementation direction
- acceptance criteria
- what must not be changed

## File Map And Indexes

Run:

```bash
npx repo-context-kit scan
```

The scanner generates AI-readable project maps:

| File | Purpose |
| --- | --- |
| `.aidw/project.md` | Human-readable project summary and memory |
| `.aidw/system-overview.md` | Generated map of AI context sources, rules, tasks, indexes, and tool adapters |
| `.aidw/index/files.json` | Important files and descriptions |
| `.aidw/index/symbols.json` | Functions, classes, components, and exports |
| `.aidw/index/entrypoints.json` | CLI, app, and execution entry points |
| `.aidw/index/file-groups.json` | Directory-level grouping and key files |
| `.aidw/index/summary.json` | Scan metadata and index counts |
| `.aidw/context/tasks.json` | Common task types mapped to relevant files |
| `.aidw/AI.md` | Compact guide for AI tools using the indexes |

These files help assistants find the right files faster and avoid guessing project structure.

To prevent context explosion, use the progressive context commands as the default way to give AI tools repo context instead of pasting the raw index files:

```bash
npx repo-context-kit context brief
npx repo-context-kit context next-task
npx repo-context-kit context workset T-001
npx repo-context-kit task prompt T-001
npx repo-context-kit context workset T-001 --deep
```

`context brief` prints concise project context, package metadata, scan summary, and task registry status. `context next-task` reads the registry first and includes only the selected task detail file. `context workset` adds bounded, task-aware file and symbol candidates with reasons, confidence, and suggested read order. `task prompt` wraps one task and its bounded workset into an AI-ready implementation prompt for tools such as Codex or Cursor. These commands do not execute tasks or act as an AI agent.

## AI System Overview

`repo-context-kit scan` also generates:

```text
.aidw/system-overview.md
```

This file is a control-layer map of the AI development context in the repository. It shows available context files, repository rules, task files, generated indexes, and AI tool adapters such as `AGENTS.md`, GitHub Copilot instructions, and Trae rules.

It is not a prompt manager. It is a generated summary that helps AI tools understand which context sources exist and whether optional files are present or missing.

## AI Development Workflow

`init` creates workflow and safety files for AI coding tools:

- `.aidw/workflow.md` defines the standard AI coding flow.
- `.aidw/safety.md` defines protected areas and safety rules.

Create an implementation-ready task file with:

```bash
npx repo-context-kit task new "Add receipt evidence API"
```

This creates a numbered file under `task/` with scope, requirements, acceptance criteria, a test command, and definition of done. `scan` indexes task metadata into `.aidw/context/tasks.json`, including whether each task has acceptance criteria, a test command, and definition of done.

This system guides AI coding tools, but it does not execute tasks or generate code automatically.

## Task Registry

`task/task.md` is the central task index. It tracks each task's ID, title, status, priority, owner, dependencies, and detailed task file.

Detailed task files live under `task/*.md`. The registry keeps the task list cheap to read, while each task file keeps implementation details, scope, acceptance criteria, and test commands.

`repo-context-kit task new "Title"` creates the detailed task file and appends a row to `task/task.md`. `repo-context-kit scan` merges the registry and task files into `.aidw/context/tasks.json`, then warns if a registry row points at a missing file or a task file is not listed in the registry.

This reduces full task scanning overhead while keeping everything markdown-based and easy to review.

## Command Builder

This repository includes a local command builder for common `repo-context-kit` commands.

Open `site/index.html` directly in a browser for command preview and copy-only use. In direct-file mode it does not run commands, start a backend, require network access, or modify files.

For a local web console that can run whitelisted repo-context-kit commands and view managed files, start:

```bash
npx repo-context-kit ui
```

The UI server binds to localhost only and prints the local URL. It can run only the built-in `init`, `scan`, `scan --check`, `scan --auto`, and `task new` actions, and the file viewer is read-only. The Tasks page also includes a read-only task example so users and AI assistants can study the recommended task structure before creating a real task.

### Python and FastAPI awareness

The scanner also recognizes Python/FastAPI repositories from common project files such as `requirements.txt`, `pyproject.toml`, `setup.py`, `poetry.lock`, and `Pipfile`.

For a FastAPI backend like this:

```text
requirements.txt
app/main.py
app/routers/
app/services/
app/schemas/
tests/
```

`repo-context-kit scan` will identify Python/FastAPI tech signals, list `app/main.py` as an entrypoint, summarize reusable backend areas, and flag likely risk areas such as auth, database, settings, prompt, and external integration code.

## Project Memory

Project memory lives in `.aidw/`.

The most important files are:

- `.aidw/project.md`: generated project context plus manual notes
- `.aidw/system-overview.md`: generated map of context sources and AI tool adapters
- `.aidw/rules.md`: engineering rules and constraints
- `.aidw/task-entry.md`: reusable task request template
- `.aidw/index/*`: file map and symbol indexes
- `.aidw/context/tasks.json`: task-to-file mappings

Use `.aidw/project.md` for stable context that AI should remember.

Add custom notes under:

```md
## Manual Notes
```

The scanner preserves manual notes when it updates the generated section.

Good manual notes include:

- important architecture decisions
- feature boundaries
- naming conventions
- files or modules that are risky to change
- product-specific rules
- team preferences that should stay stable

## Commands

### `npx repo-context-kit init`

Copies the workflow template into the current repository.

It creates:

- `AGENTS.md`
- `skill.md`
- `.aidw/project.md`
- `.aidw/rules.md`
- `.aidw/workflow.md`
- `.aidw/safety.md`
- `.aidw/task-entry.md`
- `.aidw/meta.json`
- `.aidw/scan/last.json`
- `.aidw/tests/`
- `.claude/skills/`
- `.github/copilot-instructions.md`
- `.github/agents/project-prompt.agent.md`
- `.trae/rules/project_rules.md`

Existing files are left in place.

Use `--force` to recreate managed context files:

```bash
npx repo-context-kit init --force
```

`--force` only overwrites known managed context files. It does not delete unknown files inside `.aidw/`.

### `npx repo-context-kit scan`

Scans the current repository and updates `.aidw/project.md`, `.aidw/system-overview.md`, and the index files.

Use this after:

- first initialization
- adding major folders
- changing entry points
- adding new shared modules
- restructuring the project
- updating package metadata

### `npx repo-context-kit scan --check`

Checks whether generated project context is up to date without writing files.

This is useful in CI:

```bash
npx repo-context-kit scan --check
```

It exits with code `1` if the context is stale, incomplete, or cannot be checked.

### `npx repo-context-kit scan --auto`

Updates project context without extra guidance:

```bash
npx repo-context-kit scan --auto
```

This is useful for scripts and automation.

### `npx repo-context-kit task new [title]`

Creates a numbered markdown task file under `task/` and updates the central `task/task.md` registry.

```bash
npx repo-context-kit task new "Add receipt evidence API"
```

The task template includes goal, background, scope, requirements, acceptance criteria, test command, and definition of done.

### `npx repo-context-kit task prompt <taskId> [--deep]`

Prints a bounded implementation prompt for one task. It resolves the task from `task/task.md`, includes the selected task detail when available, and reuses `context workset` for related files, symbols, entry points, risk areas, and read order. `--deep` reuses the deep workset limits while still avoiding full index dumps.

### `npx repo-context-kit context brief`

Prints concise project-level context for AI tools without dumping full generated indexes.

### `npx repo-context-kit context next-task`

Selects the first `in_progress` task, or the first ready `todo` task whose dependencies are `done`, then prints only that task's relevant context.

### `npx repo-context-kit context workset <taskId> [--deep]`

Prints bounded implementation context for one task, including selected related files and symbols from existing indexes. `--deep` increases the limits while still avoiding full index dumps.

### `npx repo-context-kit ui`

Starts the local repo-context-kit web console:

```bash
npx repo-context-kit ui
```

The server binds to `127.0.0.1`, serves `site/`, opens the browser when possible, streams command output logs, and exposes read-only access to managed files plus the bundled task example. It does not provide arbitrary shell execution or file editing APIs.

## CI Example

Add a check to make sure project context stays current:

```yaml
name: Project context

on:
  pull_request:
  push:
    branches: [main]

jobs:
  context-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx repo-context-kit scan --check
```

## Supported Project Types

The scanner currently detects:

- `cli-tool`
- `web-app`
- `fullstack-app`
- `backend-app`
- `template-repo`
- `generic`

Detection is based on common repository structure and package metadata. The result is meant to provide useful AI context, not a complete architecture model.

The scanner can also annotate Python/FastAPI backends within the existing project type model, using dependency and source-file signals without running Python code.

## Updating Existing Projects

If a project already has old workflow files, `init` will not overwrite them by default.

Recommended update path:

1. Review existing `AGENTS.md`, `skill.md`, and tool instruction files.
2. Move any important custom rules into `AGENTS.md` or `.aidw/rules.md`.
3. Keep tool-specific files short and point them back to `AGENTS.md`.
4. Run:

```bash
npx repo-context-kit init
npx repo-context-kit scan
```

If you want to refresh managed `.aidw` files:

```bash
npx repo-context-kit init --force
```

## Package Layout

This repository is the package source.

The published package includes:

- `bin/`: CLI entry points
- `src/scan/`: scanner and index generation logic
- `template/`: files copied by `init`
- `site/`: local UI frontend served by `repo-context-kit ui`
- `README.md`
- `LICENSE`

## Release Smoke Test

Before publishing, run:

```bash
npm test
npm run release:check
```

Then test in a temporary project:

```bash
npx repo-context-kit init
npx repo-context-kit scan
```

## Notes

- `scan` is safe to re-run
- manual notes in `.aidw/project.md` are preserved
- tool-specific adapters should stay small
- `AGENTS.md` should remain the main workflow entry point
- `.aidw/` should be committed so AI tools share the same project memory

## License

This project is released under the MIT License. See [LICENSE](./LICENSE) for details.
