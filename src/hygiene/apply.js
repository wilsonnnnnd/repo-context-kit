import fs from "node:fs";
import path from "node:path";
import { withRepoRoot } from "../runtime/root-context.js";
import { buildRuntimeContract } from "../runtime/runtime-contract.js";
import { writeRuntimeSnapshot } from "../runtime/snapshot.js";
import { serializeJson } from "../runtime/serialize.js";
import { appendLoopEvent } from "../loop/store.js";
import { computeScanCheckState } from "../scan/index.js";
import { resolveRuntimeMode, getRuntimeModeConfig } from "../runtime/rdl/modes.js";
import { readFilesNeverTouchList } from "../runtime/rdl/shc.js";
import { HYGIENE_LIMITS, HYGIENE_PATHS, HYGIENE_VERSION } from "./constants.js";
import { ensureDirForFile, isPlainObject, normalizeRepoRelativePath, sha256Hex, uniqSorted } from "./utils.js";
import { pickPlanObject, readJsonPayload } from "../runtime/json-payload.js";

function normalizeRelPath(value) {
    return normalizeRepoRelativePath(value);
}

function assertRuntimeManagedPath(rel) {
    const p = normalizeRelPath(rel);
    if (!p) throw new Error(`invalid path: ${rel}`);
    if (!(p.startsWith(".aidw/") || p.startsWith("task/"))) {
        throw new Error(`refusing to manage non-runtime path: ${p}`);
    }
    return p;
}

function assertDestAllowed(rel) {
    const p = assertRuntimeManagedPath(rel);
    if (!(p.startsWith(HYGIENE_PATHS.archiveTasksDir) || p.startsWith(HYGIENE_PATHS.archiveSnapshotsDir) || p.startsWith(HYGIENE_PATHS.quarantineDir))) {
        throw new Error(`refusing to write outside hygiene destinations: ${p}`);
    }
    return p;
}

function matchesNeverTouch(rel, neverTouch) {
    const p = normalizeRelPath(rel);
    if (!p) return false;
    const rules = Array.isArray(neverTouch) ? neverTouch : [];
    for (const rule of rules) {
        const r = String(rule ?? "").trim().replaceAll("\\", "/");
        if (!r) continue;
        if (p === r) return true;
        if (r.endsWith("/") && p.startsWith(r)) return true;
        if (!r.endsWith("/") && p.startsWith(`${r}/`)) return true;
    }
    return false;
}

function moveFile({ repoRoot, from, to }) {
    const srcRel = assertRuntimeManagedPath(from);
    const dstRel = assertDestAllowed(to);
    const src = path.resolve(repoRoot, srcRel);
    const dst = path.resolve(repoRoot, dstRel);
    if (!fs.existsSync(src)) {
        return { ok: false, from: srcRel, to: dstRel, error: "missing" };
    }
    ensureDirForFile(dst);
    fs.renameSync(src, dst);
    return { ok: true, from: srcRel, to: dstRel };
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

function takeLastLines(text, count) {
    const lines = String(text ?? "").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= count) return lines;
    return lines.slice(lines.length - count);
}

