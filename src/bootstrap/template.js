import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stablePathCompare } from "../runtime/stable-sort.js";

function toPosixPath(value) {
    return String(value ?? "").split(path.sep).join("/");
}

function sortEntries(entries) {
    return [...entries].sort(stablePathCompare);
}

export function getInternalTemplateDir() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.resolve(__dirname, "../../template");
}

export function listTemplateFiles(templateDir = getInternalTemplateDir()) {
    const out = [];
    function walk(dir) {
        const items = fs.readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
        for (const name of sortEntries(items)) {
            const fullPath = path.join(dir, name);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (stat.isFile()) {
                out.push(toPosixPath(path.relative(templateDir, fullPath)));
            }
        }
    }
    walk(templateDir);
    return out;
}

export function readTemplateFileBytes(relativePath, templateDir = getInternalTemplateDir()) {
    const rel = String(relativePath ?? "").trim().replaceAll("\\", "/");
    if (!rel) {
        throw new Error("template path is required");
    }
    const fullPath = path.resolve(templateDir, rel);
    const check = path.resolve(templateDir);
    const relative = path.relative(check, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("template path escapes template dir");
    }
    return fs.readFileSync(fullPath);
}
