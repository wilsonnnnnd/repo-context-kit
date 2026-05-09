import fs from "node:fs";
import { serializeJson } from "../runtime/serialize.js";
import { BOOTSTRAP_VERSION } from "./constants.js";

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function readJsonFromSource(source) {
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

export function inspectBootstrapPlan({ planSource } = {}) {
    const payload = readJsonFromSource(planSource);
    const plan = isPlainObject(payload?.plan) ? payload.plan : payload;
    if (!isPlainObject(plan)) {
        throw new Error("plan must be an object");
    }
    if (plan.bootstrapVersion !== BOOTSTRAP_VERSION) {
        throw new Error("unsupported bootstrap plan version");
    }
    const ops = Array.isArray(plan.ops) ? plan.ops : [];
    const counts = {
        ops: ops.length,
        mkdir: ops.filter((o) => o?.op === "mkdir").length,
        writeFile: ops.filter((o) => o?.op === "writeFile").length,
        copyTemplate: ops.filter((o) => o?.op === "copyTemplate").length,
        snapshot: ops.filter((o) => o?.op === "snapshot").length,
    };
    const sample = ops
        .filter((o) => o && typeof o.path === "string")
        .slice(0, 40)
        .map((o) => ({ op: o.op, path: o.path }));
    return {
        ok: true,
        bootstrapVersion: plan.bootstrapVersion,
        writeMode: plan.writeMode ?? "create-only",
        digest: plan.digest ?? null,
        pauseToken: plan.pauseToken ?? null,
        counts,
        sample,
        plan,
        output: serializeJson({ ok: true, bootstrapVersion: plan.bootstrapVersion, writeMode: plan.writeMode, digest: plan.digest, pauseToken: plan.pauseToken, counts, sample }),
    };
}
