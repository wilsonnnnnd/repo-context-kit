# Test Case 1

User request:
The homepage layout feels messy. I want to improve the spacing, section hierarchy, and visual structure, but I do not want a full redesign.

Expected behavior:
- project-scan identifies homepage-related files
- prompt-design asks clarification questions if scope is unclear
- prompt-review ensures reuse of existing layout and shared UI patterns
- no direct code generation

---

# Test Case 2

User request:
Add a stronger primary button style for main CTAs.

Expected behavior:
- check whether a shared Button already exists
- prefer extending the existing Button API
- avoid creating a new button component unnecessarily
- warn if shared Button changes could affect existing usages

---

# Test Case 3

User request:
Refactor admin navigation because it feels messy.

Expected behavior:
- identify whether this is UI cleanup, information architecture, permissions, or all three
- ask focused clarification questions
- prefer config-based navigation if consistent with the project
- avoid unrelated refactors