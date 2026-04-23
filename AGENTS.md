# AGENTS.md

## Purpose
This repository uses project-aware AI development rules.

All agents must:
- understand project structure before implementing
- prefer reuse over creating new modules
- protect shared modules with backward-compatible changes
- follow the existing UI and code patterns
- keep changes minimal and localized

## Required context
Read these files first when relevant:
- ai/project.md
- ai/rules.md
- ai/tests/test-case.md

## Task behavior
When a user gives a request:
1. Identify relevant modules and files
2. Ask focused clarification questions if the task is ambiguous
3. Generate an implementation plan or prompt before coding for complex tasks
4. Review the plan for scope, reuse, safety, consistency, simplicity, clarity, and project fit

## Output preference
For complex requests, produce:
- goal
- files to inspect
- constraints
- implementation direction
- acceptance criteria
- what must not change

## Engineering priorities
Reuse > New
Consistency > Cleverness
Safety > Speed
Simplicity > Flexibility