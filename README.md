## 🧩 Architecture

### 1. Project Context (`/ai/project.md`)
Defines:
- tech stack
- folder structure
- reusable components
- UI system
- risk areas

👉 answers: *"what is this project?"*

---

### 2. Engineering Rules (`/ai/rules.md`)
Defines:
- reuse-first policy
- shared module protection
- UI constraints
- scope control

👉 answers: *"what is allowed?"*

---

### 3. Controller (`/skill.md`)
Acts as the global controller / router.

Responsibilities:
- classify requests
- decide whether to scan, design, or review
- enforce clarification before execution
- prevent direct code generation for vague requests

👉 answers: *"what should happen first?"*

---

### 4. Skill Executors (`/.claude/skills/`)
Split into:

- `project-scan` → understand project structure and clarify scope
- `prompt-design` → generate implementation prompt
- `prompt-review` → enforce quality & constraints

👉 answers: *"which specialized behavior should run?"*

---

### 5. Task Entry (`/ai/task-entry.md`)
The entry point for every request.

Includes:
- task input
- controller usage
- constraints
- output rules

👉 answers: *"how do we start?"*

---

### 6. Testing (`/ai/tests/test-case.md`)
Used to validate:

- AI follows rules
- AI chooses correct behavior
- AI does NOT generate unsafe outputs
- `ai/tests/expected-good-output.md` contains reference outputs for validating workflow quality
