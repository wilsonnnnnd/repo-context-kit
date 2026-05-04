import {
    CONTEXT_DIR,
    CONTEXT_LESSONS_PATH,
} from "../scan/constants.js";
import { ensureDir, exists, readJson, writeText } from "../scan/fs-utils.js";

const DEFAULT_SCHEMA = {
    lesson: {
        id: "L-001",
        type: "scan_stale",
        severity: "blocker | warning",
        scope: "repo | task | file",
        pattern: "Human-readable pattern summary for matching.",
        fix: "Human-readable remediation guidance.",
        active: true,
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

const VALID_SEVERITIES = new Set(["blocker", "warning"]);
const VALID_SCOPES = new Set(["repo", "task", "file"]);
const VALID_SOURCES = new Set(["test", "scan", "executor", "check", "learn"]);

function normalizeLessonV2(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const type = typeof raw.type === "string" ? raw.type.trim() : "";
    const severity = typeof raw.severity === "string" ? raw.severity.trim() : "";
    const scope = typeof raw.scope === "string" ? raw.scope.trim() : "";
    const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
    const fix = typeof raw.fix === "string" ? raw.fix.trim() : "";

    if (!id || !type || !pattern || !fix) {
        return null;
    }

    const normalizedSeverity = VALID_SEVERITIES.has(severity) ? severity : "blocker";
    const normalizedScope = VALID_SCOPES.has(scope) ? scope : "repo";
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

    return {
        id,
        type,
        severity: normalizedSeverity,
        scope: normalizedScope,
        pattern,
        fix,
        active,
        source,
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
