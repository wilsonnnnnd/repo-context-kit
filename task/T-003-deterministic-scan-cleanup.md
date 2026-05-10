# T-003 Deterministic Scan Cleanup

## Goal

Reduce nondeterminism in scan/index/task/context outputs by using stable, locale-independent sorting and documenting mtime-based freshness limitations.

## Background

Determinism is a core governance requirement. Locale-dependent ordering and filesystem mtime variability can cause cross-machine drift and CI false positives.

## Scope

Allowed to change:

- Sorting utilities used by scan/index/task/context outputs
- Documentation describing freshness limitations
- Tests validating stable ordering and bounded output

Do not change:

- No redesign of scan architecture
- No switch to hash-based freshness unless already available and bounded
- No new control planes

## Requirements

- Replace locale-dependent comparators on key outputs with a stable comparator.
- Document that freshness may still depend on mtime and can vary across machines/CI.
- Add tests that validate stable ordering and bounded trimming behavior.

## Acceptance Criteria

- Key outputs no longer use locale-dependent sorting.
- Governance docs mention mtime freshness limitations.
- Tests cover comparator stability and bounded trimming.
- `npm test` passes.

## Test Command

```bash
npm test
```

## Definition of Done

- Determinism improvements implemented.
- Tests added/updated.
- Test command passes.

