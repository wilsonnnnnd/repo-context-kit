import fs from "node:fs";
import path from "node:path";
import { serializeJson } from "../runtime/serialize.js";
import { readSnapshot } from "../runtime/snapshot-reader.js";
import { readBootstrapPlanPayload, getBootstrapPlanFromPayload } from "./plan-io.js";
import { resolveWithinRepoRoot, normalizeRepoRelativePath } from "./paths.js";

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function buildRisk({ id, severity, category, message, evidence, suggestedAction }) {
    return {
        id,
        severity,
        source: "runtime",
        category,
        message,
        evidence: isPlainObject(evidence) ? evidence : {},
        suggestedAction: String(suggestedAction ?? "").trim(),
    };
}

function statKind(fullPath) {
    try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) return "dir";
        if (stat.isFile()) return "file";
        return "other";
    } catch {
        return "missing";
    }
}

function safeRel(pathValue) {
    try {
        return normalizeRepoRelativePath(pathValue);
    } catch {
        return String(pathValue ?? "").trim();
    }
}

function diffAgainstDisk({ repoRoot, plan }) {
    const ops = Array.isArray(plan?.ops) ? plan.ops : [];
    const items = [];
    const risks = [];
    let preconditionFailed = false;

    for (const op of ops) {
        const opType = String(op?.op ?? "").trim();
        const rel = safeRel(op?.path);
        let resolved;
        try {
            resolved = resolveWithinRepoRoot(repoRoot, rel);
        } catch {
            risks.push(
                buildRisk({
                    id: "bootstrap-path-conflict",
                    severity: "blocker",
                    category: "safety",
                    message: "Planned path is invalid or escapes repoRoot.",
                    evidence: { path: rel },
                    suggestedAction: "Regenerate the plan with safe, repo-relative paths only.",
                }),
            );
            preconditionFailed = true;
            continue;
        }
        const kind = statKind(resolved.fullPath);
        const pre = isPlainObject(op?.preconditions) ? op.preconditions : {};
        const mustNotExist = Boolean(pre.mustNotExist);
        const mustExist = Boolean(pre.mustExist);
        const exists = kind !== "missing";
        const preconditionOk = (!mustNotExist || !exists) && (!mustExist || exists);
        if (!preconditionOk) {
            preconditionFailed = true;
            risks.push(
                buildRisk({
                    id: "bootstrap-precondition-failed",
                    severity: "blocker",
                    category: "safety",
                    message: "One or more plan preconditions are no longer satisfied.",
                    evidence: { op: opType, path: rel, kind, preconditions: pre },
                    suggestedAction: "Re-plan or remove conflicting files before applying.",
                }),
            );
        }
        if (opType === "mkdir") {
            items.push({
                op: opType,
                path: rel,
                disk: kind,
                expected: "dir",
                status: kind === "dir" ? "ok" : kind === "missing" ? "missing" : "conflict",
                preconditionOk,
            });
        } else {
            items.push({
                op: opType,
                path: rel,
                disk: kind,
                expected: "file",
                status: exists ? (kind === "file" ? "exists" : "conflict") : "missing",
                preconditionOk,
            });
        }
    }

    const conflicts = items.filter((x) => x.status === "conflict");
    if (conflicts.length > 0) {
        risks.push(
            buildRisk({
                id: "bootstrap-path-conflict",
                severity: "warning",
                category: "safety",
                message: "Some planned paths conflict with existing disk entries.",
                evidence: { conflicts: conflicts.slice(0, 12).map((c) => ({ path: c.path, disk: c.disk, expected: c.expected })) },
                suggestedAction: "Resolve conflicting paths before applying or re-plan.",
            }),
        );
    }
    if (items.some((x) => x.status === "missing")) {
        risks.push(
            buildRisk({
                id: "bootstrap-plan-drift",
                severity: "info",
                category: "stability",
                message: "Some planned paths are currently missing (expected before apply).",
                evidence: { missingCount: items.filter((x) => x.status === "missing").length },
                suggestedAction: "Apply will create missing paths if preconditions allow.",
            }),
        );
    }

    return { items, risks, safeToApply: !preconditionFailed };
}

