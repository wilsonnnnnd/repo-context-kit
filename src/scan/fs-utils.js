import fs from "fs";
import path from "path";

export function resolveFromProject(relativePath) {
    return path.resolve(process.cwd(), relativePath);
}

export function exists(relativePath) {
    return fs.existsSync(resolveFromProject(relativePath));
}

export function isDirectory(relativePath) {
    const fullPath = resolveFromProject(relativePath);

    if (!fs.existsSync(fullPath)) {
        return false;
    }

    try {
        return fs.statSync(fullPath).isDirectory();
    } catch {
        return false;
    }
}

export function readJson(relativePath) {
    const fullPath = resolveFromProject(relativePath);

    if (!fs.existsSync(fullPath)) {
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch {
        return null;
    }
}

export function readText(relativePath) {
    return fs.readFileSync(resolveFromProject(relativePath), "utf-8");
}

export function writeText(relativePath, content) {
    const fullPath = resolveFromProject(relativePath);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
}

export function ensureDir(relativePath) {
    const fullPath = resolveFromProject(relativePath);

    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
}

export function listDirSafe(relativePath) {
    const fullPath = resolveFromProject(relativePath);

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

export function statSafe(relativePath) {
    const fullPath = resolveFromProject(relativePath);

    try {
        return fs.statSync(fullPath);
    } catch {
        return null;
    }
}
