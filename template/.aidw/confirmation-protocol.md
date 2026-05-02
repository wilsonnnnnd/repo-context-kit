# AI Execution Confirmation Protocol (v1)

## TL;DR / Quick Reference

- Primary flow: `INTAKE` → `CLASSIFY` → (`CLARIFY`)? → `TASK_DRAFT` → `TASK_CONFIRM` → `IMPLEMENT` → `TESTS_CONFIRM` → (`RUN_TESTS`)? → `AC_REPORT` → `DONE`
- Hard gates:
  - Before `TASK_CONFIRM`: do not edit files; do not run commands.
  - Before `TESTS_CONFIRM`: do not run commands.
- Review mode: review against Task/AC; if Task/AC is missing, draft minimal Task/AC first.
- Host fallback: if buttons are unavailable, confirm via numbered options / fixed phrases.

---

## Global Constraints (Gating Rules)

1. Before `TASK_CONFIRM`:
   - Do not modify any code files.
   - Do not run any commands (including tests).
2. Before `TESTS_CONFIRM`:
   - Do not run any commands (including test commands).
3. Review requests:
   - Review against Task/AC; if Task/AC is missing, draft the minimal Task/AC first, then review against it.
4. If information is insufficient at any stage:
   - Transition to `CLARIFY` and ask only implementation-boundary questions; after clarification, return to `TASK_DRAFT`.

---

## State Machine Nodes

### State Enum

- `INTAKE`: receive request
- `CLASSIFY`: decide review vs implementation
- `CLARIFY`: clarify (questions only, no implementation)
- `TASK_DRAFT`: generate a task draft
- `TASK_CONFIRM`: confirm the task draft
- `IMPLEMENT`: implement (follow Scope/Requirements)
- `TESTS_CONFIRM`: confirm running tests
- `RUN_TESTS`: run the test command
- `AC_REPORT`: produce an acceptance report against AC
- `DONE`: end

### Transitions (High-Level)

- `INTAKE` → `CLASSIFY`
- `CLASSIFY`:
  - review: `TASK_DRAFT` (if no Task/AC) → `TASK_CONFIRM` → `AC_REPORT`
  - implement: `CLARIFY` (if unclear) or `TASK_DRAFT`
- `TASK_DRAFT` → `TASK_CONFIRM`
- `TASK_CONFIRM`:
  - approved: `IMPLEMENT`
  - adjust: `CLARIFY` or `TASK_DRAFT`
- `IMPLEMENT` → `TESTS_CONFIRM`
- `TESTS_CONFIRM`:
  - run: `RUN_TESTS` → `AC_REPORT`
  - skip: `AC_REPORT` (must include a reason category for skipping tests)
- `AC_REPORT` → `DONE`

---

## Unified Output Format (Required for Every Node)

Every output must contain these three sections, with fixed headings:

1) `## State`: machine-readable protocol state
2) `## Output`: user-facing content (task draft, questions, acceptance report, etc.)
3) `## Confirm`: options for click/selection; if no confirmation is needed, write `- None`

### State Section Format (Fixed Fields)

Use the following format (field order is fixed):

```md
## State
- protocol: confirmation-protocol/v1
- state: <STATE>
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: <true|false>
  - allow_commands: <true|false>
- next: <NEXT_STATE>
```

---

## Node Specifications (Per Node)

### 1) INTAKE

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: INTAKE
- mode: IMPLEMENT
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: CLASSIFY

## Output
- Request summary: <one-line summary of the request>

## Confirm
- None
```

### 2) CLASSIFY

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: CLASSIFY
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: <CLARIFY | TASK_DRAFT>

## Output
- Classification: <IMPLEMENT|REVIEW> (reason: <one-line reason>)

## Confirm
- None
```

### 3) CLARIFY

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: CLARIFY
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: TASK_DRAFT

## Output
- Questions:
  - Q1: <question>
  - Q2: <question>
  - Q3: <question>

## Confirm
- Options:
  - 1) <option>
  - 2) <option>
  - 3) <option>
  - 4) <option>
```

### 4) TASK_DRAFT

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: TASK_DRAFT
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: TASK_CONFIRM

## Output
### Task Draft
#### Goal
<...>

#### Background
<...>

#### Scope
Allowed to change:
- <...>

Do not change:
- <...>

#### Requirements
- <...>

#### Risk
- <...>

#### Test Strategy
- <...>

#### Acceptance Criteria
- <...>

#### Test Command
```bash
<...>
```

#### Definition of Done
- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.

## Confirm
- Choose one:
  - Confirm task (proceed)
  - Adjust task (go to clarify)
  - Switch to review mode
  - Cancel
```

### 5) TASK_CONFIRM

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: TASK_CONFIRM
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: <IMPLEMENT | CLARIFY | AC_REPORT | DONE>

## Output
- Awaiting confirmation for the task draft.

## Confirm
- Choose one:
  - Confirm task (proceed)
  - Adjust task (go to clarify)
  - Switch to review mode
  - Cancel
```

### 6) IMPLEMENT

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: IMPLEMENT
- mode: IMPLEMENT
- gating:
  - allow_file_edits: true
  - allow_commands: false
- next: TESTS_CONFIRM

## Output
- Implementation summary:
  - Files changed:
    - <path>
  - Key decisions:
    - <...>
  - Anything not implemented:
    - <None|...>

## Confirm
- Choose one:
  - Confirm tests (run test command)
  - Skip tests (report without running)
  - Adjust task (back to clarify)
```

### 7) TESTS_CONFIRM

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: TESTS_CONFIRM
- mode: IMPLEMENT
- gating:
  - allow_file_edits: true
  - allow_commands: false
- next: <RUN_TESTS | AC_REPORT | CLARIFY>

## Output
- Proposed test command:
  - <command>

## Confirm
- Choose one:
  - Run tests
  - Skip tests (reason: no_tests_available)
  - Skip tests (reason: too_expensive_now)
  - Adjust task (back to clarify)
```

### 8) RUN_TESTS

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: RUN_TESTS
- mode: IMPLEMENT
- gating:
  - allow_file_edits: true
  - allow_commands: true
- next: AC_REPORT

## Output
- Test result:
  - command: <...>
  - exit_code: <...>
  - summary: <pass|fail>

## Confirm
- None
```

### 9) AC_REPORT

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: AC_REPORT
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: <true|false>
  - allow_commands: <true|false>
- next: DONE

## Output
### Acceptance Report

#### Acceptance Criteria
- AC1: <text>
  - status: <PASS|FAIL|N/A>
  - evidence:
    - <tests|manual|notes>: <...>

- AC2: <text>
  - status: <PASS|FAIL|N/A>
  - evidence:
    - <...>

#### Files Changed
- <path>

#### Tests Run
- <command or "skipped">

#### Remaining Risks
- <...>

## Confirm
- None
```

### 10) DONE

Fixed output template:

```md
## State
- protocol: confirmation-protocol/v1
- state: DONE
- mode: <IMPLEMENT | REVIEW>
- gating:
  - allow_file_edits: false
  - allow_commands: false
- next: NONE

## Output
- Done.

## Confirm
- None
```

---

## Host Compatibility Notes (Trae / Copilot / Codex)

- Trae: render `## Confirm` options as buttons; treat “run command / write files” as controlled actions triggered only after the relevant confirmation.
- Copilot Chat: if buttons are unavailable, use `1/2/3/4` for confirmation; do not output code-changing instructions before the user confirms.
- Codex: same numbered confirmation; if tool/command execution is available, it must respect gating (only execute when `allow_commands` is true).
