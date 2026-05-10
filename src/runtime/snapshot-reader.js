import fs from "node:fs";
import path from "node:path";
import { normalizeRuntimeContract } from "./normalize.js";
import { validateRuntimeContract } from "./runtime-schema.js";
import { stableStringCompare } from "./stable-sort.js";

const DEFAULT_MAX_BYTES = 2_000_000;

function getSnapshotsPath(repoRoot) {
    return path.resolve(repoRoot, ".aidw/runtime/snapshots/snapshots.jsonl");
}

function clampText(value, maxChars) {
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

function parseLinesToSnapshots(tail, limit) {
    const lines = String(tail ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const snapshots = [];
    for (let i = lines.length - 1; i >= 0 && snapshots.length < limit; i -= 1) {
        try {
            const parsed = JSON.parse(lines[i]);
            if (!parsed || typeof parsed !== "object") continue;
            if (!parsed.snapshotId) continue;
            snapshots.push(parsed);
        } catch {
            continue;
        }
    }
    return snapshots;
}

function computeRiskCounts(risks) {
    const counts = { riskCount: 0, blockerCount: 0, warningCount: 0 };
    if (!Array.isArray(risks)) return counts;
    counts.riskCount = risks.length;
    for (const risk of risks) {
        const severity = String(risk?.severity ?? "").trim().toLowerCase();
        if (severity === "blocker") counts.blockerCount += 1;
        else if (severity === "warning") counts.warningCount += 1;
    }
    return counts;
}

function normalizeSnapshotRecord(raw) {
    const snapshotId = String(raw?.snapshotId ?? "").trim();
    if (!snapshotId) return null;
    const runtimeVersion = String(raw?.runtimeVersion ?? "").trim() || "-";
    const timestamp = String(raw?.timestamp ?? "").trim() || "-";
    const mode = String(raw?.mode ?? "").trim() || "-";
    const contract = normalizeRuntimeContract(raw?.contract);
    const validation = validateRuntimeContract(contract);
    const taskId = String(raw?.taskId ?? contract.task?.id ?? "").trim() || null;
    const goal = clampText(String(raw?.goal ?? contract.task?.goal ?? "").trim(), 140) || null;
    const status = String(raw?.status ?? contract.executionState?.status ?? "").trim() || null;
    const riskCounts = computeRiskCounts(contract.risks);
    return {
        snapshotId,
        runtimeVersion: runtimeVersion === "-" ? contract.runtimeVersion : runtimeVersion,
        timestamp,
        mode,
        goal,
        taskId,
        status,
        riskCount: Number(raw?.riskCount ?? riskCounts.riskCount),
        blockerCount: Number(raw?.blockerCount ?? riskCounts.blockerCount),
        warningCount: Number(raw?.warningCount ?? riskCounts.warningCount),
        contract,
        validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
    };
}

function applyBoundsToSnapshot(snapshot) {
    const contract = snapshot.contract;
    const bounded = normalizeRuntimeContract({
        ...contract,
        prompt: clampText(contract.prompt, 6000),
        workset: {
            ...contract.workset,
            text: clampText(contract.workset?.text ?? "", 24_000),
        },
    });
    return {
        ...snapshot,
        goal: snapshot.goal ? clampText(snapshot.goal, 140) : null,
        contract: bounded,
    };
}

export function listSnapshots({ repoRoot, limit = 20, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const root = String(repoRoot ?? "").trim();
    if (!root) throw new Error("repoRoot is required");
    const max = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Math.floor(Number(limit)))) : 20;
    const bytes = Number.isFinite(Number(maxBytes)) ? Math.max(10_000, Math.min(DEFAULT_MAX_BYTES, Math.floor(Number(maxBytes)))) : DEFAULT_MAX_BYTES;
    const filePath = getSnapshotsPath(root);
    const tail = readTail(filePath, bytes);
    const rawSnapshots = parseLinesToSnapshots(tail, max);
    const normalized = rawSnapshots
        .map((s) => normalizeSnapshotRecord(s))
        .filter(Boolean)
        .map(applyBoundsToSnapshot);
    return normalized.sort((a, b) => {
        const at = String(a.timestamp ?? "");
        const bt = String(b.timestamp ?? "");
        if (at !== bt) return stableStringCompare(bt, at);
        return stableStringCompare(String(b.snapshotId), String(a.snapshotId));
    });
}

export function readSnapshot({ repoRoot, snapshotId, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const root = String(repoRoot ?? "").trim();
    if (!root) throw new Error("repoRoot is required");
    const id = String(snapshotId ?? "").trim();
    if (!id) throw new Error("snapshotId is required");
    const filePath = getSnapshotsPath(root);
    const tail = readTail(filePath, maxBytes);
    const lines = String(tail ?? "").trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
            const parsed = JSON.parse(lines[i]);
            if (parsed?.snapshotId !== id) continue;
            const normalized = normalizeSnapshotRecord(parsed);
            return normalized ? applyBoundsToSnapshot(normalized) : null;
        } catch {
            continue;
        }
    }
    return null;
}

function diffStrings(a, b) {
    const left = Array.isArray(a) ? a.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    const right = Array.isArray(b) ? b.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const added = right.filter((x) => !leftSet.has(x)).sort(stableStringCompare);
    const removed = left.filter((x) => !rightSet.has(x)).sort(stableStringCompare);
    return { added, removed };
}

export function diffSnapshots({ repoRoot, from, to } = {}) {
    const left = readSnapshot({ repoRoot, snapshotId: from });
    const right = readSnapshot({ repoRoot, snapshotId: to });
    if (!left || !right) {
        return { ok: false, error: "Snapshot not found.", from, to };
    }
    const a = left.contract;
    const b = right.contract;
    const risksA = computeRiskCounts(a.risks);
    const risksB = computeRiskCounts(b.risks);
    const diff = {
        ok: true,
        from: left.snapshotId,
        to: right.snapshotId,
        changes: {
            runtimeVersion: { from: a.runtimeVersion, to: b.runtimeVersion },
            scanStatus: { from: a.scan?.status ?? "-", to: b.scan?.status ?? "-" },
            riskCount: { from: risksA.riskCount, to: risksB.riskCount },
            blockerCount: { from: risksA.blockerCount, to: risksB.blockerCount },
            warningCount: { from: risksA.warningCount, to: risksB.warningCount },
            worksetSize: { from: Array.isArray(a.workset?.files) ? a.workset.files.length : 0, to: Array.isArray(b.workset?.files) ? b.workset.files.length : 0 },
            nextActions: diffStrings(a.nextActions, b.nextActions),
            task: {
                id: { from: a.task?.id ?? null, to: b.task?.id ?? null },
                title: { from: a.task?.title ?? null, to: b.task?.title ?? null },
                goal: { from: clampText(a.task?.goal ?? "", 140) || null, to: clampText(b.task?.goal ?? "", 140) || null },
            },
        },
    };
    return diff;
}
