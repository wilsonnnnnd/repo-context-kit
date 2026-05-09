import { CURRENT_RUNTIME_VERSION, isCompatibleRuntimeVersion } from "./runtime-version.js";
import { RUNTIME_DEPRECATIONS } from "./deprecations.js";

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function isJsonSafePrimitive(value) {
    if (value == null) return true;
    if (typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    return false;
}

function describePath(pathParts) {
    return pathParts.length ? pathParts.join(".") : "(root)";
}

function scanJsonSafety(value, pathParts, errors, depth = 0) {
    if (depth > 60) {
        errors.push(`${describePath(pathParts)}: too deep`);
        return;
    }
    if (value === undefined) {
        errors.push(`${describePath(pathParts)}: undefined is not allowed`);
        return;
    }
    const type = typeof value;
    if (type === "function" || type === "symbol" || type === "bigint") {
        errors.push(`${describePath(pathParts)}: ${type} is not JSON-safe`);
        return;
    }
    if (isJsonSafePrimitive(value)) {
        return;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
            scanJsonSafety(value[i], [...pathParts, String(i)], errors, depth + 1);
        }
        return;
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        for (const key of keys) {
            scanJsonSafety(value[key], [...pathParts, key], errors, depth + 1);
        }
        return;
    }
    errors.push(`${describePath(pathParts)}: unsupported object type`);
}

function getByPath(obj, fieldPath) {
    const parts = String(fieldPath ?? "").split(".").filter(Boolean);
    let cur = obj;
    for (const part of parts) {
        if (!cur || typeof cur !== "object") return undefined;
        cur = cur[part];
    }
    return cur;
}

function validateRisk(risk, index, errors) {
    const base = `risks.${index}`;
    if (!isPlainObject(risk)) {
        errors.push(`${base}: must be an object`);
        return;
    }
    const required = ["id", "severity", "source", "category", "message", "evidence", "suggestedAction"];
    for (const key of required) {
        if (!Object.hasOwn(risk, key)) {
            errors.push(`${base}.${key}: missing`);
        }
    }
    if (typeof risk.id !== "string" || !risk.id.trim()) errors.push(`${base}.id: must be a non-empty string`);
    if (typeof risk.severity !== "string") errors.push(`${base}.severity: must be a string`);
    if (typeof risk.source !== "string") errors.push(`${base}.source: must be a string`);
    if (typeof risk.category !== "string") errors.push(`${base}.category: must be a string`);
    if (typeof risk.message !== "string") errors.push(`${base}.message: must be a string`);
    if (!isPlainObject(risk.evidence)) errors.push(`${base}.evidence: must be an object`);
    if (typeof risk.suggestedAction !== "string") errors.push(`${base}.suggestedAction: must be a string`);
}

export function validateRuntimeContract(contract) {
    const errors = [];
    const warnings = [];
    if (!isPlainObject(contract)) {
        return { valid: false, errors: ["(root): contract must be an object"], warnings: [] };
    }

    if (!Object.hasOwn(contract, "runtimeVersion")) {
        errors.push("runtimeVersion: missing");
    } else if (typeof contract.runtimeVersion !== "string" || !contract.runtimeVersion.trim()) {
        errors.push("runtimeVersion: must be a non-empty string");
    } else if (!isCompatibleRuntimeVersion(CURRENT_RUNTIME_VERSION, contract.runtimeVersion)) {
        warnings.push(`runtimeVersion: not compatible with expected ${CURRENT_RUNTIME_VERSION}`);
    }

    if (!Object.hasOwn(contract, "repoRoot")) errors.push("repoRoot: missing");
    else if (typeof contract.repoRoot !== "string") errors.push("repoRoot: must be a string");

    if (Object.hasOwn(contract, "planningSource")) {
        const ps = contract.planningSource;
        if (ps !== null && !isPlainObject(ps)) {
            errors.push("planningSource: must be an object or null");
        } else if (isPlainObject(ps)) {
            if (typeof ps.type !== "string") errors.push("planningSource.type: must be a string");
            if (typeof ps.path !== "string") errors.push("planningSource.path: must be a string");
            if (!Array.isArray(ps.extractedSections)) errors.push("planningSource.extractedSections: must be an array");
            else if (ps.extractedSections.some((x) => typeof x !== "string")) errors.push("planningSource.extractedSections: must be string[]");
        }
    }

    if (!Object.hasOwn(contract, "task")) errors.push("task: missing");
    else if (contract.task !== null && !isPlainObject(contract.task)) errors.push("task: must be an object or null");

    if (!Object.hasOwn(contract, "scan")) errors.push("scan: missing");
    else if (!isPlainObject(contract.scan)) errors.push("scan: must be an object");
    else {
        if (typeof contract.scan.status !== "string") errors.push("scan.status: must be a string");
        if (!Array.isArray(contract.scan.plan)) errors.push("scan.plan: must be an array");
    }

    if (!Object.hasOwn(contract, "workset")) errors.push("workset: missing");
    else if (!isPlainObject(contract.workset)) errors.push("workset: must be an object");
    else {
        if (typeof contract.workset.mode !== "string") errors.push("workset.mode: must be a string");
        if (!Array.isArray(contract.workset.files)) errors.push("workset.files: must be an array");
        if (typeof contract.workset.summary !== "string") errors.push("workset.summary: must be a string");
        if (typeof contract.workset.text !== "string") errors.push("workset.text: must be a string");
    }

    if (!Object.hasOwn(contract, "prompt")) errors.push("prompt: missing");
    else if (typeof contract.prompt !== "string") errors.push("prompt: must be a string");

    if (!Object.hasOwn(contract, "risks")) errors.push("risks: missing");
    else if (!Array.isArray(contract.risks)) errors.push("risks: must be an array");
    else {
        for (let i = 0; i < contract.risks.length; i += 1) {
            validateRisk(contract.risks[i], i, errors);
        }
    }

    if (!Object.hasOwn(contract, "nextActions")) errors.push("nextActions: missing");
    else if (!Array.isArray(contract.nextActions)) errors.push("nextActions: must be an array");
    else if (contract.nextActions.some((x) => typeof x !== "string")) errors.push("nextActions: must be string[]");

    if (!Object.hasOwn(contract, "executionState")) errors.push("executionState: missing");
    else if (contract.executionState !== null && !isPlainObject(contract.executionState)) errors.push("executionState: must be an object or null");

    for (const dep of Array.isArray(RUNTIME_DEPRECATIONS) ? RUNTIME_DEPRECATIONS : []) {
        const value = getByPath(contract, dep.field);
        if (value !== undefined) {
            warnings.push(
                `deprecated: ${dep.field} (since ${dep.deprecatedSince}; replace with ${dep.replacement}; removal target ${dep.removalTarget})`,
            );
        }
    }

    scanJsonSafety(contract, [], errors);

    return { valid: errors.length === 0, errors, warnings };
}
