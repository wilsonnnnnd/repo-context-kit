import {
    CONTEXT_DIR,
    CONTEXT_META_PATH,
    CONTEXT_PROJECT_MD_PATH,
    CONTEXT_SCAN_LAST_PATH,
    CONTEXT_VERSION,
} from "./constants.js";
import { exists, readJson } from "./fs-utils.js";

export function validateContext() {
    if (!exists(CONTEXT_DIR)) {
        return {
            ok: false,
            reason: "not-initialized",
        };
    }

    if (!exists(CONTEXT_PROJECT_MD_PATH)) {
        return {
            ok: false,
            reason: "incomplete",
        };
    }

    const meta = readJson(CONTEXT_META_PATH);
    if (!meta || typeof meta.version !== "number" || meta.version !== CONTEXT_VERSION) {
        return {
            ok: false,
            reason: "incomplete",
        };
    }

    if (!exists(CONTEXT_SCAN_LAST_PATH)) {
        return {
            ok: false,
            reason: "incomplete",
        };
    }

    return {
        ok: true,
    };
}

export function getContextStatus() {
    return validateContext();
}
