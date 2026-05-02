#!/usr/bin/env node
import path from "path";
import { buildWorksetContext } from "./context.js";
import { TASK_REGISTRY_PATH } from "../src/scan/constants.js";
import { exists, listDirSafe, readText, writeText } from "../src/scan/fs-utils.js";
import { evaluateContextLoop } from "../src/loop/analyze.js";
import {
    appendTaskToRegistry,
    ensureTaskRegistry,
    getKnownTaskIds,
    parseTaskRegistry,
} from "../src/scan/task-registry.js";

const TASK_DIR = "task";
const PROMPT_LIMITS = {
    default: 20000,
    deep: 28000,
};
const CHECKLIST_LIMITS = {
    default: 14000,
    deep: 20000,
};
const PR_LIMITS = {
    default: 14000,
    deep: 20000,
};

function toTitleCase(slug) {
    return slug
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function normalizeTitle(title) {
    return title
        .trim()
        .split(/\s+/)
        .map((word) =>
            /^[A-Z0-9]+$/.test(word)
                ? word
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
}

function slugify(title) {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || "new-task";
}

function getNextTaskNumber() {
    const fileNumbers = listDirSafe(TASK_DIR)
        .map((fileName) => fileName.match(/^T-(\d{3})\b/i)?.[1])
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10));
    const numbers = [...fileNumbers, ...getKnownTaskIds()];
    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

    return String(next).padStart(3, "0");
}

function detectDefaultTestCommand() {
    const hasPackageJson = exists("package.json");
    const hasPythonConfig =
        exists("pyproject.toml") ||
        exists("requirements.txt") ||
        exists("pytest.ini");

    if (hasPackageJson) {
        return "npm test";
    }

    if (hasPythonConfig) {
        return "pytest";
    }

    return "TODO: add test command";
}

function toBulletList(items, fallback) {
    const cleaned = (items ?? [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
    if (cleaned.length === 0) {
        return `- ${fallback}`;
    }
    return cleaned.map((item) => `- ${item}`).join("\n");
}

function buildTaskTemplate(taskId, title, testCommand, seed = {}) {
    const requirements = toBulletList(seed.requirementItems, " ");
    const risk = toBulletList(seed.riskItems, " ");
    const testStrategy = toBulletList(seed.testStrategyItems, " ");
    const acceptanceCriteria = toBulletList(seed.acceptanceCriteriaItems, " ");
    return `# ${taskId} ${title}

## Goal

Describe the user-facing or developer-facing outcome.

## Background

Explain why this task exists and any product/domain boundaries.

## Scope

Allowed to change:

- 

Do not change:

- 

## Requirements

${requirements}

## Risk

${risk}

## Test Strategy

${testStrategy}

## Acceptance Criteria

${acceptanceCriteria}

## Test Command

\`\`\`bash
${testCommand}
\`\`\`

## Definition of Done

- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.
`;
}

function findTaskById(registry, taskId) {
    return registry.tasks.find((task) => task.id.toLowerCase() === taskId.toLowerCase()) ?? null;
}

function normalizeDependencies(dependencies) {
    const raw = String(dependencies ?? "").trim();

    if (!raw || raw === "-") {
        return [];
    }

    return raw
        .split(/[, ]+/)
        .map((dependency) => dependency.trim())
        .filter(Boolean);
}

function formatList(items) {
    if (items.length === 0) {
        return "- None";
    }

    return items.map((item) => `- ${item}`).join("\n");
}

function extractSection(content, heading) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = content.match(regex);

    return match?.groups?.body?.trim() ?? "";
}

function extractWorksetSection(workset, heading) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = workset.match(regex);

    return match?.groups?.body?.trim() ?? "";
}

function toCheckboxItems(content, fallback) {
    const items = String(content ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\[[ xX]\]\s+/, ""))
        .filter(Boolean);

    if (items.length === 0) {
        return [`- [ ] ${fallback}`];
    }

    return items.map((item) => `- [ ] ${item}`);
}

function getDependencySummaries(task, registry) {
    return normalizeDependencies(task.dependencies).map((dependencyId) => {
        const dependency = findTaskById(registry, dependencyId);

        if (!dependency) {
            return `${dependencyId}: not found in ${TASK_REGISTRY_PATH}`;
        }

        return `${dependency.id}: ${dependency.title} (${dependency.status || "unknown"})`;
    });
}

function readTaskDetail(task, warnings) {
    if (!task.file) {
        warnings.push(`Task ${task.id} has no detail file listed.`);
        return "";
    }

    if (!exists(task.file)) {
        warnings.push(`Task detail file is missing: ${task.file}.`);
        return "";
    }

    return readText(task.file);
}

