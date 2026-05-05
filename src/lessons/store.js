import {
    CONTEXT_DIR,
    CONTEXT_LESSONS_PATH,
} from "../scan/constants.js";
import { ensureDir, exists, readJson, writeText } from "../scan/fs-utils.js";

const DEFAULT_SCHEMA = {
    lesson: {
        id: "L-001",
        type: "scan_stale | derived | effect",
        severity: "blocker | warning | degrade | info",
        action: "blocker | warning | degrade | info",
        confidence: 0.9,
        window: "last_5_events",
        threshold: 3,
        scope: "repo | task | file",
        pattern: "Human-readable pattern summary for matching.",
        fix: "Human-readable remediation guidance.",
        active: true,
        conditions: ["tests_failed", "scan_stale"],
        trigger: ["tests_failed"],
        effect: {
            context_mode: "FULL",
        },
        source: {
            eventId: "evt_123",
            from: "test | scan | executor | check | learn",
        },
    },
};

export function getDefaultLessonsFile() {
    return {
        version: 2,
        schema: DEFAULT_SCHEMA,
        lessons: [],
    };
}

const VALID_SEVERITIES = new Set(["blocker", "warning", "degrade", "info"]);
const VALID_SCOPES = new Set(["repo", "task", "file"]);
const VALID_SOURCES = new Set(["test", "scan", "executor", "check", "learn"]);

function normalizeWindow(raw) {
    if (typeof raw !== "string") {
        return null;
    }
    const value = raw.trim();
    const match = /^last_(\d+)_events$/i.exec(value);
    if (!match) {
        return null;
    }
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count <= 0) {
        return null;
    }
    return `last_${Math.floor(count)}_events`;
}

function normalizeThreshold(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }
    return Math.floor(value);
}

function normalizeConfidence(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        return null;
    }
    if (value < 0 || value > 1) {
        return null;
    }
    return value;
}

function normalizeLessonV2(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    const active = raw.active !== false;
    const source =
        raw.source && typeof raw.source === "object"
            ? {
                  eventId:
                      typeof raw.source.eventId === "string"
                          ? raw.source.eventId.trim()
                          : null,
                  from:
                      typeof raw.source.from === "string" &&
                      VALID_SOURCES.has(raw.source.from.trim())
                          ? raw.source.from.trim()
                          : null,
              }
            : { eventId: null, from: null };

    if (!id || !type) {
        return null;
    }

    if (type === "derived") {
        const conditions = Array.isArray(raw.conditions)
            ? raw.conditions
                  .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                  .filter(Boolean)
            : [];
        if (conditions.length === 0) {
            return null;
        }
        const action = typeof raw.action === "string" ? raw.action.trim() : "";
        const normalizedAction = VALID_SEVERITIES.has(action) ? action : "warning";
        const scope = typeof raw.scope === "string" ? raw.scope.trim() : "";
        const normalizedScope = VALID_SCOPES.has(scope) ? scope : "repo";
        const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
        const fix = typeof raw.fix === "string" ? raw.fix.trim() : "";
        return {
            id,
            type,
            conditions,
            action: normalizedAction,
            severity: normalizedAction,
            scope: normalizedScope,
            pattern: pattern || `derived: ${id}`,
            fix: fix || "",
            active,
            source,
        };
    }

    if (type === "effect") {
        const trigger = Array.isArray(raw.trigger)
            ? raw.trigger
                  .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                  .filter(Boolean)
            : [];
        const effect =
            raw.effect && typeof raw.effect === "object" && !Array.isArray(raw.effect)
                ? raw.effect
                : {};
        return {
            id,
            type,
            trigger,
            effect,
            active,
            source,
        };
    }

    const severity = typeof raw.severity === "string" ? raw.severity.trim() : "";
    const action = typeof raw.action === "string" ? raw.action.trim() : "";
    const scope = typeof raw.scope === "string" ? raw.scope.trim() : "";
    const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
    const fix = typeof raw.fix === "string" ? raw.fix.trim() : "";

    if (!pattern || !fix) {
        return null;
    }

    const normalizedSeverity = VALID_SEVERITIES.has(action)
        ? action
        : VALID_SEVERITIES.has(severity)
            ? severity
            : "blocker";
    const normalizedScope = VALID_SCOPES.has(scope) ? scope : "repo";
    const confidence = normalizeConfidence(raw.confidence);
    const window = normalizeWindow(raw.window);
    const threshold = normalizeThreshold(raw.threshold);

    return {
        id,
        type,
        severity: normalizedSeverity,
        scope: normalizedScope,
        pattern,
        fix,
        active,
        source,
        confidence,
        window,
        threshold,
    };
}

