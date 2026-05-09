import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_SNAPSHOTS = 200;
const DEFAULT_MAX_AGE_DAYS = 90;
const MAX_SCAN_BYTES = 5_000_000;

function getSnapshotsPath(repoRoot) {
    return path.resolve(repoRoot, ".aidw/runtime/snapshots/snapshots.jsonl");
}

function parseIso(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : null;
}

export function applySnapshotRetentionPolicy({
    repoRoot,
    maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
    maxAgeDays = DEFAULT_MAX_AGE_DAYS,
} = {}) {
    const root = String(repoRoot ?? "").trim();
    if (!root) throw new Error("repoRoot is required");
    const filePath = getSnapshotsPath(root);
    if (!fs.existsSync(filePath)) {
        return {
            ok: true,
            exists: false,
            count: 0,
            oldestTimestamp: null,
            warnings: [],
            policy: { maxSnapshots, maxAgeDays },
        };
    }
    const stat = fs.statSync(filePath);
    const tooLarge = stat.size > MAX_SCAN_BYTES;
    if (tooLarge) {
        return {
            ok: true,
            exists: true,
            count: null,
            oldestTimestamp: null,
            warnings: [
                `snapshots_file_too_large: size_bytes=${stat.size}`,
            ],
            policy: { maxSnapshots, maxAgeDays },
        };
    }
    const text = fs.readFileSync(filePath, "utf-8");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let count = 0;
    let oldestTimestamp = null;
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (!parsed || typeof parsed !== "object") continue;
            if (!parsed.snapshotId) continue;
            count += 1;
            const at = parseIso(parsed.timestamp);
            if (at != null) {
                if (oldestTimestamp == null || at < oldestTimestamp) {
                    oldestTimestamp = at;
                }
            }
        } catch {
            continue;
        }
    }
    const warnings = [];
    if (Number.isFinite(Number(maxSnapshots)) && count > Number(maxSnapshots)) {
        warnings.push(`maxSnapshots_exceeded: count=${count} max=${Number(maxSnapshots)}`);
    }
    if (Number.isFinite(Number(maxAgeDays)) && oldestTimestamp != null) {
        const ageMs = Date.now() - oldestTimestamp;
        const maxAgeMs = Number(maxAgeDays) * 24 * 60 * 60_000;
        if (ageMs > maxAgeMs) {
            warnings.push(`maxAgeDays_exceeded: oldest_days=${Math.floor(ageMs / (24 * 60 * 60_000))} max=${Number(maxAgeDays)}`);
        }
    }
    return {
        ok: true,
        exists: true,
        count,
        oldestTimestamp: oldestTimestamp != null ? new Date(oldestTimestamp).toISOString() : null,
        warnings,
        policy: { maxSnapshots, maxAgeDays },
    };
}