function rotateSnapshots({ repoRoot, from, archiveDir, retainLines, maxBytes }) {
    const srcRel = assertRuntimeManagedPath(from);
    const src = path.resolve(repoRoot, srcRel);
    if (!fs.existsSync(src)) {
        return { ok: false, error: "snapshots file missing", from: srcRel };
    }
    const stat = fs.statSync(src);
    if (stat.size > maxBytes) {
        const error = new Error(`snapshots file too large for bounded rotation (${stat.size} bytes > ${maxBytes})`);
        error.code = "TOO_LARGE";
        throw error;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveRel = `${archiveDir}/snapshots.${timestamp}.jsonl`;
    const archivePath = path.resolve(repoRoot, archiveRel);
    ensureDirForFile(archivePath);
    fs.copyFileSync(src, archivePath);

    const tail = readTail(src, maxBytes);
    const retained = takeLastLines(tail, retainLines);
    fs.writeFileSync(src, `${retained.join("\n")}\n`, "utf-8");

    return {
        ok: true,
        action: "rotate",
        from: srcRel,
        archivedTo: archiveRel,
        retainedLines: retained.length,
        previousBytes: stat.size,
    };
}

function detachRegistryEntries({ repoRoot, items }) {
    const registryPath = path.resolve(repoRoot, HYGIENE_PATHS.taskRegistryFile);
    if (!fs.existsSync(registryPath)) {
        return { ok: false, error: "task registry missing" };
    }
    const raw = fs.readFileSync(registryPath, "utf-8").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    const toDetach = new Set(items.map((x) => String(x?.taskId ?? "").trim().toUpperCase()).filter(Boolean));
    if (toDetach.size === 0) return { ok: true, removed: 0 };
    let removed = 0;
    const next = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|")) return true;
        const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const id = String(cells[0] ?? "").trim().toUpperCase();
        if (toDetach.has(id)) {
            removed += 1;
            return false;
        }
        return true;
    });
    fs.writeFileSync(registryPath, `${next.join("\n").trimEnd()}\n`, "utf-8");
    return { ok: true, removed };
}

export function readHygienePlanPayload(source) {
    return readJsonPayload(source, { missingPathError: "plan path is required" });
}

export function getHygienePlanFromPayload(payload) {
    const plan = pickPlanObject(payload);
    if (String(plan.hygieneVersion ?? "") !== HYGIENE_VERSION) {
        throw new Error("unsupported hygiene plan version");
    }
    if (typeof plan.digest !== "string" || !plan.digest) throw new Error("plan.digest is required");
    if (typeof plan.pauseToken !== "string" || plan.pauseToken.length !== 32) throw new Error("plan.pauseToken is required");
    const expected = sha256Hex(`${HYGIENE_VERSION}:${plan.digest}`).slice(0, 32);
    if (expected !== plan.pauseToken) {
        throw new Error("plan pauseToken does not match digest");
    }
    return plan;
}

