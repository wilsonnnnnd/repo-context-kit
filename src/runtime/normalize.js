import { CURRENT_RUNTIME_VERSION } from "./runtime-version.js";
import { normalizeRuntimeRisks } from "./risks.js";

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
    const plan = asArrayOfStrings(scan.plan).sort((a, b) => a.localeCompare(b));
    return { status, plan };
}

function normalizeWorkset(workset) {
    if (!workset || typeof workset !== "object") {
        return { mode: "digest", files: [], summary: "", text: "" };
    }
    const modeRaw = String(workset.mode ?? "").trim().toLowerCase();
    const mode = modeRaw === "deep" || modeRaw === "digest" ? modeRaw : "digest";
    const files = asArrayOfStrings(workset.files).sort((a, b) => a.localeCompare(b));
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
    const nextActions = asArrayOfStrings(raw.nextActions).sort((a, b) => a.localeCompare(b));
    const executionState = normalizeExecutionState(raw.executionState);

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

    const extras = {};
    for (const key of Object.keys(raw)) {
        if (Object.hasOwn(known, key)) continue;
        extras[key] = raw[key];
    }
    const extraKeys = Object.keys(extras).sort((a, b) => a.localeCompare(b));
    const merged = { ...known };
    for (const key of extraKeys) {
        merged[key] = extras[key];
    }
    return merged;
}
