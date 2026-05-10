import { CURRENT_RUNTIME_VERSION } from "./runtime-version.js";
import { normalizeRuntimeRisks } from "./risks.js";
import { stablePathCompare, stableStringCompare } from "./stable-sort.js";

function asString(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text ? text : fallback;
}

function asArrayOfStrings(value) {
    if (!Array.isArray(value)) return [];
    return value.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function normalizeTask(task) {
    if (!task || typeof task !== "object") return null;
    return {
        id: asString(task.id, "-"),
        title: asString(task.title, "-"),
        goal: asString(task.goal, ""),
        requirements: asArrayOfStrings(task.requirements),
        acceptanceCriteria: asArrayOfStrings(task.acceptanceCriteria),
        testCommand: asString(task.testCommand, ""),
        definitionOfDone: asArrayOfStrings(task.definitionOfDone),
    };
}

function normalizeScan(scan) {
    if (!scan || typeof scan !== "object") return { status: "missing", plan: [] };
    const statusRaw = String(scan.status ?? "").trim().toLowerCase();
    const status = statusRaw === "fresh" || statusRaw === "stale" || statusRaw === "missing" ? statusRaw : "missing";
    const plan = asArrayOfStrings(scan.plan).sort(stableStringCompare);
    return { status, plan };
}

function normalizeWorkset(workset) {
    if (!workset || typeof workset !== "object") {
        return { mode: "digest", files: [], summary: "", text: "" };
    }
    const modeRaw = String(workset.mode ?? "").trim().toLowerCase();
    const mode = modeRaw === "deep" || modeRaw === "digest" ? modeRaw : "digest";
    const files = asArrayOfStrings(workset.files).sort(stablePathCompare);
    const summary = String(workset.summary ?? "").trimEnd();
    const text = String(workset.text ?? "").trimEnd();
    return { mode, files, summary, text };
}

function normalizeExecutionState(executionState) {
    if (!executionState || typeof executionState !== "object") return null;
    return {
        sessionId: executionState.sessionId ? String(executionState.sessionId) : null,
        pauseId: executionState.pauseId ? String(executionState.pauseId) : null,
        phase: executionState.phase ? String(executionState.phase) : null,
        status: executionState.status ? String(executionState.status) : null,
    };
}

function normalizePlanningSource(planningSource) {
    if (planningSource == null) return null;
    if (!isPlainObject(planningSource)) return null;
    const type = asString(planningSource.type, "");
    const docPath = asString(planningSource.path, "");
    const extractedSections = asArrayOfStrings(planningSource.extractedSections).slice(0, 12);
    return {
        type: type || "-",
        path: docPath || "-",
        extractedSections,
    };
}

function clampString(value, maxChars) {
    const text = String(value ?? "");
    const limit = Number.isFinite(Number(maxChars)) ? Number(maxChars) : 0;
    if (limit <= 0) return "";
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function clampArray(value, maxItems) {
    const list = Array.isArray(value) ? value : [];
    const limit = Number.isFinite(Number(maxItems)) ? Math.max(0, Number(maxItems)) : 0;
    return list.slice(0, limit);
}

function normalizeMode(value) {
    const raw = String(value ?? "").trim().toUpperCase();
    if (raw === "SAFE" || raw === "STANDARD" || raw === "REVIEW" || raw === "EXPERIMENTAL") return raw;
    return null;
}

function normalizeRuntime(runtime) {
    if (!runtime || typeof runtime !== "object") return null;
    const out = {
        writeEnabled: Boolean(runtime.writeEnabled),
    };
    const mode = normalizeMode(runtime.mode);
    if (mode) out.mode = mode;
    return out;
}

function normalizeFreshness(freshness) {
    if (!freshness || typeof freshness !== "object") return null;
    const scoreRaw = Number(freshness.score);
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : null;
    const signalsRaw = Array.isArray(freshness.signals) ? freshness.signals : [];
    const signals = clampArray(signalsRaw, 16)
        .map((s) => {
            if (!s || typeof s !== "object") return null;
            const id = asString(s.id, "").slice(0, 80);
            const penaltyRaw = Number(s.penalty);
            const penalty = Number.isFinite(penaltyRaw) ? Math.max(0, Math.round(penaltyRaw)) : null;
            if (!id) return null;
            return penalty == null ? { id } : { id, penalty };
        })
        .filter(Boolean);
    const suggestedActions = clampArray(asArrayOfStrings(freshness.suggestedActions), 12).map((s) => clampString(s, 240));
    const out = {};
    if (score != null) out.score = score;
    if (signals.length) out.signals = signals;
    if (suggestedActions.length) out.suggestedActions = suggestedActions;
    return Object.keys(out).length ? out : null;
}

function normalizeShcStatus(shc) {
    if (!shc || typeof shc !== "object") return null;
    const present = shc.present === true;
    const complete = shc.complete === true;
    const bounded = shc.bounded === true;
    const missingSections = clampArray(asArrayOfStrings(shc.missingSections), 16).map((s) => clampString(s, 120));
    const incompleteSections = clampArray(asArrayOfStrings(shc.incompleteSections), 16).map((s) => clampString(s, 120));
    const overLimitSectionsRaw = Array.isArray(shc.overLimitSections) ? shc.overLimitSections : [];
    const overLimitSections = clampArray(overLimitSectionsRaw, 12)
        .map((x) => {
            if (!x || typeof x !== "object") return null;
            const section = asString(x.section, "").slice(0, 120);
            const lineCount = Number.isFinite(Number(x.lineCount)) ? Number(x.lineCount) : null;
            const charCount = Number.isFinite(Number(x.charCount)) ? Number(x.charCount) : null;
            if (!section) return null;
            const out = { section };
            if (lineCount != null) out.lineCount = lineCount;
            if (charCount != null) out.charCount = charCount;
            return out;
        })
        .filter(Boolean);
    const out = { present, complete, bounded };
    if (missingSections.length) out.missingSections = missingSections;
    if (incompleteSections.length) out.incompleteSections = incompleteSections;
    if (overLimitSections.length) out.overLimitSections = overLimitSections;
    return out;
}

function normalizeDesignStatus(design) {
    if (!design || typeof design !== "object") return null;
    const present = design.present === true;
    const scoreRaw = Number(design.score);
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, Math.round(scoreRaw))) : null;
    const missingSections = clampArray(asArrayOfStrings(design.missingSections), 16).map((s) => clampString(s, 120));
    const weakSections = clampArray(asArrayOfStrings(design.weakSections), 16).map((s) => clampString(s, 120));
    const missingChecks = clampArray(asArrayOfStrings(design.missingChecks), 20).map((s) => clampString(s, 120));
    const suggestedImprovements = clampArray(asArrayOfStrings(design.suggestedImprovements), 10).map((s) => clampString(s, 240));
    const out = { present };
    if (score != null) out.score = score;
    if (missingSections.length) out.missingSections = missingSections;
    if (weakSections.length) out.weakSections = weakSections;
    if (missingChecks.length) out.missingChecks = missingChecks;
    if (suggestedImprovements.length) out.suggestedImprovements = suggestedImprovements;
    return out;
}

