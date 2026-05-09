import fs from "node:fs";
import path from "node:path";
import { validateRuntimeContract } from "../runtime/runtime-schema.js";
import { writeRuntimeSnapshot } from "../runtime/snapshot.js";
import { normalizeRuntimeContract } from "../runtime/normalize.js";
import { serializeJson } from "../runtime/serialize.js";
import { MANAGED_CONTEXT_FILE_PATHS } from "../scan/constants.js";
import { BOOTSTRAP_ALLOWED_OPS, BOOTSTRAP_VERSION } from "./constants.js";
import { assertBootstrapPathAllowed, resolveWithinRepoRoot } from "./paths.js";
import { readTemplateFileBytes } from "./template.js";

const PROHIBITED_OP_KEYS = new Set([
    "run",
    "command",
    "args",
    "shell",
    "exec",
    "spawn",
    "install",
]);

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function containsProhibitedKeys(value, depth = 0) {
    if (depth > 20) return false;
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) {
        return value.some((item) => containsProhibitedKeys(item, depth + 1));
    }
    const keys = Object.keys(value);
    for (const key of keys) {
        const normalized = String(key).trim().toLowerCase();
        if (PROHIBITED_OP_KEYS.has(normalized)) {
            return true;
        }
        if (containsProhibitedKeys(value[key], depth + 1)) {
            return true;
        }
    }
    return false;
}

function ensureDir(fullPath) {
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
}

