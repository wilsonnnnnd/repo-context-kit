import { clampText, groupBySeverity, sortRisksStable } from "./risk-utils.js";
import { stableStringCompare } from "./stable-sort.js";

export function renderRuntimeRiskSummary(risks = [], options = {}) {
    const maxChars = Number.isFinite(Number(options.maxChars)) ? Math.max(200, Number(options.maxChars)) : 1400;
    const maxItems = Number.isFinite(Number(options.maxItems)) ? Math.max(1, Number(options.maxItems)) : 12;
    const perLine = Number.isFinite(Number(options.maxLineChars)) ? Math.max(60, Number(options.maxLineChars)) : 180;
    const normalized = Array.isArray(risks) ? sortRisksStable(risks, { secondaryKey: "id" }) : [];
    const groups = groupBySeverity(normalized);
    const lines = ["## Runtime Risks", ""];
    let remaining = maxItems;
    for (const severity of ["blocker", "warning", "info"]) {
        for (const risk of groups[severity]) {
            if (remaining <= 0) break;
            const msg = clampText(String(risk.message ?? risk.id ?? "").trim(), perLine);
            lines.push(`- [${severity}] ${msg}`);
            remaining -= 1;
        }
        if (remaining <= 0) break;
    }
    const omitted = normalized.length - (maxItems - remaining);
    if (omitted > 0) {
        lines.push(`- … (+${omitted} more)`);
    }
    const text = `${lines.join("\n")}\n`;
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 2))}…\n`;
}

export function renderRuntimeRisksDetailed(risks = [], options = {}) {
    const maxChars = Number.isFinite(Number(options.maxChars)) ? Math.max(400, Number(options.maxChars)) : 3200;
    const maxItems = Number.isFinite(Number(options.maxItems)) ? Math.max(1, Number(options.maxItems)) : 10;
    const perLine = Number.isFinite(Number(options.maxLineChars)) ? Math.max(80, Number(options.maxLineChars)) : 200;
    const normalized = Array.isArray(risks) ? sortRisksStable(risks, { secondaryKey: "id" }) : [];
    const groups = groupBySeverity(normalized);
    const lines = ["## Runtime Risks", ""];
    let remaining = maxItems;
    for (const severity of ["blocker", "warning", "info"]) {
        for (const risk of groups[severity]) {
            if (remaining <= 0) break;
            const msg = clampText(String(risk.message ?? risk.id ?? "").trim(), perLine);
            const suggested = String(risk.suggestedAction ?? "").trim();
            const evidence = risk?.evidence && typeof risk.evidence === "object" ? risk.evidence : {};
            const evidenceKeys = Object.keys(evidence).map((k) => String(k)).sort(stableStringCompare);
            const evidencePairs = evidenceKeys.slice(0, 6).map((key) => `${key}=${String(evidence[key])}`);
            lines.push(`- [${severity}] ${msg}${risk.id ? ` (${risk.id})` : ""}`);
            if (evidencePairs.length > 0) {
                lines.push(`  evidence: ${clampText(evidencePairs.join(", "), perLine)}`);
            }
            if (suggested) {
                lines.push(`  suggested: ${clampText(suggested, perLine)}`);
            }
            remaining -= 1;
        }
        if (remaining <= 0) break;
    }
    const omitted = normalized.length - (maxItems - remaining);
    if (omitted > 0) {
        lines.push(`- … (+${omitted} more)`);
    }
    const text = `${lines.join("\n")}\n`;
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 2))}…\n`;
}
