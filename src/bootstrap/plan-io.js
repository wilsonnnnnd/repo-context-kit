import fs from "node:fs";
import { BOOTSTRAP_VERSION } from "./constants.js";

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function readBootstrapPlanPayload(source) {
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

export function getBootstrapPlanFromPayload(payload) {
    const plan = isPlainObject(payload?.plan) ? payload.plan : payload;
    if (!isPlainObject(plan)) {
        throw new Error("plan must be an object");
    }
    if (plan.bootstrapVersion !== BOOTSTRAP_VERSION) {
        throw new Error("unsupported bootstrap plan version");
    }
    if (!Array.isArray(plan.ops)) {
        throw new Error("plan.ops must be an array");
    }
    return plan;
}

