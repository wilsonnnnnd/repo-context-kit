# Non-goals and Automation Boundaries

repo-context-kit is a bounded AI coding preflight and workflow governance layer, not an autonomous agent.

This project intentionally does not automate high-risk work just because it can detect, describe, or plan it.

## Do Not Automate

repo-context-kit must not automatically:

- Modify application or business source code.
- Install, upgrade, or remove dependencies.
- Run arbitrary shell commands.
- Commit, push, merge, or create pull requests.
- Apply bootstrap doctor suggestions.
- Convert lessons, budget decisions, doctor summaries, or context-loop signals into writes.
- Approve task or test gates on behalf of a user.
- Read or write files outside the repository root.
- Expand doctor into a framework lint suite.

## Allowed Automation

Allowed automation must stay bounded and review-first:

- Read-only context loading and summaries.
- Deterministic preflight checks.
- Managed workflow-file writes after explicit confirmation.
- Allowlisted test execution through the confirmation gate.
- External side effects only through explicit highest-risk confirmation.

## Design Rule

Signals may influence warnings, context size, risk summaries, and suggested next steps. Signals must not directly trigger writes, command execution, fixes, gate approval, or external side effects.