function readJsonFromPlanSource(source) {
    if (source && typeof source === "object") {
        return source;
    }
    if (typeof source === "string" && source.trim() === "-") {
        const raw = fs.readFileSync(0, "utf-8");
        return JSON.parse(raw);
    }
    const filePath = String(source ?? "").trim();
    if (!filePath) {
        throw new Error("plan path is required");
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
}

function validatePlanShape(plan) {
    if (!isPlainObject(plan)) {
        throw new Error("plan must be an object");
    }
    if (plan.bootstrapVersion !== BOOTSTRAP_VERSION) {
        throw new Error("unsupported bootstrap plan version");
    }
    if (!Array.isArray(plan.ops)) {
        throw new Error("plan.ops must be an array");
    }
    if (typeof plan.digest !== "string" || !plan.digest.trim()) {
        throw new Error("plan.digest is required");
    }
    if (typeof plan.pauseToken !== "string" || !plan.pauseToken.trim()) {
        throw new Error("plan.pauseToken is required");
    }
    return plan;
}

function validateOp(op) {
    if (!isPlainObject(op)) {
        throw new Error("op must be an object");
    }
    const type = String(op.op ?? "").trim();
    if (!BOOTSTRAP_ALLOWED_OPS.has(type)) {
        throw new Error(`op is not allowed: ${type || "-"}`);
    }
    const allowedKeys = new Set(["op", "path", "preconditions", "reason", "content", "order"]);
    const extraKeys = Object.keys(op).filter((key) => !allowedKeys.has(key));
    if (extraKeys.length > 0) {
        const error = new Error(`bootstrap-command-injection: unexpected op keys: ${extraKeys.join(", ")}`);
        error.code = "COMMAND_INJECTION";
        throw error;
    }
    if (containsProhibitedKeys(op)) {
        const error = new Error("bootstrap-command-injection: prohibited op keys detected in ops payload");
        error.code = "COMMAND_INJECTION";
        throw error;
    }
    const rel = assertBootstrapPathAllowed(op.path);
    const pre = isPlainObject(op.preconditions) ? op.preconditions : {};
    const reason = isPlainObject(op.reason) ? op.reason : {};
    const content = isPlainObject(op.content) ? op.content : null;
    return { ...op, op: type, path: rel, preconditions: pre, reason, content };
}

function applyMkdir({ repoRoot, op }) {
    const { fullPath } = resolveWithinRepoRoot(repoRoot, op.path);
    fs.mkdirSync(fullPath, { recursive: true });
    return { op: op.op, path: op.path, ok: true };
}

function applyWriteFile({ repoRoot, op }) {
    const { fullPath } = resolveWithinRepoRoot(repoRoot, op.path);
    const mustNotExist = Boolean(op.preconditions?.mustNotExist);
    const mustExist = Boolean(op.preconditions?.mustExist);
    const exists = fs.existsSync(fullPath);
    if (mustNotExist && exists) {
        throw new Error(`precondition failed: mustNotExist for ${op.path}`);
    }
    if (mustExist && !exists) {
        throw new Error(`precondition failed: mustExist for ${op.path}`);
    }
    const body = typeof op.content?.text === "string" ? op.content.text : null;
    if (body === null) {
        throw new Error(`missing content text for ${op.path}`);
    }
    ensureDir(fullPath);
    fs.writeFileSync(fullPath, body, "utf-8");
    return { op: op.op, path: op.path, ok: true, bytes: Buffer.byteLength(body, "utf-8") };
}

function applyCopyTemplate({ repoRoot, op }) {
    const { fullPath } = resolveWithinRepoRoot(repoRoot, op.path);
    const mustNotExist = Boolean(op.preconditions?.mustNotExist);
    const mustExist = Boolean(op.preconditions?.mustExist);
    const exists = fs.existsSync(fullPath);
    if (mustNotExist && exists) {
        throw new Error(`precondition failed: mustNotExist for ${op.path}`);
    }
    if (mustExist && !exists) {
        throw new Error(`precondition failed: mustExist for ${op.path}`);
    }
    if (exists && !MANAGED_CONTEXT_FILE_PATHS.has(op.path)) {
        throw new Error(`refusing to overwrite non-managed file: ${op.path}`);
    }
    const bytes = readTemplateFileBytes(op.reason?.evidence?.templatePath ?? op.path);
    ensureDir(fullPath);
    fs.writeFileSync(fullPath, bytes);
    return { op: op.op, path: op.path, ok: true, bytes: bytes.byteLength };
}

export function applyBootstrapPlan({ repoRoot, planSource, enableWrite = false, confirm = null } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    if (!enableWrite) {
        const error = new Error("Write mode is disabled. Re-run with --enable-write.");
        error.code = "WRITE_DISABLED";
        throw error;
    }
    const planPayload = readJsonFromPlanSource(planSource);
    if (containsProhibitedKeys(planPayload?.plan?.ops ?? planPayload?.ops ?? null)) {
        const error = new Error("bootstrap-command-injection: prohibited op keys detected in plan.ops");
        error.code = "COMMAND_INJECTION";
        throw error;
    }
    const plan = validatePlanShape(planPayload?.plan ?? planPayload);
    const token = String(confirm ?? "").trim();
    if (!token || token !== plan.pauseToken) {
        const error = new Error("Confirmation token does not match the plan pauseToken.");
        error.code = "CONFIRM_MISMATCH";
        throw error;
    }
    const contractCandidate = planPayload?.contract ?? null;
    const normalized = contractCandidate ? normalizeRuntimeContract(contractCandidate) : null;
    if (!normalized) {
        throw new Error("plan is missing contract payload");
    }
    const validation = validateRuntimeContract(normalized);
    if (!validation.valid) {
        throw new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
    }
    const hasBlocker = Array.isArray(normalized.risks) && normalized.risks.some((risk) =>
        String(risk?.severity ?? "").trim().toLowerCase() === "blocker"
    );
    if (hasBlocker) {
        const error = new Error("Bootstrap plan contains blocker risks. Resolve them before applying.");
        error.code = "BLOCKER_RISK";
        throw error;
    }

    const ops = plan.ops.map(validateOp).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.path.localeCompare(b.path));

    const results = [];
    for (const op of ops) {
        if (op.op === "mkdir") {
            results.push(applyMkdir({ repoRoot: root, op }));
        } else if (op.op === "writeFile") {
            results.push(applyWriteFile({ repoRoot: root, op }));
        } else if (op.op === "copyTemplate") {
            results.push(applyCopyTemplate({ repoRoot: root, op }));
        } else if (op.op === "snapshot") {
            results.push({ op: "snapshot", path: op.path, ok: true });
        }
    }

    const summary = {
        ok: true,
        appliedOps: results.length,
        filesCreated: results.filter((r) => r.op !== "mkdir" && r.op !== "snapshot").length,
        dirsEnsured: results.filter((r) => r.op === "mkdir").length,
    };

    if (!normalized.bootstrap || normalized.bootstrap.bootstrapVersion !== BOOTSTRAP_VERSION) {
        normalized.bootstrap = normalized.bootstrap || {};
        normalized.bootstrap.bootstrapVersion = BOOTSTRAP_VERSION;
    }
    normalized.executionState = { sessionId: null, pauseId: null, phase: "bootstrap_applied", status: "applied" };

    const snapshotId = writeRuntimeSnapshot(normalized, { repoRoot: root, mode: "bootstrap-apply" });
    normalized.bootstrap.snapshot = { ...(normalized.bootstrap.snapshot || {}), appliedSnapshotId: snapshotId };

    return {
        ok: true,
        repoRoot: root,
        snapshotId,
        summary,
        applyReport: results,
        contract: normalized,
        output: serializeJson({ snapshotId, summary, appliedOps: results.length }),
    };
}
