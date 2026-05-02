import path from "path";
import { TASK_REGISTRY_PATH } from "./constants.js";
import { exists, listDirSafe, readText } from "./fs-utils.js";
import { parseTaskRegistry } from "./task-registry.js";

export const TASK_DIR = "task";

function readTextSafe(filePath) {
    if (!exists(filePath)) {
        return "";
    }

    try {
        return readText(filePath);
    } catch {
        return "";
    }
}

export function listTaskFiles() {
    return listDirSafe(TASK_DIR)
        .filter((fileName) => path.extname(fileName).toLowerCase() === ".md")
        .map((fileName) => `${TASK_DIR}/${fileName}`)
        .filter((filePath) => filePath !== TASK_REGISTRY_PATH)
        .filter((filePath) => exists(filePath))
        .sort();
}

function extractTaskId(filePath, content) {
    const basenameMatch = path.basename(filePath).match(/^(T-\d{3})\b/i);

    if (basenameMatch) {
        return basenameMatch[1].toUpperCase();
    }

    const headingMatch = content.match(/^#\s+(T-\d{3})\b/im);

    return headingMatch?.[1]?.toUpperCase() ?? null;
}

function extractTaskTitle(content, id, filePath) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const heading = headingMatch?.[1]?.trim();

    if (heading) {
        return id ? heading.replace(new RegExp(`^${id}\\s*`, "i"), "").trim() : heading;
    }

    return path
        .basename(filePath, ".md")
        .replace(/^T-\d{3}-/i, "")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function parseTaskFile(filePath) {
    const content = readTextSafe(filePath);
    const id = extractTaskId(filePath, content);
    const title = extractTaskTitle(content, id, filePath);

    return {
        path: filePath,
        id,
        title,
        hasAcceptanceCriteria: /^##\s+Acceptance Criteria\b/im.test(content),
        hasTestCommand: /^##\s+Test Command\b/im.test(content),
        hasDefinitionOfDone: /^##\s+Definition of Done\b/im.test(content),
    };
}

export function getTaskFileMetadata() {
    return listTaskFiles().map(parseTaskFile);
}

export function getMergedTaskMetadata() {
    const registry = parseTaskRegistry();
    const fileTasks = getTaskFileMetadata();
    const fileTasksByPath = new Map(fileTasks.map((task) => [task.path, task]));
    const registryFiles = new Set(registry.tasks.map((task) => task.file).filter(Boolean));
    const registryTasks = registry.tasks.map((task) => {
        const fileTask = task.file ? fileTasksByPath.get(task.file) : null;

        return {
            ...task,
            path: task.file,
            hasAcceptanceCriteria: Boolean(fileTask?.hasAcceptanceCriteria),
            hasTestCommand: Boolean(fileTask?.hasTestCommand),
            hasDefinitionOfDone: Boolean(fileTask?.hasDefinitionOfDone),
        };
    });

    if (registry.exists) {
        const unregisteredTasks = fileTasks
            .filter((task) => !registryFiles.has(task.path))
            .map((task) => ({
                ...task,
                status: null,
                priority: null,
                owner: null,
                dependencies: null,
                file: task.path,
            }));

        return [...registryTasks, ...unregisteredTasks];
    }

    return fileTasks.map((task) => ({
        ...task,
        status: null,
        priority: null,
        owner: null,
        dependencies: null,
        file: task.path,
    }));
}

export function getTaskConsistencyWarnings() {
    const registry = parseTaskRegistry();
    const fileTasks = getTaskFileMetadata();
    const warnings = [];
    const registryIds = new Set(registry.tasks.map((task) => task.id).filter(Boolean));
    const registryFiles = new Set(registry.tasks.map((task) => task.file).filter(Boolean));

    if (!registry.exists && fileTasks.length > 0) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing but task files exist`);
    }

    for (const task of registry.tasks) {
        if (task.file && !exists(task.file)) {
            warnings.push(`${task.id} is listed in ${TASK_REGISTRY_PATH} but ${task.file} is missing`);
            continue;
        }

        const fileTask = task.file ? parseTaskFile(task.file) : null;

        if (fileTask?.id && task.id && fileTask.id !== task.id) {
            warnings.push(`${task.file} has ID ${fileTask.id} but registry lists ${task.id}`);
        }
    }

    for (const task of fileTasks) {
        if (!registryFiles.has(task.path) && !registryIds.has(task.id)) {
            warnings.push(`${task.path} exists but is not listed in ${TASK_REGISTRY_PATH}`);
        }
    }

    return warnings.sort();
}

export function getTaskHealthSummary(tasks = getMergedTaskMetadata()) {
    return {
        count: tasks.length,
        withAcceptanceCriteria: tasks.filter((task) => task.hasAcceptanceCriteria).length,
        withTestCommand: tasks.filter((task) => task.hasTestCommand).length,
        withDefinitionOfDone: tasks.filter((task) => task.hasDefinitionOfDone).length,
    };
}
