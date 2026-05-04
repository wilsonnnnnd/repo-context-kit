#!/usr/bin/env node
import { pathToFileURL } from "url";
import path from "path";
import { isDirectory } from "../src/scan/fs-utils.js";
import { readLessonsFile } from "../src/lessons/store.js";
import { listRecentLoopEvents, appendLoopEvent } from "../src/loop/store.js";
import { computeScanCheckState } from "../src/scan/index.js";
import { getTaskConsistencyWarnings } from "../src/scan/task-files.js";

function usage() {
    console.log(`Usage:
  repo-context-kit check [--explain] [--strict | --warn-only]
`);
}

function maybeAppendLearnableEvent(event) {
    if (!isDirectory(".aidw")) {
        return null;
    }
    try {
        return appendLoopEvent(event);
    } catch {
        return null;
    }
}

function formatList(lines) {
    if (!lines || lines.length === 0) {
        return "- (none)";
    }
    return lines.map((line) => `- ${line}`).join("\n");
}

function pickMostRecentTestFailure(events) {
    for (const event of events) {
        if (event?.type === "test" && Number(event.exitCode) !== 0) {
            return event;
        }
    }
    return null;
}

function evaluateLesson(lesson) {
    if (lesson.active === false) {
        return { matched: false, evidence: [], why: null, howToFix: [] };
    }

    const type = String(lesson.type ?? "").trim();
    const severity = String(lesson.severity ?? "blocker").trim() || "blocker";
    const fixLines =
        typeof lesson.fix === "string"
            ? lesson.fix
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
            : [];

    if (type === "tests_failed" || type === "tests_must_pass") {
        const events = listRecentLoopEvents({ limit: 80, maxBytes: 1_000_000 });
        const failure = pickMostRecentTestFailure(events);
        if (!failure) {
            return { matched: false, evidence: [], why: null, howToFix: [] };
        }
        const evidence = [
            `last_test_exit: ${failure.exitCode ?? "-"}`,
            failure.command ? `last_test_command: ${failure.command}` : null,
            failure.taskId ? `task_id: ${failure.taskId}` : null,
        ].filter(Boolean);
        return {
            matched: true,
            severity,
            why: typeof lesson.pattern === "string" ? lesson.pattern : "Recent tests failed.",
            evidence,
            howToFix: fixLines.length > 0 ? fixLines : ["Run tests and fix failures."],
        };
    }

    if (type === "scan_stale" || type === "scan_must_be_up_to_date") {
        const { update } = computeScanCheckState();
        if (!update.changed) {
            return { matched: false, evidence: [], why: null, howToFix: [] };
        }
        const evidence = [
            update.projectChanged ? ".aidw/project.md is out of date" : null,
            update.systemOverviewChanged ? ".aidw/system-overview.md is out of date" : null,
            update.taskMapChanged ? ".aidw/context/tasks.json is out of date" : null,
            update.taskRegistryChanged ? "task registry mismatch detected" : null,
        ].filter(Boolean);
        return {
            matched: true,
            severity,
            why:
                typeof lesson.pattern === "string"
                    ? lesson.pattern
                    : "Scan output is out of date.",
            evidence,
            howToFix: fixLines.length > 0 ? fixLines : ["Run: repo-context-kit scan"],
        };
    }

    if (type === "task_registry_mismatch" || type === "task_registry_consistent") {
        const warnings = getTaskConsistencyWarnings();
        if (warnings.length === 0) {
            return { matched: false, evidence: [], why: null, howToFix: [] };
        }
        return {
            matched: true,
            severity,
            why:
                typeof lesson.pattern === "string"
                    ? lesson.pattern
                    : "Task registry and task files are inconsistent.",
            evidence: warnings,
            howToFix: fixLines.length > 0
                ? fixLines
                : ["Fix task/task.md and task/T-*.md to match, then run: repo-context-kit scan"],
        };
    }

    if (type === "generated_context_risk" || type === "generated_context_protected") {
        const { update } = computeScanCheckState();
        if (!update.skipped) {
            return { matched: false, evidence: [], why: null, howToFix: [] };
        }
        return {
            matched: true,
            severity,
            why:
                typeof lesson.pattern === "string"
                    ? lesson.pattern
                    : "Generated context files are missing required AUTO-GENERATED markers.",
            evidence: [
                "AUTO-GENERATED markers missing from .aidw/project.md",
            ],
            howToFix: fixLines.length > 0
                ? fixLines
                : ["Restore AUTO-GENERATED markers, then run: repo-context-kit scan"],
        };
    }

    return {
        matched: false,
        evidence: [],
        why: null,
        howToFix: [],
        unknown: true,
    };
}

