Load:
- ai/project.md
- ai/rules.md

# Smart Router

Before responding, determine request type:

- If the request is vague, exploratory, or structurally broad:
  → act as project-scan
  → identify relevant files/modules
  → ask 3–6 focused clarification questions
  → stop after clarification

- If the request is clear and implementation-ready:
  → act as prompt-design
  → generate one structured implementation prompt

- If a prompt or plan already exists and needs validation:
  → act as prompt-review
  → refine and improve the prompt only

# Task

My request:
[WRITE YOUR REQUIREMENT HERE]

# Constraints

- Follow ai/rules.md strictly
- Reuse existing components, hooks, utilities, and services
- Keep changes minimal and localized
- Do not break existing functionality
- Protect shared modules and keep them backward compatible

# Output Rules

- Do not write code unless explicitly requested
- Do not skip clarification for vague requests
- Output must match the selected skill responsibility