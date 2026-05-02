#!/usr/bin/env node
import path from "path";
import { exists, listDirSafe, writeText } from "../src/scan/fs-utils.js";
import {
    appendTaskToRegistry,
    ensureTaskRegistry,
    getKnownTaskIds,
} from "../src/scan/task-registry.js";

const TASK_DIR = "task";

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

export async function runTask(args = []) {
    const subcommand = args[0];

    if (subcommand !== "new") {
        console.error("Unknown task command.");
        console.log("Usage:");
        console.log('  repo-context-kit task new "Task title"');
        process.exitCode = 1;
        return {
            created: null,
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
