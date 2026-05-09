import { normalizeRuntimeContract } from "./normalize.js";
import { validateRuntimeContract } from "./runtime-schema.js";
import { applySnapshotRetentionPolicy } from "./retention.js";

function formatList(items) {
    if (!items || items.length === 0) return "- None";
    return items.map((item) => `- ${item}`).join("\n");
}

function computeRiskSeveritySummary(risks) {
    const counts = { blocker: 0, warning: 0, info: 0 };
    if (!Array.isArray(risks)) return counts;
    for (const risk of risks) {
        const severity = String(risk?.severity ?? "").trim().toLowerCase();
        if (severity === "blocker") counts.blocker += 1;
        else if (severity === "warning") counts.warning += 1;
        else if (severity === "info") counts.info += 1;
    }
    return counts;
}

function renderHealthSummary({ scanStatus, riskSummary, validation }) {
    const flags = [];
    if (scanStatus === "missing") flags.push("context_missing");
    else if (scanStatus === "stale") flags.push("context_stale");
    if (riskSummary.blocker > 0) flags.push("blockers_present");
    if (!validation.valid) flags.push("invalid_contract");
    return flags.length ? flags.join(", ") : "ok";
}

export function explainRuntimeContract(contract) {
    const normalized = normalizeRuntimeContract(contract);
    const validation = validateRuntimeContract(normalized);
    const riskCount = Array.isArray(normalized.risks) ? normalized.risks.length : 0;
    const riskSummary = computeRiskSeveritySummary(normalized.risks);
    const worksetSize = Array.isArray(normalized.workset?.files) ? normalized.workset.files.length : 0;
    const scanStatus = normalized.scan?.status ?? "-";
    const sessionStatus = normalized.executionState?.status ?? "-";
    const pauseId = normalized.executionState?.pauseId ?? "-";
    const sessionId = normalized.executionState?.sessionId ?? "-";
    const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
    const errors = Array.isArray(validation.errors) ? validation.errors : [];
    const retention = applySnapshotRetentionPolicy({ repoRoot: normalized.repoRoot || process.cwd() });
    const health = renderHealthSummary({ scanStatus, riskSummary, validation });

    return [
        "# Runtime Contract",
        "",
        `- runtimeVersion: ${normalized.runtimeVersion}`,
        normalized.task?.id ? `- taskId: ${normalized.task.id}` : "- taskId: -",
        normalized.task?.title ? `- taskTitle: ${normalized.task.title}` : "- taskTitle: -",
        `- scan: ${scanStatus}`,
        `- workset_files: ${worksetSize}`,
        `- risk_count: ${riskCount}`,
        `- risk_severity: blocker=${riskSummary.blocker}, warning=${riskSummary.warning}, info=${riskSummary.info}`,
        `- health: ${health}`,
        `- sessionId: ${sessionId}`,
        `- pauseId: ${pauseId}`,
        `- status: ${sessionStatus}`,
        "",
        "## Compatibility Notes",
        "",
        warnings.length ? formatList(warnings) : "- None",
        "",
        "## Retention",
        "",
        retention?.exists === false
            ? "- snapshots: none"
            : `- snapshots_count: ${retention?.count ?? "unknown"}`,
        retention?.oldestTimestamp ? `- oldest: ${retention.oldestTimestamp}` : null,
        retention?.warnings?.length ? `- warnings:\n${formatList(retention.warnings)}` : "- warnings: none",
        "",
        "## Validation",
        "",
        `- valid: ${validation.valid ? "true" : "false"}`,
        errors.length ? `- errors:\n${formatList(errors)}` : "- errors: none",
    ].join("\n").trimEnd() + "\n";
}
