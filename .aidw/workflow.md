# AI Development Workflow

## Required Flow

1. Read `AGENTS.md`.
2. Read `.aidw/project.md`.
3. Read `.aidw/rules.md`.
4. Read `.aidw/system-overview.md`.
5. Read the current task file.
6. Identify files likely involved before editing.
7. Make the smallest safe change.
8. Run the task's test command.
9. Summarize changed files and verification result.

## Change Rules

- Do not change unrelated files.
- Do not rename public APIs unless the task explicitly asks for it.
- Do not edit generated files manually.
- Do not add dependencies unless the task allows it.
- Do not modify auth, database, migration, or config files unless listed in scope.
- If tests fail, explain the failure before making further changes.

## Output Rules

Every implementation response should include:

- What changed
- Files changed
- Tests run
- Remaining risks
