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
- Project memory: stores durable project context, rules, notes, and task guidance under `.aidw/`

The goal is simple: AI tools should understand the project before suggesting implementation.

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
| `.aidw/index/files.json` | Important files and descriptions |
| `.aidw/index/symbols.json` | Functions, classes, components, and exports |
| `.aidw/index/entrypoints.json` | CLI, app, and execution entry points |
| `.aidw/index/file-groups.json` | Directory-level grouping and key files |
| `.aidw/index/summary.json` | Scan metadata and index counts |
| `.aidw/context/tasks.json` | Common task types mapped to relevant files |
| `.aidw/AI.md` | Compact guide for AI tools using the indexes |

These files help assistants find the right files faster and avoid guessing project structure.

## Project Memory

Project memory lives in `.aidw/`.

The most important files are:

- `.aidw/project.md`: generated project context plus manual notes
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

Scans the current repository and updates `.aidw/project.md` plus the index files.

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