function migrateLessonV1ToV2(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    if (!id || !type) {
        return null;
    }

    const enabled = raw.enabled !== false;
    const why =
        raw.enforce && typeof raw.enforce === "object" && typeof raw.enforce.why === "string"
            ? raw.enforce.why.trim()
            : "";
    const howToFix =
        raw.enforce &&
        typeof raw.enforce === "object" &&
        Array.isArray(raw.enforce.howToFix)
            ? raw.enforce.howToFix.map((line) => String(line)).filter(Boolean)
            : [];

    const mappedType = {
        tests_must_pass: "tests_failed",
        scan_must_be_up_to_date: "scan_stale",
        task_registry_consistent: "task_registry_mismatch",
        generated_context_protected: "generated_context_risk",
    }[type] ?? type;

    return {
        id,
        type: mappedType,
        severity: "blocker",
        scope: "repo",
        pattern: why || `migrated_from_v1: ${type}`,
        fix: howToFix.length > 0 ? howToFix.join("\n") : "migrated_from_v1",
        active: enabled,
        source: {
            eventId: null,
            from: "learn",
        },
    };
}

export function readLessonsFile() {
    const raw = readJson(CONTEXT_LESSONS_PATH);
    const base = getDefaultLessonsFile();

    if (!raw || typeof raw !== "object") {
        return { ok: false, value: base, reason: "missing_or_invalid" };
    }

    const version = Number(raw.version);
    const lessonsRaw = Array.isArray(raw.lessons) ? raw.lessons : [];
    if (version === 1) {
        const lessons = lessonsRaw.map(migrateLessonV1ToV2).filter(Boolean);
        return {
            ok: true,
            value: {
                version: 2,
                schema: DEFAULT_SCHEMA,
                lessons,
            },
            reason: "migrated_v1",
        };
    }

    const lessons = lessonsRaw.map(normalizeLessonV2).filter(Boolean);

    return {
        ok: Number.isFinite(version) && version === 2,
        value: {
            version: 2,
            schema: DEFAULT_SCHEMA,
            lessons,
        },
        reason: Number.isFinite(version) && version === 2 ? null : "unsupported_version",
    };
}

export function writeLessonsFile(file) {
    ensureDir(CONTEXT_DIR);
    const payload = {
        version: 2,
        schema: DEFAULT_SCHEMA,
        lessons: Array.isArray(file?.lessons) ? file.lessons : [],
    };
    writeText(CONTEXT_LESSONS_PATH, `${JSON.stringify(payload, null, 4)}\n`);
    return CONTEXT_LESSONS_PATH;
}

export function ensureLessonsFile() {
    if (exists(CONTEXT_LESSONS_PATH)) {
        return { created: false, path: CONTEXT_LESSONS_PATH };
    }

    writeLessonsFile(getDefaultLessonsFile());
    return { created: true, path: CONTEXT_LESSONS_PATH };
}

export function upsertLesson(file, lesson) {
    const normalized = normalizeLessonV2(lesson);
    if (!normalized) {
        return { ok: false, changed: false };
    }

    const existingIndex = file.lessons.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) {
        const current = file.lessons[existingIndex];
        const merged = {
            ...current,
            ...normalized,
            source: { ...(current.source ?? {}), ...(normalized.source ?? {}) },
        };
        file.lessons.splice(existingIndex, 1, merged);
        return { ok: true, changed: true, id: merged.id };
    }

    file.lessons.push(normalized);
    return { ok: true, changed: true, id: normalized.id };
}
