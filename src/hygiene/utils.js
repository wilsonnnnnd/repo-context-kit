import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stableStringCompare } from "../runtime/stable-sort.js";

export function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function sha256Hex(value) {
    return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function uniqSorted(values) {
    return [...new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))].sort(stableStringCompare);
}

export function toRel(repoRoot, fullPath) {
    return path.relative(repoRoot, fullPath).replaceAll("\\", "/");
}

export function ensureDirForFile(fullPath) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}

export function normalizeRepoRelativePath(value) {
    const text = String(value ?? "").trim().replaceAll("\\", "/");
    if (!text) return null;
    if (text.startsWith("/") || /^[A-Za-z]:\//.test(text)) return null;
    const parts = text.split("/");
    if (parts.some((p) => p === ".." || p === "." || p === "")) return null;
    return parts.join("/");
}