export function applyHygienePlan({ repoRoot, planSource, enableWrite = false, confirm = null, runtimeMode } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    if (!enableWrite) {
        const error = new Error("Write mode is disabled. Re-run with --enable-write.");
        error.code = "WRITE_DISABLED";
        throw error;
    }

    const mode = resolveRuntimeMode({ repoRoot: root, requestedMode: runtimeMode });
    const modeConfig = getRuntimeModeConfig(mode);
    if (mode === "REVIEW" || modeConfig?.writePolicy === "read_only") {
        const error = new Error("Hygiene apply is not allowed in REVIEW mode.");
        error.code = "MODE_READ_ONLY";
        throw error;
    }

    const payload = readHygienePlanPayload(planSource);
    const plan = getHygienePlanFromPayload(payload?.plan ?? payload);
    const token = String(confirm ?? "").trim();
    if (!token || token !== plan.pauseToken) {
        const error = new Error("Confirmation token does not match the plan pauseToken.");
        error.code = "CONFIRM_MISMATCH";
        throw error;
    }

    const neverTouch = readFilesNeverTouchList({ repoRoot: root });
    const plannedMoves = [
        ...(Array.isArray(plan.archiveTasks) ? plan.archiveTasks.flatMap((x) => [x.from, x.to]) : []),
        ...(Array.isArray(plan.quarantineArtifacts) ? plan.quarantineArtifacts.flatMap((x) => [x.from, x.to]) : []),
        ...(Array.isArray(plan.archiveSnapshots) ? plan.archiveSnapshots.flatMap((x) => [x.from, x.to]) : []),
    ].filter(Boolean);
    const neverTouchHits = plannedMoves.filter((p) => matchesNeverTouch(p, neverTouch));
    if (neverTouchHits.length > 0) {
        const error = new Error("Hygiene plan touches Files Never Touch paths.");
        error.code = "FILES_NEVER_TOUCH";
        error.details = { hits: neverTouchHits.slice(0, 16) };
        throw error;
    }

    if (mode === "SAFE" && Array.isArray(plan.detachInvalidReferences) && plan.detachInvalidReferences.length > 0) {
        const error = new Error("SAFE mode only allows archive/quarantine actions. Detaching registry entries is blocked.");
        error.code = "SAFE_BLOCKER";
        throw error;
    }

    const scan = withRepoRoot(root, () => {
        const required = [
            path.resolve(root, ".aidw/AI_project.md"),
            path.resolve(root, ".aidw/system-overview.md"),
            path.resolve(root, ".aidw/index/summary.json"),
        ];
        if (required.some((p) => !fs.existsSync(p))) return { status: "missing", plan: [] };
        const { update } = computeScanCheckState();
        return { status: update?.changed ? "stale" : "fresh", plan: [] };
    });

    const contract = buildRuntimeContract({
        repoRoot: root,
        task: { id: "HYGIENE", title: "Runtime Hygiene Apply", goal: "Archive/quarantine runtime-managed artifacts", requirements: [], acceptanceCriteria: [], testCommand: "", definitionOfDone: [] },
        scan,
        workset: { mode: "digest", files: [], summary: "", text: "" },
        prompt: "",
        runtime: { writeEnabled: true, mode, modeConfig, hygiene: { planDigest: plan.digest } },
        rdl: { mode },
        nextActions: [],
        executionState: { sessionId: null, pauseId: null, phase: "hygiene_apply", status: "applied" },
    });

    let snapshotId = null;
    snapshotId = writeRuntimeSnapshot(contract, { repoRoot: root, mode: "hygiene.apply" });

    const operations = [];
    for (const item of Array.isArray(plan.archiveTasks) ? plan.archiveTasks : []) {
        operations.push(moveFile({ repoRoot: root, from: item.from, to: item.to }));
    }
    for (const item of Array.isArray(plan.quarantineArtifacts) ? plan.quarantineArtifacts : []) {
        operations.push(moveFile({ repoRoot: root, from: item.from, to: item.to }));
    }
    for (const item of Array.isArray(plan.archiveSnapshots) ? plan.archiveSnapshots : []) {
        if (item.action === "rotate") {
            const result = rotateSnapshots({
                repoRoot: root,
                from: item.from,
                archiveDir: HYGIENE_PATHS.archiveSnapshotsDir,
                retainLines: Number(item.retainLines ?? HYGIENE_LIMITS.snapshotRetainLines),
                maxBytes: Number(item.maxBytes ?? HYGIENE_LIMITS.snapshotRotateMaxBytes),
            });
            operations.push(result);
        }
    }

    let detachResult = null;
    if (Array.isArray(plan.detachInvalidReferences) && plan.detachInvalidReferences.length > 0) {
        detachResult = detachRegistryEntries({ repoRoot: root, items: plan.detachInvalidReferences });
    }

    const summary = {
        ok: true,
        mode,
        snapshotId,
        moved: operations.filter((o) => o && o.ok === true).length,
        moveErrors: operations.filter((o) => o && o.ok === false).length,
        detachedRegistryEntries: detachResult?.removed ?? 0,
    };

    appendLoopEvent({
        type: "execution_evidence",
        tool: "hygiene.apply",
        mode,
        taskId: null,
        ok: true,
        summaryOfChange: "Applied hygiene plan (archive/quarantine only; no permanent delete).",
        filesModified: uniqSorted([
            ...operations.filter((o) => o?.ok === true && o.from).map((o) => o.from),
            ...(detachResult?.removed ? [HYGIENE_PATHS.taskRegistryFile] : []),
            snapshotId ? HYGIENE_PATHS.snapshotsFile : null,
        ]),
        keyReasoning: "Reduce runtime-managed clutter while preserving an audit trail and bounded safety constraints.",
        verification: "manual_review",
        risks: [],
        nextActions: ["Review .aidw/archive/ and .aidw/quarantine/ contents; run scan if task registry changed."],
        meta: { hygieneVersion: HYGIENE_VERSION, planDigest: plan.digest, snapshotId },
    }, root);

    return {
        ok: true,
        repoRoot: root,
        snapshotId,
        summary,
        operations,
        detachResult,
        output: serializeJson({ ok: true, summary }, { indent: 4 }),
    };
}
