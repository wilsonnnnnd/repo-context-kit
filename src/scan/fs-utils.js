import fs from "fs";
import path from "path";
import { getRepoRoot } from "../runtime/root-context.js";

export function resolveFromProject(relativePath, cwd = getRepoRoot()) {
    const raw = String(relativePath ?? "");
    if (path.isAbsolute(raw)) {
        return raw;
    }
    return path.resolve(cwd, raw);
}

export function exists(relativePath, cwd = getRepoRoot()) {
    return fs.existsSync(resolveFromProject(relativePath, cwd));
}

export function isDirectory(relativePath, cwd = getRepoRoot()) {
    const fullPath = resolveFromProject(relativePath, cwd);

    if (!fs.existsSync(fullPath)) {
        return false;
    }

    try {
        return fs.statSync(fullPath).isDirectory();
    } catch {
        return false;
    }
}

export function readJson(relativePath, cwd = getRepoRoot()) {
    const fullPath = resolveFromProject(relativePath, cwd);

    if (!fs.existsSync(fullPath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch {
        return null;
    }
}

export function readText(relativePath, cwd = getRepoRoot()) {
    return fs.readFileSync(resolveFromProject(relativePath, cwd), "utf-8");
}

export function writeText(relativePath, content, cwd = getRepoRoot()) {
    const fullPath = resolveFromProject(relativePath, cwd);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
}

export function ensureDir(relativePath, cwd = getRepoRoot()) {
    const fullPath = resolveFromProject(relativePath, cwd);

    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
}

export function listDirSafe(relativePath, cwd = getRepoRoot()) {
    const fullPath = resolveFromProject(relativePath, cwd);

    if (!fs.existsSync(fullPath)) {
        return [];
    }

    try {
        return fs.readdirSync(fullPath);
    } catch {
        return [];
    }
}

export function findFirstExisting(paths) {
    for (const candidate of paths) {
        if (exists(candidate)) {
            return candidate;
        }
    }

    return null;
}

export function anyExists(paths) {
    return paths.some((candidate) => exists(candidate));
}

export function statSafe(relativePath, cwd = getRepoRoot()) {
    const fullPath = resolveFromProject(relativePath, cwd);

    try {
        return fs.statSync(fullPath);
    } catch {
        return null;
    }
}
