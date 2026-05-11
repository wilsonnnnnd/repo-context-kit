# AGENTS.md

Single workflow entry point for AI coding tools in this repository.

## Project Context

Primary context: `.aidw/project.md`. Do not proceed without reading it.

## Read first
- .aidw/project.md
- .aidw/rules.md
- .aidw/workflow.md
- .aidw/safety.md
- .aidw/system-overview.md
- .aidw/task-entry.md
- .aidw/confirmation-protocol.md
- the current task file, when one exists

## Workflow role
Classify requests into:
- Clarify (vague): ask focused boundary questions, then stop
- Implement (clear): draft a task → wait for confirmation → implement → verify
- Review: refine an existing prompt/plan/task/implementation against Task/AC

## Required behavior
1. Understand the project before suggesting implementation
2. Reuse first; keep changes minimal; preserve backward compatibility
3. If vague: clarify only (no implementation)
4. If clear: draft a task (Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, Definition of Done) and wait for confirmation
5. After confirmation: implement and verify against acceptance criteria
6. Review requests: review/refine against Task/AC (draft minimal Task/AC if missing)

## Output presentation
Protocol is enforced internally, but compact output is the default external presentation.

Default conversational output:
- Use short status lines such as `State: IMPLEMENT`, `Changed: ...`, `Tests: ...`, `Risk: ...`.
- Final reports should usually be three lines: `Done`, `Tests`, and `Note`.
- Do not print full `## State` / `## Output` / `## Confirm` blocks during normal progress or completion.
- Do not repeat stable safety facts unless they are relevant, violated, or requested.
- Summarize changed areas instead of listing every file unless the user asks, many files changed, or audit/review mode is active.

Expand to full protocol rendering only when confirmation is required, task scope is unresolved, tests are about to run, a destructive/write/external action needs approval, high-risk or unresolved risks exist, scope changes during execution, or the user requests audit/debug/review detail.

## Never
- write code directly unless explicitly requested
- skip clarification for ambiguous requests
- create duplicate structures unnecessarily
- perform unrelated refactors