function renderTaskOutputManifest({
    level,
    taskId,
    deep,
    maxChars,
    warnings,
    excludedSources = [],
}) {
    return [
        "## Context Manifest",
        "",
        `- context level: ${level}`,
        `- selected task id: ${taskId ?? "none"}`,
        `- included sources: ${TASK_REGISTRY_PATH}, selected task detail when available, context workset ${deep ? "--deep" : "default"}`,
        `- excluded sources: ${[
            "unselected task detail files",
            "full files.json dump",
            "full symbols.json dump",
            "generated index dumps",
            ...excludedSources,
        ].join(", ")}`,
        `- limits used: maxChars=${maxChars}, worksetMode=${deep ? "deep" : "default"}`,
        `- warnings: ${warnings.length ? [...new Set(warnings)].join(" | ") : "none"}`,
    ].join("\n");
}

function renderPromptManifest(options) {
    return renderTaskOutputManifest({
        ...options,
        level: "task prompt",
    });
}

function renderChecklistManifest({ taskId, deep, maxChars, warnings }) {
    return renderTaskOutputManifest({
        taskId,
        deep,
        maxChars,
        warnings,
        level: "task checklist",
    });
}

function renderPrManifest({ taskId, deep, maxChars, warnings }) {
    return renderTaskOutputManifest({
        taskId,
        deep,
        maxChars,
        warnings,
        level: "task pr",
        excludedSources: ["git diff", "GitHub data"],
    });
}

function renderBoundedPrompt(parts, manifest, maxChars) {
    let body = parts.filter(Boolean).join("\n\n").trim();
    let output = `${body}\n\n${manifest}\n`;

    if (output.length <= maxChars) {
        return output;
    }

    body = `${body.slice(0, Math.max(0, maxChars - manifest.length - 80)).trimEnd()}\n[truncated]`;
    output = `${body}\n\n${manifest}\n`;

    if (output.length <= maxChars) {
        return output;
    }

    return output.slice(0, Math.max(0, maxChars - 14)).trimEnd() + "\n[truncated]\n";
}

function getLikelyTestFiles(workset) {
    return [
        ...new Set(
            (workset.match(/(?:^|\s)((?:test|tests)\/[A-Za-z0-9._/-]+)/gm) ?? [])
                .map((match) => match.trim().replace(/^[-*]\s+/, "").split(/\s+/)[0])
                .map((filePath) => filePath.replace(/[),.;]+$/g, "")),
        ),
    ];
}

