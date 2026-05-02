#!/usr/bin/env node
import path from "path";
import { buildWorksetContext } from "./context.js";
import { TASK_REGISTRY_PATH } from "../src/scan/constants.js";
import { exists, listDirSafe, readText, writeText } from "../src/scan/fs-utils.js";
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

function buildTaskTemplate(taskId, title, testCommand) {
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

- 

## Acceptance Criteria

- 

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

function renderPromptManifest({ taskId, deep, maxChars, warnings }) {
    return [
        "## Context Manifest",
        "",
        "- context level: task prompt",
        `- selected task id: ${taskId ?? "none"}`,
        `- included sources: ${TASK_REGISTRY_PATH}, selected task detail when available, context workset ${deep ? "--deep" : "default"}`,
        "- excluded sources: unselected task detail files, full files.json dump, full symbols.json dump, generated index dumps",
        `- limits used: maxChars=${maxChars}, worksetMode=${deep ? "deep" : "default"}`,
        `- warnings: ${warnings.length ? [...new Set(warnings)].join(" | ") : "none"}`,
    ].join("\n");
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
        console.log('  repo-context-kit task new "Task title"');
        console.log("  repo-context-kit task prompt <taskId> [--deep]");
        process.exitCode = 1;
        return {
            created: null,
            output: null,
        };
    }

    const rawTitle = args.slice(1).join(" ").trim();
    const slug = slugify(rawTitle || "new-task");
    const taskNumber = getNextTaskNumber();
    const taskId = `T-${taskNumber}`;
    const title = rawTitle ? normalizeTitle(rawTitle) : toTitleCase(slug);
    const filePath = path.posix.join(TASK_DIR, `${taskId}-${slug}.md`);

    ensureTaskRegistry();
    writeText(filePath, buildTaskTemplate(taskId, title, detectDefaultTestCommand()));
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
