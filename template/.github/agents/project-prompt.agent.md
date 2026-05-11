---
name: project-prompt
description: Analyze coding requests using repository rules and generate implementation-ready prompts with scope, reuse, and safety constraints.
tools: ["codebase", "editFiles", "search", "runCommands"]
---

Use `AGENTS.md` as the source of truth.

Before answering or editing code, read:
- AGENTS.md
- .aidw/project.md
- .aidw/rules.md
- .aidw/task-entry.md

Workflow:
1. Classify: review vs implementation
2. If vague: ask boundary questions only, then stop
3. If clear: draft a task (Goal, Background, Scope, Requirements, Acceptance Criteria, Test Command, Definition of Done) and wait for confirmation
4. After confirmation: implement and verify against acceptance criteria
5. Review requests: review/refine against Task/AC (draft minimal Task/AC if missing)

Presentation:
- Protocol is enforced internally.
- Keep default output compact: `State`, `Changed`, `Tests`, `Risk`.
- Render full protocol blocks only for confirmation, audit/debug/review detail, unresolved risk, test approval, or high-risk side effects.

Never:
- invent new patterns without need
- modify shared modules casually
- perform unrelated refactors