function buildTaskPrDescription(taskId, options = {}) {
    const deep = Boolean(options.deep);
    const maxChars = deep ? PR_LIMITS.deep : PR_LIMITS.default;
    const warnings = [];
    const registry = parseTaskRegistry();

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBoundedPrompt([
            "# Pull Request Description",
            "Warning: missing task id.",
            "Usage: repo-context-kit task pr <taskId> [--deep]",
        ], renderPrManifest({ taskId: null, deep, maxChars, warnings }), maxChars);
    }

    if (!registry.exists) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing. Create tasks with repo-context-kit task new or restore the task registry.`);
        return renderBoundedPrompt([
            "# Pull Request Description",
            `Warning: ${TASK_REGISTRY_PATH} is missing.`,
            "A PR description could not be generated because the task registry is required to resolve task IDs.",
        ], renderPrManifest({ taskId, deep, maxChars, warnings }), maxChars);
    }

    const task = findTaskById(registry, taskId);

    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBoundedPrompt([
            "# Pull Request Description",
            `Warning: task not found: ${taskId}.`,
            `Check ${TASK_REGISTRY_PATH} for available task IDs.`,
        ], renderPrManifest({ taskId, deep, maxChars, warnings }), maxChars);
    }

    const taskDetail = readTaskDetail(task, warnings);
    const workset = buildWorksetContext(task.id, { deep });
    const goal = extractSection(taskDetail, "Goal") || "Address the selected task using the available registry metadata and workset context.";
    const scope = extractSection(taskDetail, "Scope");
    const acceptanceCriteria = extractSection(taskDetail, "Acceptance Criteria");
    const riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
    const relatedFiles = extractWorksetSection(workset, "Related File Candidates");

    if (workset.includes("Run repo-context-kit scan")) {
        warnings.push("Generated indexes may be missing or stale. Run repo-context-kit scan for richer workset context.");
    }

    const scopeItems = scope
        ? toCheckboxItems(scope, "Review proposed task scope.")
        : toCheckboxItems(relatedFiles, "Review related workset candidates before editing.");
    const verificationItems = acceptanceCriteria
        ? toCheckboxItems(acceptanceCriteria, "Verify the task outcome.")
        : [
            "- [ ] Verify the selected task goal is satisfied.",
            "- [ ] Confirm behavior manually where automated coverage is unavailable.",
        ];
    const parts = [
        "# Pull Request Description",
        [
            "## Title Suggestion",
            "",
            `${task.id}: ${task.title}`,
        ].join("\n"),
        [
            "## Summary",
            "",
            "This PR is intended to address the selected task. The description is generated before reading any git diff, so proposed changes are phrased as planned scope rather than completed work.",
            "",
            goal,
        ].join("\n"),
        [
            "## Linked Task",
            "",
            `- task: ${task.id}`,
            `- title: ${task.title}`,
            `- status: ${task.status || "unknown"}`,
            `- priority: ${task.priority || "-"}`,
            `- owner: ${task.owner || "-"}`,
            `- dependencies: ${task.dependencies || "-"}`,
            `- file: ${task.file || "-"}`,
        ].join("\n"),
        [
            "## Scope",
            "",
            ...scopeItems,
        ].join("\n"),
        [
            "## Changes Checklist",
            "",
            "- [ ] Make only the changes needed for this task.",
            "- [ ] Keep changes minimal and aligned with existing project style.",
            "- [ ] Avoid manual edits to generated `.aidw/index/*` files.",
            "- [ ] Update docs or tests only when they are part of the task scope.",
        ].join("\n"),
        [
            "## Verification Checklist",
            "",
            ...verificationItems,
            "- [ ] Run appropriate tests before marking the PR ready.",
            "- [ ] Record actual commands and results after tests are run.",
        ].join("\n"),
        [
            "## Risk Areas",
            "",
            riskAreas || "_No indexed risk areas were available._",
        ].join("\n"),
        [
            "## Rollback / Review Notes",
            "",
            "- Review related entry points and shared modules carefully before merge.",
            "- If the task changes CLI behavior, compare command output before and after the change.",
            "- Rollback should revert only this task's scoped changes.",
        ].join("\n"),
        [
            "## Missing Context Warnings",
            "",
            warnings.length ? formatList([...new Set(warnings)]) : "- None",
        ].join("\n"),
    ];

    return renderBoundedPrompt(
        parts,
        renderPrManifest({ taskId: task.id, deep, maxChars, warnings }),
        maxChars,
    );
}

function buildTaskChecklist(taskId, options = {}) {
    const deep = Boolean(options.deep);
    const maxChars = deep ? CHECKLIST_LIMITS.deep : CHECKLIST_LIMITS.default;
    const warnings = [];
    const registry = parseTaskRegistry();

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBoundedPrompt([
            "# Task Test Checklist",
            "Warning: missing task id.",
            "Usage: repo-context-kit task checklist <taskId> [--deep]",
        ], renderChecklistManifest({ taskId: null, deep, maxChars, warnings }), maxChars);
    }

    if (!registry.exists) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing. Create tasks with repo-context-kit task new or restore the task registry.`);
        return renderBoundedPrompt([
            "# Task Test Checklist",
            `Warning: ${TASK_REGISTRY_PATH} is missing.`,
            "A checklist could not be generated because the task registry is required to resolve task IDs.",
        ], renderChecklistManifest({ taskId, deep, maxChars, warnings }), maxChars);
    }

    const task = findTaskById(registry, taskId);

    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBoundedPrompt([
            "# Task Test Checklist",
            `Warning: task not found: ${taskId}.`,
            `Check ${TASK_REGISTRY_PATH} for available task IDs.`,
        ], renderChecklistManifest({ taskId, deep, maxChars, warnings }), maxChars);
    }

    const taskDetail = readTaskDetail(task, warnings);
    const workset = buildWorksetContext(task.id, { deep });
    const goal = extractSection(taskDetail, "Goal") || "Review task detail and registry metadata to confirm the intended outcome.";
    const acceptanceCriteria = extractSection(taskDetail, "Acceptance Criteria");
    const riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
    const likelyTestFiles = getLikelyTestFiles(workset);

    if (workset.includes("Run repo-context-kit scan")) {
        warnings.push("Generated indexes may be missing or stale. Run repo-context-kit scan for richer workset context.");
    }

    const testChecklist = likelyTestFiles.length > 0
        ? likelyTestFiles.map((filePath) => `- [ ] Review or update likely test file: \`${filePath}\`.`)
        : [
            "- [ ] Identify the nearest relevant test area from the task scope.",
            "- [ ] Add or update focused tests if behavior changes.",
            "- [ ] Run the project test command documented by the task or package when ready.",
        ];
    const parts = [
        "# Task Test Checklist",
        [
            "## Task",
            "",
            `- id: ${task.id}`,
            `- title: ${task.title}`,
            `- status: ${task.status || "unknown"}`,
            `- priority: ${task.priority || "-"}`,
            `- owner: ${task.owner || "-"}`,
            `- dependencies: ${task.dependencies || "-"}`,
        ].join("\n"),
        [
            "## Task Goal Summary",
            "",
            goal,
        ].join("\n"),
        [
            "## Acceptance Criteria Checklist",
            "",
            ...toCheckboxItems(acceptanceCriteria, "Confirm acceptance criteria with the task owner because none were found."),
        ].join("\n"),
        [
            "## Implementation Verification Checklist",
            "",
            "- [ ] Confirm the change implements only this task.",
            "- [ ] Confirm generated `.aidw/index/*` files were not edited manually.",
            "- [ ] Confirm unrelated files were not changed.",
            "- [ ] Confirm existing project style and structure were preserved.",
            "- [ ] Confirm edge cases from the task detail were considered.",
        ].join("\n"),
        [
            "## Test Checklist",
            "",
            ...testChecklist,
            "- [ ] Record the exact tests run and their results.",
        ].join("\n"),
        [
            "## Regression Risk Checklist",
            "",
            "- [ ] Review related file candidates from the workset before changing shared behavior.",
            "- [ ] Check relevant entry points for command/API/user-flow impact.",
            riskAreas ? "- [ ] Review the risk areas listed below." : "- [ ] Identify risk areas manually if scan context is unavailable.",
            "",
            riskAreas || "_No indexed risk areas were available._",
        ].join("\n"),
        [
            "## Manual Verification Checklist",
            "",
            "- [ ] Exercise the changed workflow manually if it affects CLI output, generated prompts, or user-facing behavior.",
            "- [ ] Confirm warnings are clear when expected context is missing.",
            "- [ ] Confirm output remains bounded and does not dump full generated indexes.",
        ].join("\n"),
        [
            "## Workset Reference",
            "",
            "Use this bounded workset for related files, symbols, entry points, read order, and warnings.",
            "",
            workset.trim(),
        ].join("\n"),
    ];

    return renderBoundedPrompt(
        parts,
        renderChecklistManifest({ taskId: task.id, deep, maxChars, warnings }),
        maxChars,
    );
}

function buildTaskPrompt(taskId, options = {}) {
    const deep = Boolean(options.deep);
    const maxChars = deep ? PROMPT_LIMITS.deep : PROMPT_LIMITS.default;
    const warnings = [];
    const registry = parseTaskRegistry();

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBoundedPrompt([
            "# Task Implementation Prompt",
            "Warning: missing task id.",
            "Usage: repo-context-kit task prompt <taskId> [--deep]",
        ], renderPromptManifest({ taskId: null, deep, maxChars, warnings }), maxChars);
    }

    if (!registry.exists) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing. Create tasks with repo-context-kit task new or restore the task registry.`);
        return renderBoundedPrompt([
            "# Task Implementation Prompt",
            `Warning: ${TASK_REGISTRY_PATH} is missing.`,
            "A task prompt could not be generated because the task registry is required to resolve task IDs.",
        ], renderPromptManifest({ taskId, deep, maxChars, warnings }), maxChars);
    }

    const task = findTaskById(registry, taskId);

    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBoundedPrompt([
            "# Task Implementation Prompt",
            `Warning: task not found: ${taskId}.`,
            `Check ${TASK_REGISTRY_PATH} for available task IDs.`,
        ], renderPromptManifest({ taskId, deep, maxChars, warnings }), maxChars);
    }

    const taskDetail = readTaskDetail(task, warnings);
    const workset = buildWorksetContext(task.id, { deep });
    const dependencySummaries = getDependencySummaries(task, registry);
    const parts = [
        "# Task Implementation Prompt",
        [
            "## Role",
            "",
            "You are an AI coding tool working inside this repository. Follow repo-context-kit boundaries, use the provided project context, and make only the changes needed for the selected task.",
        ].join("\n"),
        [
            "## Project Context",
            "",
            "Use the concise project context and boundaries in the workset below. Generated index files are context sources only and must not be edited manually.",
        ].join("\n"),
        [
            "## Task",
            "",
            `- id: ${task.id}`,
            `- title: ${task.title}`,
            `- status: ${task.status || "unknown"}`,
            `- priority: ${task.priority || "-"}`,
            `- owner: ${task.owner || "-"}`,
            `- dependencies: ${task.dependencies || "-"}`,
            "",
            "### Dependency Summary",
            "",
            formatList(dependencySummaries),
            "",
            "### Task Detail",
            "",
            taskDetail || "_Task detail file is unavailable. Use registry metadata and ask for more specific context if needed._",
        ].join("\n"),
        [
            "## Relevant Workset",
            "",
            "The following bounded workset was generated by the progressive context loader.",
            "",
            workset.trim(),
        ].join("\n"),
        [
            "## Implementation Rules",
            "",
            "- Only implement this task.",
            "- Do not modify generated `.aidw/index/*` files manually.",
            "- Do not change unrelated files.",
            "- Respect existing project style and structure.",
            "- Keep changes minimal and focused.",
            "- Add or update tests when appropriate.",
            "- If context is insufficient, ask for more specific context instead of guessing.",
        ].join("\n"),
        [
            "## Required Final Response Format",
            "",
            "- Summary",
            "- Files changed",
            "- Key decisions",
            "- Tests run",
            "- Anything not implemented",
        ].join("\n"),
    ];

    if (workset.includes("Run repo-context-kit scan")) {
        warnings.push("Generated indexes may be missing or stale. Run repo-context-kit scan for richer workset context.");
    }

    return renderBoundedPrompt(
        parts,
        renderPromptManifest({ taskId: task.id, deep, maxChars, warnings }),
        maxChars,
    );
}

export async function runTask(args = []) {
    const subcommand = args[0];

    if (subcommand === "pr") {
        const taskId = args.slice(1).find((arg) => !arg.startsWith("--"));
        const output = buildTaskPrDescription(taskId, {
            deep: args.includes("--deep"),
        });

        console.log(output.trimEnd());

        return {
            output,
        };
    }

    if (subcommand === "checklist") {
        const taskId = args.slice(1).find((arg) => !arg.startsWith("--"));
        const output = buildTaskChecklist(taskId, {
            deep: args.includes("--deep"),
        });

        console.log(output.trimEnd());

        return {
            output,
        };
    }

    if (subcommand === "prompt") {
        const taskId = args.slice(1).find((arg) => !arg.startsWith("--"));
        const output = buildTaskPrompt(taskId, {
            deep: args.includes("--deep"),
        });

        console.log(output.trimEnd());

        return {
            output,
        };
    }

    if (subcommand !== "new") {
        console.error("Unknown task command.");
        console.log("Usage:");
        console.log('  repo-context-kit task new "Task title" [--force]');
        console.log("  repo-context-kit task checklist <taskId> [--deep]");
        console.log("  repo-context-kit task pr <taskId> [--deep]");
        console.log("  repo-context-kit task prompt <taskId> [--deep]");
        process.exitCode = 1;
        return {
            created: null,
            output: null,
        };
    }

    const force = args.includes("--force");
    const rawTitle = args.filter((arg) => arg !== "--force").slice(1).join(" ").trim();
    const slug = slugify(rawTitle || "new-task");
    const taskNumber = getNextTaskNumber();
    const taskId = `T-${taskNumber}`;
    const title = rawTitle ? normalizeTitle(rawTitle) : toTitleCase(slug);
    const filePath = path.posix.join(TASK_DIR, `${taskId}-${slug}.md`);

    const loop = evaluateContextLoop({ requestedTitle: title });
    if (loop.constraints.blockNewTask && !force) {
        console.error("✖ Task creation blocked by Context Loop constraints");
        console.error(loop.constraints.blockReason || "Task creation is blocked.");
        if (loop.mutations.suggestedFixTaskTitle) {
            console.error("");
            console.error("Suggested next step:");
            console.error(`- Create a fix task: repo-context-kit task new "${loop.mutations.suggestedFixTaskTitle}"`);
        }
        console.error("");
        console.error('Override: repo-context-kit task new "Title" --force');
        process.exitCode = 1;
        return {
            created: null,
            output: null,
        };
    }

    ensureTaskRegistry();
    writeText(filePath, buildTaskTemplate(taskId, title, detectDefaultTestCommand(), loop.mutations));
    appendTaskToRegistry({
        id: taskId,
        title,
        file: filePath,
    });

    console.log("\u2714 Task created");
    console.log("");
    console.log("Created:");
    console.log(`* ${filePath}`);

    return {
        created: filePath,
    };
}
