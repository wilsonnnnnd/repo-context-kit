# Project Brief

Human-owned project context for repo-context-kit.

Edit this file directly. repo-context-kit reads it during `scan` and summarizes it into `.aidw/AI_project.md`.

## Project Purpose

repo-context-kit is a bounded AI coding preflight and workflow governance layer, not an autonomous agent. It prepares repositories for AI-assisted development by generating context, workflow guidance, task scaffolds, preflight checks, and MCP/runtime surfaces with explicit safety boundaries.

## Tech Stack

- Language: JavaScript
- Runtime: Node.js
- Package manager: npm
- Module system: ESM
- Distribution: npm CLI package
- Main binaries: `repo-context-kit`, `repo-context-kit-mcp`

## Product / Domain Requirements

- Keep the default user workflow small: `init`, `scan`, `bootstrap doctor`, `task new`, `task prompt`, `implement`, `task checklist`, `task pr`, `scan --check`, `bootstrap doctor --check`.
- Treat `.aidw/` as runtime/generated governance context.
- Treat `PROJECT.md` as the human-owned project brief.
- Keep protocol enforcement internal and compact output as the default external presentation.
- Preserve deterministic behavior for scan/check/doctor outputs.

## Architecture Notes

- `bin/` contains CLI entry points and command handlers.
- `src/scan/` contains project detection, index generation, and generated context writers.
- `src/bootstrap/` contains bootstrap planning, doctor, diff, explain, and apply logic.
- `src/mcp/` exposes the MCP runtime interface.
- `template/` contains files copied by `repo-context-kit init`.
- `test/cli.test.js` is the main regression suite.

## Development Requirements

- Prefer existing patterns over new abstractions.
- Keep changes minimal and backward-compatible unless a task explicitly requests a breaking migration.
- Update tests when CLI output, generated files, paths, or governance behavior changes.
- Run `npm test` before marking implementation complete.

## Safety / Boundaries

- Do not turn repo-context-kit into an autonomous agent.
- Do not add hidden execution, silent modification, or auto-fix behavior.
- Do not let signals such as doctor summaries, lessons, or budget decisions become actions without explicit gates.
- Keep MCP write/test/external side-effect capabilities opt-in and tiered.

## AI Collaboration Preferences

- Preferred output style: compact by default.
- Expand only for confirmation, unresolved scope, test approval, high-risk operations, audit/debug/review, or unresolved risks.
- Keep final reports short: `Done`, `Tests`, `Note`.

## AI Runtime Project Design (PDGL) (v1)

<!-- PDGL:v1 START -->
### Project Identity
- Project Name: repo-context-kit
- One-line Summary: Bounded AI coding preflight and workflow governance layer.
- Target Users: Developers using AI coding tools in existing repositories.
- Non-goals: Autonomous agent behavior, hidden execution, silent source modification.

### Product / Runtime Intent
- What problem does this project solve?: It gives AI coding tools deterministic repo context, preflight checks, task workflow, and explicit gates before risky actions.
- What should AI optimize for?: Bounded context, review-first workflow, deterministic outputs, safety boundaries.
- What must AI avoid?: Auto-fixing, arbitrary shell execution, dependency installation, silent PR creation, broad unrelated refactors.
- What is intentionally out of scope?: Full IDE replacement, autonomous coding runtime, project management suite.

### Stack Decisions
- Language: JavaScript
- Framework: none
- Runtime: Node.js
- Package Manager: npm
- Database: none
- Deployment Environment: npm package / local CLI

### Runtime Constraints
- Files never touch: secrets, release credentials, generated indexes unless running scan
- Dangerous operations: hidden execution, external side effects, destructive git operations
- Deployment boundaries: npm package metadata and release config require explicit scope
- Network restrictions: no network use unless explicitly requested by a command/integration
- Command restrictions: tests only through explicit commands/gates
- MCP write policy: tiered read-only / workflow-write / test-exec / external-side-effect

### Development Workflow
- Preferred workflow: init -> scan -> bootstrap doctor -> task new -> task prompt -> implement -> task checklist -> task pr -> scan --check -> doctor --check
- Testing strategy: npm test
- Definition of Done: scoped implementation, tests pass, generated context refreshed when relevant
- Required verification: run focused tests or full npm test for workflow/runtime changes
- Snapshot expectations: deterministic generated files and sorted indexes

### Architecture Notes
- Entry points: bin/cli.js, bin/mcp.js
- Directory conventions: bin for commands, src for implementation, template for initialized files, test for regression suite
- Config sources: package.json, template files, .aidw runtime context
- Critical modules: scan, bootstrap doctor, task workflow, MCP tools, gate/runtime policy
- Shared abstractions: stable sorting, bounded context, runtime gates, MCP capability tiers

### Bootstrap Guidance
- Recommended scaffold: existing repo init via repo-context-kit init
- Manual setup steps: edit PROJECT.md, run scan, review doctor output
- Human-required setup: task scope confirmation, test approval, external side-effect approval
- Secrets/config setup expectations: never print or store secrets outside explicit auth helpers

### AI Collaboration Rules
- How AI should propose changes: compact by default, expand only for risk/confirmation/audit
- How AI should ask for clarification: ask focused boundary questions
- Preferred output structure: Done / Tests / Note
- What requires confirmation: scope changes, tests, writes, destructive actions, external side effects
<!-- PDGL:v1 END -->

## Stable Human Context (SHC) (v1)

<!-- SHC:v1 START -->
### Project Goal
- Provide a bounded AI coding preflight and workflow governance layer.

### Target Users
- Developers and teams using AI coding assistants on real repositories.

### Non-goals
- Autonomous agent execution, silent fixes, arbitrary shell runtime, full IDE replacement.

### Stack Decisions
- Node.js ESM CLI distributed through npm.

### Runtime Constraints
- Keep writes explicit, bounded, and reviewable.

### Directory Conventions
- `bin/` for CLI, `src/` for logic, `template/` for initialized files, `.aidw/` for runtime/generated context.

### Config Sources
- `package.json`, `PROJECT.md`, `.aidw/AI_project.md`, template files.

### Testing Strategy
- `npm test`.

### Release Constraints
- Package metadata and release workflows require explicit task scope.

### Files Never Touch
- Secrets, credentials, unrelated release config, generated files outside scan.

### Deployment Boundaries
- npm package behavior and template output are user-facing compatibility surfaces.
<!-- SHC:v1 END -->
