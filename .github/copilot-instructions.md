# GitHub Copilot Repository Instructions

Follow these repository rules for all coding tasks.

## Project awareness
- Read project structure before suggesting implementation
- Prefer existing patterns over inventing new ones
- Match naming, file organization, and component patterns

## Reuse-first policy
- Reuse existing components, hooks, utilities, and services
- Do not duplicate logic
- Extend existing patterns before creating new modules

## Shared-module policy
- Modify shared modules only if strongly related
- Keep changes backward compatible
- Avoid breaking existing usages

## UI policy
- Follow hierarchy: global -> layout -> component -> element
- Prefer shared styles, tokens, and reusable UI primitives
- Avoid one-off visual patterns

## Scope and safety
- Keep changes minimal and localized
- Avoid unrelated refactors
- Do not rename contracts unless required
- Keep TypeScript valid

## Task behavior
- If the task is ambiguous, ask clarification questions first
- When proposing implementation, include:
  - files to inspect
  - constraints
  - acceptance criteria