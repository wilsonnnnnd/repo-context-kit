import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeRuntimeContract } from "./normalize.js";
import { validateRuntimeContract } from "./runtime-schema.js";
import { serializeJson } from "./serialize.js";

function ensureSnapshotsDir(repoRoot) {
    fs.mkdirSync(path.resolve(repoRoot, ".aidw/runtime/snapshots"), { recursive: true });
}

function getSnapshotsPath(repoRoot) {
    return path.resolve(repoRoot, ".aidw/runtime/snapshots/snapshots.jsonl");
}

function createSnapshotId() {
    return `SN-${crypto.randomBytes(8).toString("hex")}`;
}

function truncateText(value, maxChars) {
    const text = String(value ?? "");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function readTail(filePath, maxBytes) {
    if (!fs.existsSync(filePath)) return "";
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

function computeRiskCounts(risks) {
    const counts = { riskCount: 0, blockerCount: 0, warningCount: 0 };
    if (!Array.isArray(risks)) {
        return counts;
    }
    counts.riskCount = risks.length;
    for (const risk of risks) {
        const severity = String(risk?.severity ?? "").trim().toLowerCase();
        if (severity === "blocker") counts.blockerCount += 1;
        else if (severity === "warning") counts.warningCount += 1;
    }
    return counts;
}

export function writeRuntimeSnapshot(contract, { repoRoot, mode = "-" } = {}) {
    const root = String(repoRoot ?? "").trim();
    if (!root) throw new Error("repoRoot is required");
    ensureSnapshotsDir(root);

    const normalized = normalizeRuntimeContract(contract);
    const validation = validateRuntimeContract(normalized);
    if (!validation.valid) {
        throw new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
    }

    const snapshotId = createSnapshotId();
    const goal = truncateText(String(normalized.task?.goal ?? "").trim(), 140);
    const taskId = normalized.task?.id ? String(normalized.task.id).trim() : null;
    const status = normalized.executionState?.status ? String(normalized.executionState.status).trim() : null;
    const counts = computeRiskCounts(normalized.risks);
    const payload = {
        snapshotId,
        runtimeVersion: normalized.runtimeVersion,
        timestamp: new Date().toISOString(),
        mode: String(mode ?? "-"),
        goal: goal || null,
        taskId,
        status,
        riskCount: counts.riskCount,
        blockerCount: counts.blockerCount,
        warningCount: counts.warningCount,
        contract: {
            ...normalized,
            prompt: truncateText(normalized.prompt, 6000),
            workset: {
                ...normalized.workset,
                text: truncateText(normalized.workset?.text ?? "", 24_000),
            },
        },
    };

    const filePath = getSnapshotsPath(root);
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
    return snapshotId;
}

export function readRuntimeSnapshot(snapshotId, { repoRoot, maxBytes = 240_000 } = {}) {
    const root = String(repoRoot ?? "").trim();
    if (!root) throw new Error("repoRoot is required");
    const id = String(snapshotId ?? "").trim();
    if (!id) throw new Error("snapshotId is required");

    const filePath = getSnapshotsPath(root);
    const tail = readTail(filePath, maxBytes);
    const lines = tail.trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
            const parsed = JSON.parse(lines[i]);
            if (parsed?.snapshotId === id) {
                return parsed;
            }
        } catch {
        }
    }
    return null;
}

export function serializeRuntimeSnapshot(snapshot) {
    return serializeJson(snapshot, { indent: 4 });
}
