import { stableStringCompare } from "./stable-sort.js";

function normalizeSeverity(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (raw === "blocker" || raw === "warning" || raw === "info") return raw;
    return "info";
}

export function severityWeight(severity) {
    const s = normalizeSeverity(severity);
    if (s === "blocker") return 3;
    if (s === "warning") return 2;
    return 1;
}

export function clampText(value, maxChars) {
    const text = String(value ?? "");
    const limit = Number.isFinite(Number(maxChars)) ? Number(maxChars) : 0;
    if (limit <= 0) return "";
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function groupBySeverity(risks) {
    const list = Array.isArray(risks) ? risks : [];
    const out = { blocker: [], warning: [], info: [] };
    for (const risk of list) {
        const severity = normalizeSeverity(risk?.severity);
        out[severity].push(risk);
    }
    return out;
}

export function computeRiskSeveritySummary(risks) {
    const grouped = groupBySeverity(risks);
    return {
        blocker: grouped.blocker.length,
        warning: grouped.warning.length,
        info: grouped.info.length,
    };
}

export function sortRisksStable(risks, { secondaryKey = "id" } = {}) {
    const list = Array.isArray(risks) ? risks.slice() : [];
    const key = String(secondaryKey ?? "id").trim() || "id";
    return list.sort((a, b) => {
        const sa = severityWeight(a?.severity);
        const sb = severityWeight(b?.severity);
        if (sb !== sa) return sb - sa;
        const ka = String(a?.[key] ?? "").trim();
        const kb = String(b?.[key] ?? "").trim();
        if (ka !== kb) return stableStringCompare(ka, kb);
        const ma = String(a?.message ?? "").trim();
        const mb = String(b?.message ?? "").trim();
        return stableStringCompare(ma, mb);
    });
}
