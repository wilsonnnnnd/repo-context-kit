# Internal Note: Context Compression & Token Economy

This document is an internal implementation summary. It records the development rationale and validation notes behind the context compression work; it is not part of the default product documentation surface.

## Completed Phases

### Phase 1: Canonical Context Layer (Complete)

Objective: eliminate rule duplication across files.

Changes:
1. Created `.aidw/rules-canonical.md` as the single source of truth for all rules.
2. Simplified `AGENTS.md` and kept key output presentation text for test compatibility.
3. Simplified `.aidw/rules.md` into a quick reference that points back to the canonical rules.
4. Simplified `.aidw/workflow.md` into a compact flow with rule references.
5. Updated `.aidw/task-entry.md` to consolidate constraints and point to the canonical rules.
6. Synced the template files so generated projects follow the same canonical-reference approach.

Token impact:
- Approximately 30% less repeated rules prose.
- Removed four duplicated copies of the same rules.
- Canonical references improved cacheability and reuse.

Tests:
- `npm test` passed at the time of the implementation summary.

### Phase 2: Structured Context Compression (Foundation Ready)

Created: `src/runtime/context-compression.js`

Features:
- `computeContextHash()`
- `scoreContextCacheability()`
- `computeRelevanceScore()`
- `detectSemanticDuplication()`
- `normalizeRuleText()`
- `buildEscalationDecision()`
- `filterRelevantFiles()`
- `buildContextCompressionMetrics()`

Created: `src/runtime/context-brief.js`

Features:
- `generateContextBrief()`
- `formatContextBriefCompact()`
- `buildContextReference()`

Impact:
- Foundation for integration into workset and prompt generation.

## Architecture Improvements

### Canonical Reference System

`rules-canonical.md` is the source of truth and is referenced by `AGENTS.md`, `.aidw/rules.md`, `.aidw/workflow.md`, and `.aidw/task-entry.md`.

### Context Compression Pipeline

Raw Context -> Hash -> Relevance Score -> Deduplication -> Brief Format -> Cache

## Preserved Constraints

- Safety gates remained intact.
- Confirmation protocol stayed unchanged.
- Budget policy was preserved.
- CLI main workflow stayed unchanged.
- Output remained compact-first.

## Files Changed

Created:
- `.aidw/rules-canonical.md`
- `template/.aidw/rules-canonical.md`
- `src/runtime/context-compression.js`
- `src/runtime/context-brief.js`

Modified:
- `AGENTS.md`
- `.aidw/rules.md`
- `.aidw/workflow.md`
- `.aidw/task-entry.md`
- `template/AGENTS.md`
- `template/.aidw/rules.md`
- `template/.aidw/task-entry.md`

## Token Economy Results

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Rules prose duplicates | 5 copies | 1 copy | 80% |
| AGENTS.md size | ~60 lines | ~35 lines | 42% |
| Rules file size | ~45 lines | ~25 lines | 44% |
| Workflow file size | ~30 lines | ~15 lines | 50% |
| Canonical source files | 0 | 1 | - |
| Rule reference systems | 0 | 6 | - |

Estimated token savings:
- Approximately 500 tokens saved in repeated rules output per project.
- Approximately 50 to 100 tokens saved per task prompt through canonical references.

## Validation

- `npm test` passed at the time of the implementation summary.
- `repo-context-kit scan` generated canonical rules references.
- No regressions were noted in CLI behavior.
- No breaking changes were made to file formats.