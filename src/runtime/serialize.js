function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function canonicalize(value, pathParts = []) {
    if (value === undefined) {
        throw new Error(`serialize: undefined at ${pathParts.join(".") || "(root)"}`);
    }
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
        throw new Error(`serialize: unsupported type ${typeof value} at ${pathParts.join(".") || "(root)"}`);
    }
    if (value == null) return null;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`serialize: non-finite number at ${pathParts.join(".") || "(root)"}`);
        }
        return value;
    }
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
        return value.map((item, index) => canonicalize(item, [...pathParts, String(index)]));
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
        const out = {};
        for (const key of keys) {
            const v = value[key];
            if (v === undefined) continue;
            out[key] = canonicalize(v, [...pathParts, key]);
        }
        return out;
    }
    throw new Error(`serialize: unsupported object type at ${pathParts.join(".") || "(root)"}`);
}

function canonicalizePreserve(value, pathParts = []) {
    if (value === undefined) {
        throw new Error(`serialize: undefined at ${pathParts.join(".") || "(root)"}`);
    }
    if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
        throw new Error(`serialize: unsupported type ${typeof value} at ${pathParts.join(".") || "(root)"}`);
    }
    if (value == null) return null;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`serialize: non-finite number at ${pathParts.join(".") || "(root)"}`);
        }
        return value;
    }
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
        return value.map((item, index) => canonicalizePreserve(item, [...pathParts, String(index)]));
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        const out = {};
        for (const key of keys) {
            const v = value[key];
            if (v === undefined) continue;
            out[key] = canonicalizePreserve(v, [...pathParts, key]);
        }
        return out;
    }
    throw new Error(`serialize: unsupported object type at ${pathParts.join(".") || "(root)"}`);
}

export function serializeJson(value, options = {}) {
    const indent = Number.isFinite(Number(options.indent)) ? Number(options.indent) : 4;
    const canonical = canonicalize(value);
    return `${JSON.stringify(canonical, null, indent)}\n`;
}

export function serializeRuntimeContract(contract) {
    const canonical = canonicalizePreserve(contract);
    return `${JSON.stringify(canonical, null, 4)}\n`;
}