function diffAgainstSnapshot({ repoRoot, plan, snapshotId }) {
    const snap = readSnapshot({ repoRoot, snapshotId });
    if (!snap) {
        return {
            ok: false,
            error: `Snapshot not found: ${snapshotId}`,
            risks: [
                buildRisk({
                    id: "bootstrap-snapshot-mismatch",
                    severity: "warning",
                    category: "context",
                    message: "Snapshot was not found for comparison.",
                    evidence: { snapshotId },
                    suggestedAction: "Verify snapshotId or list snapshots.",
                }),
            ],
        };
    }
    const snapDigest = String(snap?.contract?.bootstrap?.scaffoldPlan?.digest ?? "").trim() || null;
    const planDigest = String(plan?.digest ?? "").trim() || null;
    const match = Boolean(snapDigest && planDigest && snapDigest === planDigest);
    const risks = [];
    if (!match) {
        risks.push(
            buildRisk({
                id: "bootstrap-snapshot-mismatch",
                severity: "warning",
                category: "stability",
                message: "Snapshot bootstrap digest does not match the current plan digest.",
                evidence: { snapshotId, snapshotDigest: snapDigest, planDigest },
                suggestedAction: "Ensure you are diffing the correct plan against the correct snapshot.",
            }),
        );
    }
    return {
        ok: true,
        snapshot: { snapshotId: snap.snapshotId, timestamp: snap.timestamp, mode: snap.mode },
        digestMatch: match,
        risks,
    };
}

export function diffBootstrapPlan({ repoRoot, planSource, against = "disk" } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    const payload = readBootstrapPlanPayload(planSource);
    const plan = getBootstrapPlanFromPayload(payload);

    if (against === "disk") {
        const disk = diffAgainstDisk({ repoRoot: root, plan });
        const output = {
            ok: true,
            against: "disk",
            digest: plan.digest ?? null,
            pauseToken: plan.pauseToken ?? null,
            safeToApply: disk.safeToApply,
            items: disk.items,
            risks: disk.risks,
        };
        const lines = [
            "Bootstrap Plan Diff",
            "",
            `- against: disk`,
            `- safeToApply: ${disk.safeToApply}`,
            "",
            "Preconditions:",
            ...disk.items.slice(0, 120).map((i) => `- ${i.op} ${i.path} disk=${i.disk} status=${i.status} preconditionOk=${i.preconditionOk}`),
            disk.items.length > 120 ? `- … (${disk.items.length - 120} more)` : null,
            "",
            "Risks:",
            ...(disk.risks.length ? disk.risks.map((r) => `- ${String(r.severity).toLowerCase()}: ${r.id} ${r.message}`) : ["- (none)"]),
            "",
            "Safety boundary:",
            "- diff is read-only (no writes).",
        ].filter(Boolean);
        return { ...output, text: lines.join("\n").trimEnd(), json: serializeJson(output) };
    }

    if (typeof against === "string" && against.startsWith("snapshot:")) {
        const snapshotId = against.slice("snapshot:".length).trim();
        const snap = diffAgainstSnapshot({ repoRoot: root, plan, snapshotId });
        const output = {
            ok: snap.ok,
            against: `snapshot:${snapshotId}`,
            digest: plan.digest ?? null,
            snapshot: snap.snapshot ?? null,
            digestMatch: snap.digestMatch ?? null,
            risks: snap.risks ?? [],
            error: snap.ok ? null : snap.error,
        };
        const lines = [
            "Bootstrap Plan Diff",
            "",
            `- against: snapshot:${snapshotId}`,
            `- digestMatch: ${output.digestMatch === null ? "-" : String(output.digestMatch)}`,
            "",
            "Risks:",
            ...(output.risks.length ? output.risks.map((r) => `- ${String(r.severity).toLowerCase()}: ${r.id} ${r.message}`) : ["- (none)"]),
            output.error ? `\nERROR ${output.error}` : null,
        ].filter(Boolean);
        return { ...output, text: lines.join("\n").trimEnd(), json: serializeJson(output) };
    }

    throw new Error("against must be 'disk' or 'snapshot:<id>'");
}

