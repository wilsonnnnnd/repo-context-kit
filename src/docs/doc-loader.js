import fs from "node:fs";
import path from "node:path";

const MAX_DOC_BYTES = 200 * 1024;
const MAX_HEADINGS = 32;

function toPosixPath(value) {
    return String(value ?? "").split(path.sep).join("/");
}

function isPathInsideRoot(rootDir, filePath) {
    const rel = path.relative(rootDir, filePath);
    if (!rel) return true;
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isBlockedSegment(filePath) {
    const segments = toPosixPath(filePath).split("/").filter(Boolean);
    return segments.includes("node_modules") || segments.includes(".git");
}

function detectBinary(buffer) {
    if (!Buffer.isBuffer(buffer)) return false;
    return buffer.includes(0);
}

function parseMarkdownTitle(content, fallback) {
    const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
    for (const line of lines) {
        const match = line.match(/^#\s+(.+?)\s*$/);
        if (match) {
            const title = String(match[1]).trim();
            if (title) return title;
        }
    }
    for (const line of lines) {
        const title = String(line).trim();
        if (title) return title;
    }
    return fallback;
}

function parseHeadings(content) {
    const headings = [];
    const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
    for (const line of lines) {
        const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (!match) continue;
        const text = String(match[2]).trim();
        if (!text) continue;
        headings.push(text);
        if (headings.length >= MAX_HEADINGS) break;
    }
    return headings;
}

export function loadDesignDoc(docPath, { repoRoot } = {}) {
    const root = String(repoRoot ?? "").trim();
    if (!root) {
        const error = new Error("repoRoot is required");
        error.code = "MISSING_ROOT";
        throw error;
    }
    const input = String(docPath ?? "").trim();
    if (!input) {
        const error = new Error("path is required");
        error.code = "MISSING_PATH";
        throw error;
    }
    const absolute = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
    if (!isPathInsideRoot(root, absolute)) {
        const error = new Error("Doc path escapes repoRoot");
        error.code = "PATH_ESCAPE";
        throw error;
    }
    if (isBlockedSegment(absolute)) {
        const error = new Error("Doc path is not allowed");
        error.code = "PATH_BLOCKED";
        throw error;
    }
    const ext = path.extname(absolute).toLowerCase();
    if (ext !== ".md" && ext !== ".txt") {
        const error = new Error("Only .md and .txt documents are supported");
        error.code = "UNSUPPORTED_DOC_TYPE";
        throw error;
    }
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        const error = new Error("Doc file not found");
        error.code = "DOC_NOT_FOUND";
        throw error;
    }
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_DOC_BYTES) {
        const error = new Error("Doc file is too large");
        error.code = "DOC_TOO_LARGE";
        error.maxBytes = MAX_DOC_BYTES;
        error.sizeBytes = stat.size;
        throw error;
    }
    const buffer = fs.readFileSync(absolute);
    if (detectBinary(buffer)) {
        const error = new Error("Binary documents are not supported");
        error.code = "BINARY_DOC";
        throw error;
    }
    const content = buffer.toString("utf-8");
    if (content.includes("\uFFFD")) {
        const error = new Error("Doc must be valid UTF-8");
        error.code = "INVALID_UTF8";
        throw error;
    }
    const relative = toPosixPath(path.relative(root, absolute));
    const fallbackTitle = path.basename(absolute, ext);
    const title = parseMarkdownTitle(content, fallbackTitle);
    const headings = parseHeadings(content);
    const estimatedSections = headings.length;
    return {
        path: relative,
        content,
        metadata: {
            title,
            headings,
            estimatedSections,
            sizeBytes: stat.size,
        },
    };
}

