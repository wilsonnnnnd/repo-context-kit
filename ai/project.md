# Project Context

## Overview
This is a production-oriented software project.

Goals:
- maintainable implementation
- reusable UI and logic
- minimal regressions
- predictable changes

## Tech Stack
- Frontend:
- Backend:
- Language:
- Styling:
- State:
- Database:
- Auth:

## Structure Overview
- app/ or src/app/ -> routes and page entry points
- components/ui/ -> shared reusable UI components
- components/* -> feature-level components
- lib/ -> utilities, helpers, shared logic
- services/ -> business logic or API layer
- config/ -> project configuration
- docs/ -> design and architecture notes

## Reusable System
### Shared Components
- Button
- Card
- Modal
- Form controls
- Layout wrappers

### Shared Utilities
- API client
- formatting helpers
- validation helpers
- mapping helpers

## UI System
- Prefer shared tokens, layout primitives, and reusable components
- Follow hierarchy:
  global -> layout -> component -> element

## Risk Areas
- shared components
- auth
- routing
- config
- global styles
- data fetching layer

## Project Notes
- Reuse before create
- Prefer small localized changes
- Preserve existing conventions unless explicitly changed