function renderExplain({ lessons, results, matched }) {
    const lines = [];
    lines.push("Check Explain", "");
    lines.push(`- lessons_loaded: ${lessons.length}`);
    lines.push(`- lessons_active: ${lessons.filter((l) => l.active !== false).length}`);
    lines.push(`- lessons_matched: ${matched.length}`, "");

    lines.push("Matches:");
    if (matched.length === 0) {
        lines.push("- (none)");
    } else {
        const blockers = matched.filter((item) => item.lesson.severity === "blocker");
        const warnings = matched.filter((item) => item.lesson.severity === "warning");

        if (blockers.length > 0) {
            lines.push("- blockers:");
            for (const match of blockers) {
                lines.push(`  - ${match.lesson.id} (${match.lesson.type})`);
            }
        }
        if (warnings.length > 0) {
            lines.push("- warnings:");
            for (const match of warnings) {
                lines.push(`  - ${match.lesson.id} (${match.lesson.type})`);
            }
        }
    }

    lines.push("");
    lines.push("Evaluations:");
    for (const item of results) {
        lines.push(`- ${item.lesson.id}: ${item.result.matched ? "FAIL" : "PASS"}`);
    }

    if (matched.length > 0) {
        lines.push("", "Matched Evidence:");
        for (const item of matched) {
            lines.push(`- ${item.lesson.id}:`);
            const evidence = Array.isArray(item.result.evidence) ? item.result.evidence : [];
            if (evidence.length === 0) {
                lines.push("  - (none)");
                continue;
            }
            for (const entry of evidence.slice(0, 10)) {
                lines.push(`  - ${String(entry)}`);
            }
        }
    }

    return `${lines.join("\n")}\n`;
}

function renderOutcome({ matched, title }) {
    const why = matched.map((item) => item.result.why).filter(Boolean);
    const evidence = matched.flatMap((item) => item.result.evidence ?? []);
    const fixes = matched.flatMap((item) => item.result.howToFix ?? []);

    return [
        title,
        "",
        "Why:",
        formatList([...new Set(why)]),
        "",
        "Evidence:",
        formatList([...new Set(evidence.map(String))]),
        "",
        "How to fix:",
        formatList([...new Set(fixes.map(String))]),
        "",
    ].join("\n");
}

export async function runCheck(args = []) {
    if (args.includes("--help") || args.includes("help")) {
        usage();
        return { ok: true };
    }

    const explain = args.includes("--explain");
    const strict = args.includes("--strict");
    const warnOnly = args.includes("--warn-only");

    if (strict && warnOnly) {
        console.error("✖ Only one check mode can be used at a time.");
        process.exitCode = 1;
        return { ok: false };
    }

    if (!isDirectory(".aidw")) {
        console.error("✖ Project is not initialized.");
        console.error("Next:");
        console.error("- Run: repo-context-kit init");
        process.exitCode = 1;
        return { ok: false };
    }

    const lessonsRead = readLessonsFile();
    if (!lessonsRead.ok && lessonsRead.reason === "missing_or_invalid") {
        console.error("✖ Missing or invalid .aidw/lessons.json");
        console.error("Next:");
        console.error("- Run: repo-context-kit learn ingest");
        console.error("- Then run: repo-context-kit learn approve");
        process.exitCode = 1;
        return { ok: false };
    }

    const file = lessonsRead.value;
    const lessons = file.lessons ?? [];
    const results = lessons.map((lesson) => ({ lesson, result: evaluateLesson(lesson) }));
    const matched = results.filter((item) => item.result.matched);
    const matchedActive = matched.filter((item) => item.lesson.active !== false);
    const blockers = matchedActive.filter((item) => item.lesson.severity !== "warning");
    const warnings = matchedActive.filter((item) => item.lesson.severity === "warning");

    if (explain) {
        console.log(renderExplain({ lessons, results, matched: matchedActive }).trimEnd());
    }

    const strictMatches = strict ? blockers.concat(warnings) : blockers;
    const shouldFail = !warnOnly && strictMatches.length > 0;

    if (matchedActive.length > 0) {
        const title = shouldFail ? "Check Failed" : "Check Warnings";
        const output = renderOutcome({ matched: matchedActive, title });
        console.log(output.trimEnd());

        const eventBase = {
            matchedLessonIds: matchedActive.map((item) => item.lesson.id),
            matchedLessonTypes: matchedActive.map((item) => item.lesson.type),
            matchedLessonSeverities: matchedActive.map((item) => item.lesson.severity ?? "blocker"),
            evidence: matchedActive.flatMap((item) => item.result.evidence ?? []),
        };

        if (shouldFail) {
            maybeAppendLearnableEvent({
                type: "check_failed",
                ok: false,
                ...eventBase,
            });
            process.exitCode = 1;
            return { ok: false, matched: matchedActive.map((item) => item.lesson.id) };
        }

        maybeAppendLearnableEvent({
            type: "check_warned",
            ok: true,
            ...eventBase,
        });
        process.exitCode = 0;
        return { ok: true, warned: matchedActive.map((item) => item.lesson.id) };
    }

    console.log("Checks passed.");
    maybeAppendLearnableEvent({
        type: "check_passed",
        ok: true,
    });
    process.exitCode = 0;
    return { ok: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runCheck(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exitCode = 1;
    });
}
