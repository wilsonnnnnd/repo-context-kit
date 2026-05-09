import { collectRuntimeRisks, normalizeRuntimeRisks } from "./risks.js";
import { CURRENT_RUNTIME_VERSION } from "./runtime-version.js";
import { normalizeRuntimeContract } from "./normalize.js";

function sortStrings(values) {
    return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
    );
}

function normalizeScan(scan) {
    if (!scan || typeof scan !== "object") {
        return { status: "missing", plan: [] };
    }
    const statusRaw = String(scan.status ?? "").trim().toLowerCase();
    const status = statusRaw === "fresh" || statusRaw === "stale" || statusRaw === "missing"
        ? statusRaw
        : "missing";
    const plan = Array.isArray(scan.plan) ? sortStrings(scan.plan) : [];
    return { status, plan };
}

function normalizeWorkset(workset) {
    if (!workset || typeof workset !== "object") {
        return { mode: "digest", files: [], summary: "", text: "" };
    }
    const modeRaw = String(workset.mode ?? "").trim().toLowerCase();
    const mode = modeRaw === "deep" || modeRaw === "digest" ? modeRaw : "digest";
    const files = Array.isArray(workset.files) ? sortStrings(workset.files) : [];
    const summary = String(workset.summary ?? "").trimEnd();
    const text = String(workset.text ?? "").trimEnd();
    return { mode, files, summary, text };
}

function normalizeTask(task) {
    if (!task || typeof task !== "object") {
        return null;
    }
    return {
        id: String(task.id ?? "").trim() || "-",
        title: String(task.title ?? "").trim() || "-",
        goal: String(task.goal ?? "").trim() || "",
        requirements: Array.isArray(task.requirements) ? task.requirements.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
        acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
        testCommand: String(task.testCommand ?? "").trim() || "",
        definitionOfDone: Array.isArray(task.definitionOfDone) ? task.definitionOfDone.map((x) => String(x ?? "").trim()).filter(Boolean) : [],
    };
}

function normalizeExecutionState(executionState) {
    if (!executionState || typeof executionState !== "object") {
        return null;
    }
    return {
        sessionId: executionState.sessionId ? String(executionState.sessionId) : null,
        pauseId: executionState.pauseId ? String(executionState.pauseId) : null,
        phase: executionState.phase ? String(executionState.phase) : null,
        status: executionState.status ? String(executionState.status) : null,
    };
}

export function buildRuntimeContract(payload = {}) {
    const runtimeVersion = CURRENT_RUNTIME_VERSION;
    const repoRoot = String(payload.repoRoot ?? "").trim();
    const planningSource = Object.hasOwn(payload, "planningSource") ? payload.planningSource : undefined;
    const task = normalizeTask(payload.task);
    const workset = normalizeWorkset(payload.workset);
    const prompt = String(payload.prompt ?? "").trimEnd();
    const scan = normalizeScan(payload.scan);
    const risksRaw = Array.isArray(payload.risks)
        ? payload.risks
        : collectRuntimeRisks({
              repoRoot,
              task,
              workset,
              scan,
              lessons: payload.lessons,
              loop: payload.loop,
              executionState: payload.executionState,
              runtime: payload.runtime,
          });
    const risks = normalizeRuntimeRisks(risksRaw);
    const nextActions = Array.isArray(payload.nextActions) ? sortStrings(payload.nextActions) : [];
    const executionState = normalizeExecutionState(payload.executionState);

    return normalizeRuntimeContract({
        runtimeVersion,
        repoRoot,
        ...(planningSource !== undefined ? { planningSource } : {}),
        task,
        scan,
        workset,
        prompt,
        risks,
        nextActions,
        executionState,
    });
}
