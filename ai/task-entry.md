Load:
- ai/project.md
- ai/rules.md

---

# Smart Router

Before executing, determine which skill to use.

## Routing Logic

- If the request is vague, exploratory, or high-level  
  → use **project-scan**

- If the request is clear and needs an implementation plan or prompt  
  → use **prompt-design**

- If a prompt or plan already exists and needs validation  
  → use **prompt-review**

---

# Task

My request:
[WRITE YOUR REQUIREMENT HERE]

---

# Execution Instructions

1. Apply the Router logic first  
2. Select the correct skill  
3. Execute ONLY that skill’s responsibility  

---

# Constraints

- Follow ai/rules.md strictly
- Reuse existing components, hooks, utilities, and services
- Do NOT duplicate logic
- Keep changes minimal and localized
- Do NOT break existing functionality
- Protect shared modules (must remain backward compatible)

---

# Output Rules

- Do NOT directly write code unless explicitly requested
- Output must match the selected skill’s responsibility

---

# Expected Behavior

## If project-scan is used:
- Identify relevant modules and files
- List reusable components/utilities
- Highlight risky/shared areas
- Ask clarification questions if needed

## If prompt-design is used:
- Generate ONE structured implementation prompt
- Include:
  - Task goal
  - Files to inspect first
  - Constraints
  - Implementation direction
  - Output requirements
  - Acceptance criteria
  - What must NOT be changed

## If prompt-review is used:
- Evaluate the prompt using:
  - Scope
  - Reuse
  - Safety
  - Consistency
  - Simplicity
  - Clarity
  - Project Fit
- Return ONLY the improved prompt

---

# Final Rule

Always prioritize:
Reuse > New  
Consistency > Cleverness  
Safety > Speed  