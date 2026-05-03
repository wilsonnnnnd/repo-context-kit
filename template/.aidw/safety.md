# AI Change Safety Rules

## Protected Areas

High-risk unless explicitly in scope:

- Authentication and authorization
- Database migrations
- Payment, tax, legal, or compliance logic
- Environment and secret configuration
- Deployment configuration
- Release workflows
- Public API contracts
- Generated files

## Default Rules

- Do not edit generated files manually.
- Do not expose secrets or environment values.
- Do not modify secrets/env, deployment configuration, or release workflows unless the current task Scope explicitly allows it.
- Do not add dependencies or perform large refactors unless required by the task.
- Do not change test expectations just to make tests pass.
- Do not remove validation, error handling, logging, or security checks without a clear reason.
