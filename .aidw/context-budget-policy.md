# Context Budget Policy (v1)

Core rule: spend tokens where they change decisions (not everywhere).

## Modes

- `off` (default): do not auto-upgrade; only explicit flags change output.
- `auto`: start cheap, then upgrade when signals indicate higher uncertainty or risk.
- `full`: always expand within bounded limits.

Enable via:

- CLI: `--budget off|auto|full`
- Env: `REPO_CONTEXT_KIT_BUDGET=off|auto|full`

## Budgets

### Default Budget (cheap)

- Prefer digest + compact outputs:
  - `context brief`
  - `context next-task`
  - `context workset <taskId>` (default digest)
  - `task prompt <taskId> --compact`

### Exception Budget (auto-upgrade)

Auto-upgrade only when signals indicate higher decision risk, for example:

- Recent test failures or instability (Context Loop)
- High-risk areas detected in the workset
- Missing/unknown/stale context signals (warnings, missing scan outputs)

### Full Budget (explicit)

Use only when explicitly requested or review-heavy work needs extra context:

- user requests `--full-*`, `--deep`, `--manifest`, `--verbose`
- or `--budget full`

## Upgrade Rules (Automatic)

When `--budget auto` is enabled:

- **Explicit flags win.** If a user passes `--full`, `--digest`, `--deep`, `--full-detail`, `--full-workset`, `--manifest`, or `--verbose`, do not downgrade.
- Upgrade should stay bounded (never dump full generated indexes).
- Prefer upgrades that improve decision quality:
  - show clearer warnings (`--verbose`)
  - include more relevant context (`--full-detail`, `--full-workset`)
  - expand bounded context only when needed (`--deep`)

## Budget Decision Block

When budget mode is `auto` or `full` (via flag or env), commands output a fixed block:

```md
## Budget Decision
- mode: auto
- decision: EXCEPTION
- confidence: HIGH (0.80)
- upgrades_applied: full-detail, full-workset
- reason_codes: RECENT_TEST_FAIL, WARNINGS_PRESENT
- evidence:
  - last_test_exit=1 command="npm test"
  - warnings_count=2
- override:
  - use --budget off to disable auto budget
  - use --budget full for explicit full output
```

The same decision is appended to `.aidw/context-loop.jsonl` as an event:

```json
{
  "type": "budget_decision",
  "mode": "auto",
  "decision": "EXCEPTION",
  "reasonCodes": ["RECENT_TEST_FAIL"],
  "evidence": ["last_test_exit=1 command=\"npm test\"", "warnings_count=2"]
}
```

## Command Mappings

### `context brief`

- Default: digest; scan summary as short lines (no JSON).
- Auto-upgrade on recent failing test / instability:
  - include raw loop evidence (bounded)
  - show full warnings

### `context next-task`

- Default: digest.
- Auto-upgrade on failing/unstable task:
  - switch to non-digest to include more task detail and loop context (bounded)
  - show full warnings

### `context workset <taskId>`

- Default: digest workset.
- Auto-upgrade when the task is failing/unstable or the project has known risk areas:
  - expand from digest to full (bounded)
  - show full warnings and include loop evidence when relevant

### `task prompt|checklist|pr <taskId>`

- Default: bounded outputs based on the default workset.
- Auto-upgrade when signals indicate higher uncertainty/risk:
  - expand task detail and workset (bounded)
  - show full warnings
  - include a short Context Loop signal summary for decision-making

