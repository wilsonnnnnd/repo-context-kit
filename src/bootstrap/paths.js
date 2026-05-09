import path from "node:path";
import {
    BOOTSTRAP_ALLOWED_FILES,
    BOOTSTRAP_ALLOWED_PATH_PREFIXES,
} from "./constants.js";

function toPosixPath(value) {
    return String(value ?? "").trim().replaceAll("\\", "/");
}

export function normalizeRepoRelativePath(value) {
    const raw = toPosixPath(value);
    if (!raw) {
        throw new Error("path is required");
    }
    if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
        throw new Error("path must be repo-relative");
    }
    const parts = raw.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
        throw new Error("path must not contain traversal segments");
    }
    return parts.join("/");
}

export function assertBootstrapPathAllowed(relativePath) {
    const rel = normalizeRepoRelativePath(relativePath);
    if (BOOTSTRAP_ALLOWED_FILES.has(rel)) {
        return rel;
    }
    for (const prefix of BOOTSTRAP_ALLOWED_PATH_PREFIXES) {
        if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) {
            return rel;
        }
    }
    throw new Error(`path is not allowed: ${rel}`);
}

export function resolveWithinRepoRoot(repoRoot, relativePath) {
    const root = String(repoRoot ?? "").trim();
    if (!root) {
        throw new Error("repoRoot is required");
    }
    const rel = normalizeRepoRelativePath(relativePath);
    const fullPath = path.resolve(root, rel);
    const check = path.resolve(root);
    const resolved = path.resolve(fullPath);
    const relative = path.relative(check, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("path escapes repoRoot");
    }
    return { root, rel, fullPath: resolved };
}

