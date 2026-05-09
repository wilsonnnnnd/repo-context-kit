function clampLine(value, maxChars) {
    const text = String(value ?? "");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function severityWeight(severity) {
    if (severity === "blocker") return 3;
    if (severity === "warning") return 2;
    return 1;
}

function stableSortRisks(risks) {
    return risks.slice().sort((a, b) => {
        const sev = severityWeight(b.severity) - severityWeight(a.severity);
        if (sev !== 0) return sev;
        const id = String(a.id ?? "").localeCompare(String(b.id ?? ""));
        if (id !== 0) return id;
        const source = String(a.source ?? "").localeCompare(String(b.source ?? ""));
        if (source !== 0) return source;
        return String(a.message ?? "").localeCompare(String(b.message ?? ""));
    });
}

function groupBySeverity(risks) {
    const groups = { blocker: [], warning: [], info: [] };
    for (const risk of risks) {
        const sev = String(risk?.severity ?? "").trim().toLowerCase();
        if (sev === "blocker" || sev === "warning" || sev === "info") {
            groups[sev].push(risk);
        }
    }
    return groups;
}

export function renderRuntimeRiskSummary(risks = [], options = {}) {
    const maxChars = Number.isFinite(Number(options.maxChars)) ? Math.max(200, Number(options.maxChars)) : 1400;
    const maxItems = Number.isFinite(Number(options.maxItems)) ? Math.max(1, Number(options.maxItems)) : 12;
    const perLine = Number.isFinite(Number(options.maxLineChars)) ? Math.max(60, Number(options.maxLineChars)) : 180;
    const normalized = Array.isArray(risks) ? stableSortRisks(risks) : [];
    const groups = groupBySeverity(normalized);
    const lines = ["## Runtime Risks", ""];
    let remaining = maxItems;
    for (const severity of ["blocker", "warning", "info"]) {
        for (const risk of groups[severity]) {
            if (remaining <= 0) break;
            const msg = clampLine(String(risk.message ?? risk.id ?? "").trim(), perLine);
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
    const normalized = Array.isArray(risks) ? stableSortRisks(risks) : [];
    const groups = groupBySeverity(normalized);
    const lines = ["## Runtime Risks", ""];
    let remaining = maxItems;
    for (const severity of ["blocker", "warning", "info"]) {
        for (const risk of groups[severity]) {
            if (remaining <= 0) break;
            const msg = clampLine(String(risk.message ?? risk.id ?? "").trim(), perLine);
            const suggested = String(risk.suggestedAction ?? "").trim();
            const evidence = risk?.evidence && typeof risk.evidence === "object" ? risk.evidence : {};
            const evidenceKeys = Object.keys(evidence).map((k) => String(k)).sort((a, b) => a.localeCompare(b));
            const evidencePairs = evidenceKeys.slice(0, 6).map((key) => `${key}=${String(evidence[key])}`);
            lines.push(`- [${severity}] ${msg}${risk.id ? ` (${risk.id})` : ""}`);
            if (evidencePairs.length > 0) {
                lines.push(`  evidence: ${clampLine(evidencePairs.join(", "), perLine)}`);
            }
            if (suggested) {
                lines.push(`  suggested: ${clampLine(suggested, perLine)}`);
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

