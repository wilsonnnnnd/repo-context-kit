# AI System Overview

<!-- AUTO-GENERATED: repo-context-kit. Do not edit manually. -->

## Purpose

This file summarizes the AI-readable context system for this repository.

## Context Sources

- `.aidw/project.md` - status: present - Generated project summary and durable manual notes
- `.aidw/index/summary.json` - status: present - Scan metadata and index counts
- `.aidw/index/entrypoints.json` - status: present - Detected CLI, app, and execution entry points
- `.aidw/index/file-groups.json` - status: present - Directory-level groups and key files
- `.aidw/index/files.json` - status: present - Important files with AI-readable descriptions
- `.aidw/index/symbols.json` - status: present - Detected functions, classes, components, and exports

## Rule Sources

- `AGENTS.md` - status: present - Main AI workflow entry point
- `.aidw/rules.md` - status: present - Repository engineering rules and constraints
- `.aidw/confirmation-protocol.md` - status: present - Click-to-confirm execution protocol and output templates
- `.aidw/workflow.md` - status: present - Standard AI-assisted development workflow
- `.aidw/safety.md` - status: present - Protected areas and AI change safety rules
- `.github/copilot-instructions.md` - status: present - GitHub Copilot repository instructions
- `.trae/rules/project_rules.md` - status: present - Trae repository rules adapter
- `skill.md` - status: present - Claude-style skill workflow adapter

## Task Sources

- `.aidw/task-entry.md` - status: present - Reusable task request template
- `task/*.md` - status: missing - Markdown task files (0 detected)
- `.aidw/context/tasks.json` - status: present - Generated task-to-file mapping index

## Task Registry

- Registry file: task/task.md (present)
- Total tasks: 0
- Status breakdown:
  - todo: 0
  - in_progress: 0
  - done: 0
  - blocked: 0
  - cancelled: 0

- Task health:
  - tasks with acceptance criteria: 0 / 0
  - tasks with test command: 0 / 0
  - tasks with definition of done: 0 / 0

## Task Health

- Task count: 0
- Tasks with acceptance criteria: 0
- Tasks with test command: 0
- Tasks with definition of done: 0

## Generated Indexes

- `.aidw/index/summary.json` - status: present - Scan metadata and index counts
- `.aidw/index/entrypoints.json` - status: present - Detected execution entry points
- `.aidw/index/file-groups.json` - status: present - Directory groups and key files
- `.aidw/index/files.json` - status: present - Important file map
- `.aidw/index/symbols.json` - status: present - Detected source symbols

## AI Tool Adapters

- `AGENTS.md` - status: present - Main AI entry point
- `.github/copilot-instructions.md` - status: present - GitHub Copilot
- `.trae/rules/project_rules.md` - status: present - Trae

## Execution Loop (Optional)

- `.aidw/confirmation-gate.json` - status: missing - Local gate state for task/test confirmations (runtime file)
- `.aidw/context-loop.jsonl` - status: missing - Append-only context loop log for recent confirmations and test runs (runtime file)
- `.aidw/context-cache.md` - status: missing - Cached token-efficient brief context output (runtime file)
- `repo-context-kit loop report` - status: missing - Summarize constraints and derived patterns from recent loop events

## Recommended AI Workflow

1. Read AGENTS.md first.
2. Read .aidw/project.md for project context.
3. Read .aidw/rules.md for repository rules.
4. Read .aidw/system-overview.md to understand available context sources.
5. Read the current task file before making changes.
6. Use .aidw/index/* files to locate relevant code.
7. Preserve project structure and update tests.