function normalizeRdl(rdl) {
    if (!rdl || typeof rdl !== "object") return null;
    const mode = normalizeMode(rdl.mode);
    const freshness = normalizeFreshness(rdl.freshness);
    const shc = normalizeShcStatus(rdl.shc);
    const design = normalizeDesignStatus(rdl.design);
    const out = {};
    if (mode) out.mode = mode;
    if (freshness) out.freshness = freshness;
    if (shc) out.shc = shc;
    if (design) out.design = design;
    return Object.keys(out).length ? out : null;
}

function normalizeRisks(risks) {
    if (risks == null) return [];
    const list = Array.isArray(risks) ? risks : [];
    const stringOnly = list.every((item) => typeof item === "string");
    if (stringOnly) {
        return normalizeRuntimeRisks(
            list.map((id) => ({
                id: String(id ?? "").trim(),
                severity: "info",
                source: "runtime",
                category: "stability",
                message: String(id ?? "").trim(),
                evidence: {},
                suggestedAction: "",
            })),
        );
    }
    return normalizeRuntimeRisks(list);
}

export function normalizeRuntimeContract(contract) {
    const raw = isPlainObject(contract) ? contract : {};
    const runtimeVersion = asString(raw.runtimeVersion, CURRENT_RUNTIME_VERSION);
    const repoRoot = String(raw.repoRoot ?? "").trim();
    const planningSource = Object.hasOwn(raw, "planningSource")
        ? normalizePlanningSource(raw.planningSource)
        : undefined;
    const task = normalizeTask(raw.task);
    const scan = normalizeScan(raw.scan);
    const workset = normalizeWorkset(raw.workset);
    const prompt = String(raw.prompt ?? "").trimEnd();
    const risks = normalizeRisks(raw.risks);
    const nextActions = asArrayOfStrings(raw.nextActions).sort(stableStringCompare);
    const executionState = normalizeExecutionState(raw.executionState);
    const runtime = Object.hasOwn(raw, "runtime") ? normalizeRuntime(raw.runtime) : undefined;
    const rdl = Object.hasOwn(raw, "rdl") ? normalizeRdl(raw.rdl) : undefined;

    const known = { runtimeVersion, repoRoot };
    if (planningSource !== undefined) {
        known.planningSource = planningSource;
    }
    known.task = task;
    known.scan = scan;
    known.workset = workset;
    known.prompt = prompt;
    known.risks = risks;
    known.nextActions = nextActions;
    known.executionState = executionState;
    if (runtime !== undefined) {
        known.runtime = runtime;
    }
    if (rdl !== undefined) {
        known.rdl = rdl;
    }

    const extras = {};
    for (const key of Object.keys(raw)) {
        if (Object.hasOwn(known, key)) continue;
        extras[key] = raw[key];
    }
    const extraKeys = Object.keys(extras).sort(stableStringCompare);
    const merged = { ...known };
    for (const key of extraKeys) {
        merged[key] = extras[key];
    }
    return merged;
}
