import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function ensureRuntimeDir(repoRoot) {
    fs.mkdirSync(path.resolve(repoRoot, ".aidw/runtime"), { recursive: true });
}

function getSessionsPath(repoRoot) {
    return path.resolve(repoRoot, ".aidw/runtime/sessions.jsonl");
}

function createSessionId() {
    return `S-${crypto.randomBytes(8).toString("hex")}`;
}

export function appendRuntimeSession(entry, repoRoot) {
    const root = String(repoRoot ?? "").trim();
    if (!root) {
        throw new Error("repoRoot is required");
    }
    ensureRuntimeDir(root);
    const sessionId = createSessionId();
    const payload = {
        sessionId,
        timestamp: new Date().toISOString(),
        mode: entry?.mode ?? "-",
        goal: entry?.goal ?? "",
        taskId: entry?.taskId ?? null,
        repoRoot: root,
        worksetMode: entry?.worksetMode ?? null,
        pauseId: entry?.pauseId ?? null,
        status: entry?.status ?? "-",
    };
    const filePath = getSessionsPath(root);
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    return sessionId;
}

function readTail(filePath, maxBytes) {
    if (!fs.existsSync(filePath)) {
        return "";
    }
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const readBytes = Math.min(size, maxBytes);
    const start = Math.max(0, size - readBytes);
    const fd = fs.openSync(filePath, "r");
    try {
        const buffer = Buffer.alloc(readBytes);
        fs.readSync(fd, buffer, 0, readBytes, start);
        return buffer.toString("utf-8");
    } finally {
        fs.closeSync(fd);
    }
}

export function inspectRuntimeSession(sessionId, repoRoot, maxBytes = 240_000) {
    const root = String(repoRoot ?? "").trim();
    if (!root) {
        throw new Error("repoRoot is required");
    }
    const normalized = String(sessionId ?? "").trim();
    if (!normalized) {
        throw new Error("sessionId is required");
    }
    const filePath = getSessionsPath(root);
    const tail = readTail(filePath, maxBytes);
    const lines = tail.trim().split("\n").filter(Boolean);
    let match = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
            const parsed = JSON.parse(lines[i]);
            if (parsed?.sessionId === normalized) {
                match = parsed;
                break;
            }
        } catch {
        }
    }
    return match;
}

