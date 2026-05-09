import fs from "fs";
import path from "path";
import { getRepoRoot } from "../runtime/root-context.js";
import {
    FASTAPI_ENTRYPOINT_PATHS,
    PYTHON_PROJECT_FILES,
} from "./constants.js";
import { anyExists, exists, readText, resolveFromProject } from "./fs-utils.js";

const SKIPPED_DIRS = new Set([
    ".git",
    ".aidw",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
]);

export function hasPythonProjectFile() {
    return anyExists(PYTHON_PROJECT_FILES);
}

function readTextSafe(relativePath) {
    if (!exists(relativePath)) {
        return "";
    }

    try {
        return readText(relativePath);
    } catch {
        return "";
    }
}

function hasFastApiDependencyInText(content) {
    return /^fastapi(?:\s|=|<|>|~|\[|$)/im.test(content);
}

export function listPythonFiles(dir = getRepoRoot(), results = []) {
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) {
                listPythonFiles(path.join(dir, entry.name), results);
            }
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".py")) {
            results.push(
                path
                    .relative(getRepoRoot(), path.join(dir, entry.name))
                    .replaceAll(path.sep, "/"),
            );
        }
    }

    return results;
}

export function hasFastApiSourceSignal(filePath) {
    const content = readTextSafe(filePath);

    return (
        content.includes("FastAPI(") ||
        content.includes("from fastapi import") ||
        content.includes("import fastapi")
    );
}

export function hasFastApiDependency() {
    return (
        hasFastApiDependencyInText(readTextSafe("requirements.txt")) ||
        hasFastApiDependencyInText(readTextSafe("pyproject.toml"))
    );
}

export function hasFastApiSignal() {
    return (
        hasFastApiDependency() ||
        listPythonFiles().some((filePath) => hasFastApiSourceSignal(filePath))
    );
}

export function getFastApiEntrypointCandidates() {
    const candidates = new Set();

    for (const filePath of FASTAPI_ENTRYPOINT_PATHS) {
        if (exists(filePath)) {
            candidates.add(filePath);
        }
    }

    for (const filePath of listPythonFiles()) {
        const content = readTextSafe(filePath);

        if (
            content.includes("app = FastAPI(") ||
            content.includes("FastAPI(") ||
            content.includes("uvicorn.run(") ||
            content.includes("uvicorn ")
        ) {
            candidates.add(filePath);
        }
    }

    return [...candidates].filter((filePath) => {
        try {
            return fs.statSync(resolveFromProject(filePath)).isFile();
        } catch {
            return false;
        }
    });
}
