# AI Change Safety Rules

## Protected Areas

Treat these as high-risk unless the task explicitly includes them in scope:

- Authentication and authorization
- Database migrations
- Payment, tax, legal, or compliance logic
- Environment and secret configuration
- Deployment configuration
- Public API contracts
- Generated files

## Default Rules

- Do not edit generated files manually.
- Do not expose secrets or environment values.
- Do not add new dependencies without explaining why.
- Do not perform large refactors unless explicitly requested.
- Do not change test expectations just to make tests pass.
- Do not remove validation, error handling, logging, or security checks without explanation.
