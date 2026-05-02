import {
    TASK_REGISTRY_PATH,
} from "./constants.js";
import { exists, readText, writeText } from "./fs-utils.js";

const STATUS_ORDER = ["todo", "in_progress", "done", "blocked", "cancelled"];

function normalizeContent(content) {
    return content.replace(/\r\n/g, "\n").trimEnd();
}

function normalizeRegistryFile(fileCell) {
    const linkMatch = fileCell.match(/\[[^\]]+\]\(([^)]+)\)/);
    const rawPath = (linkMatch?.[1] ?? fileCell).trim();

    if (!rawPath || rawPath === "-") {
        return null;
    }

    const normalized = rawPath.replace(/^\.\//, "");

    return normalized.startsWith("task/") ? normalized : `task/${normalized}`;
}

function formatTaskRow(task) {
    const fileName = task.file?.replace(/^task\//, "") ?? "";
    const fileLabel = task.id || fileName.replace(/\.md$/i, "");
    const fileLink = fileName ? `[${fileLabel}](./${fileName})` : "-";

    return `| ${task.id} | ${task.title} | ${task.status || "todo"} | ${task.priority || "medium"} | ${task.owner || "-"} | ${task.dependencies || "-"} | ${fileLink} |`;
}

export function createTaskRegistryContent(tasks = []) {
    const lines = [
        "# Task Registry",
        "",
        "<!-- AUTO-GENERATED: repo-context-kit. Some sections may be updated automatically. -->",
        "",
        "## Status Legend",
        "",
        "- todo: Not started",
        "- in_progress: Currently being worked on",
        "- blocked: Waiting on dependency or decision",
        "- done: Completed and verified",
        "- cancelled: No longer planned",
        "",
        "## Tasks",
        "",
        "| ID | Title | Status | Priority | Owner | Dependencies | File |",
        "|----|------|--------|----------|-------|--------------|------|",
        ...tasks.map(formatTaskRow),
    ];

    return `${lines.join("\n")}\n`;
}

export function ensureTaskRegistry() {
    if (exists(TASK_REGISTRY_PATH)) {
        return false;
    }

    writeText(TASK_REGISTRY_PATH, createTaskRegistryContent());
    return true;
}

export function parseTaskRegistry() {
    if (!exists(TASK_REGISTRY_PATH)) {
        return {
            exists: false,
            tasks: [],
        };
    }

    const lines = readText(TASK_REGISTRY_PATH).replace(/\r\n/g, "\n").split("\n");
    const tasks = [];
    let inTasks = false;

    for (const line of lines) {
        if (/^##\s+Tasks\s*$/i.test(line.trim())) {
            inTasks = true;
            continue;
        }

        if (inTasks && /^##\s+/.test(line.trim())) {
            break;
        }

        if (!inTasks || !line.trim().startsWith("|")) {
            continue;
        }

        const cells = line
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((cell) => cell.trim());

        if (
            cells.length < 7 ||
            cells[0].toLowerCase() === "id" ||
            cells.every((cell) => /^-+$/.test(cell))
        ) {
            continue;
        }

        tasks.push({
            id: cells[0],
            title: cells[1],
            status: cells[2],
            priority: cells[3],
            owner: cells[4],
            dependencies: cells[5],
            file: normalizeRegistryFile(cells[6]),
        });
    }

    return {
        exists: true,
        tasks,
    };
}

export function appendTaskToRegistry(task) {
    ensureTaskRegistry();

    const registry = parseTaskRegistry();

    if (registry.tasks.some((entry) => entry.id === task.id)) {
        return false;
    }

    const nextTasks = [
        ...registry.tasks,
        {
            status: "todo",
            priority: "medium",
            owner: "-",
            dependencies: "-",
            ...task,
        },
    ];
    const nextContent = createTaskRegistryContent(nextTasks);

    if (normalizeContent(readText(TASK_REGISTRY_PATH)) === normalizeContent(nextContent)) {
        return false;
    }

    writeText(TASK_REGISTRY_PATH, nextContent);
    return true;
}

export function getRegistryStatusBreakdown(tasks = parseTaskRegistry().tasks) {
    const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));

    for (const task of tasks) {
        if (Object.hasOwn(counts, task.status)) {
            counts[task.status] += 1;
        }
    }

    return counts;
}

export function getKnownTaskIds() {
    return parseTaskRegistry().tasks
        .map((task) => task.id?.match(/^T-(\d{3})$/i)?.[1])
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10));
}
