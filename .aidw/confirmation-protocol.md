# AI Execution Confirmation Protocol (v1)

This file defines a portable click-to-confirm state machine protocol that can be followed consistently across Trae chat, VSCode Copilot Chat, Codex, and similar hosts.

User request → auto-generate Task → click to confirm → implement → run tests → produce an acceptance report against AC

Goals:

- Standardize the control points that decide whether the assistant is allowed to proceed (confirmation gates).
- Standardize the output format for each stage (copy/paste friendly, tool-parseable).
- Provide a fallback confirmation mechanism for hosts without buttons (numbered options / fixed phrases).

Non-goals:

- Defining concrete implementation details (those are task/project-specific).
- Replacing the project’s own safety rules, boundaries, or governance.

---

## Terminology

- Task: an implementation task description using the repository task template sections (Goal / Background / Scope / Requirements / Risk / Test Strategy / Acceptance Criteria / Test Command / Definition of Done).
- AC: Acceptance Criteria.
- Click-to-confirm: the host provides buttons/option selection; if not available, the user confirms via option numbers or fixed phrases.
- State machine: the stages and transitions from receiving a request to completing acceptance.

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

Entry condition: receive a natural-language user request.

Output requirements:

- Summarize the request (do not expand into a solution).
- Transition to `CLASSIFY`.

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

Classification rules (any match implies REVIEW):

- The user explicitly asks to review/check/critique/improve a prompt/plan/implementation/etc.
- The user provides existing material (prompt/plan/code snippet/diff/PR) and requests evaluation.

Output requirements:

- Output the selected `mode` and a one-line reason.
- If REVIEW and Task/AC is missing: go to `TASK_DRAFT` to draft Task/AC first.
- If IMPLEMENT and information is insufficient: go to `CLARIFY`.

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

Goal: collect implementation boundaries and acceptance details so a Task can be drafted.

Output requirements:

- Ask questions only; do not propose implementation solutions.
- Prefer click-to-select options; each question should have 2–4 options.
- If the host does not support buttons: allow answers via `A/B/C/D` or `1/2/3/4`.

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

Goal: freeze the request into an implementation-ready, verifiable task draft.

Output requirements:

- Output the task sections in the exact order:
  - Goal
  - Background
  - Scope (Allowed to change / Do not change)
  - Requirements
  - Risk
  - Test Strategy
  - Acceptance Criteria
  - Test Command
  - Definition of Done

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

Goal: obtain explicit user authorization for the task draft.

Output requirements:

- Do not require long-form text input; only allow click-to-confirm or select adjust/cancel.
- After the user selects “Confirm task”, transition to `IMPLEMENT` and unlock file edits.

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

Goal: implement changes according to Scope/Requirements.

Output requirements:

- Produce an “implementation summary” that lists:
  - Files changed
  - Key decisions
  - Anything not implemented
- Do not output the full acceptance report yet (leave it for `AC_REPORT`).

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

Goal: obtain authorization to run the test command.

Output requirements:

- Click-to-confirm running the `Test Command`, or click-to-skip (must select a skip reason category).
- If `repo-context-kit gate run-test <taskId>` is available, prefer executing tests via the gate to enforce confirmation.

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

Goal: run the test command and record results.

Output requirements:

- Output a short test result summary (pass/fail).
- If tests fail: still transition to `AC_REPORT`, and mark affected AC items plus failure evidence.

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

Goal: produce the acceptance report against AC (final deliverable).

Output requirements:

- List each AC item and its status: `PASS` / `FAIL` / `N/A`.
- Each AC item must include at least one evidence field:
  - tests: command and result summary
  - manual: manual validation steps and observations
  - notes: constraints/risks
- Must include “Files changed / Tests run / Remaining risks”.

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

Goal: end the flow.

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
