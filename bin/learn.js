#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "fs";
import { pathToFileURL } from "url";
import path from "path";
import { listRecentLoopEvents, appendLoopEvent } from "../src/loop/store.js";
import {
    exists,
    isDirectory,
    resolveFromProject,
    writeText,
} from "../src/scan/fs-utils.js";
import {
    CONTEXT_LESSONS_PATH,
    CONTEXT_LESSONS_PENDING_PATH,
} from "../src/scan/constants.js";
import {
    ensureLessonsFile,
    readLessonsFile,
    upsertLesson,
    writeLessonsFile,
} from "../src/lessons/store.js";

function usage() {
    console.log(`Usage:
  repo-context-kit learn ingest [--dry-run]
  repo-context-kit learn approve
`);
}

function eventIdFor(event) {
    const raw = JSON.stringify(event ?? {});
    const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
    return `evt_${digest}`;
}

function lessonIdFor(type) {
    return `L-${type}`;
}

function buildLesson({
    type,
    severity,
    scope,
    pattern,
    fix,
    active,
    source,
}) {
    return {
        id: lessonIdFor(type),
        type,
        severity,
        scope,
        pattern,
        fix,
        active,
        source,
    };
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

function mostRecentEvent(events, predicate) {
    for (const event of events) {
        if (predicate(event)) {
            return event;
        }
    }
    return null;
}

function deriveLessonsFromEvents(events) {
    const derived = [];

    const testFailure = mostRecentEvent(
        events,
        (event) => event?.type === "test" && Number(event.exitCode) !== 0,
    );
    if (testFailure) {
        derived.push(
            buildLesson({
                type: "tests_failed",
                severity: "blocker",
                scope: "repo",
                pattern: "Recent tests failed (exit code != 0).",
                fix: [
                    "Run: npm test",
                    "Fix failures.",
                    "Re-run tests until exit code is 0.",
                ].join("\n"),
                active: true,
                source: {
                    eventId: eventIdFor(testFailure),
                    from: "test",
                },
            }),
        );
    }

    const scanCheckFailure = mostRecentEvent(
        events,
        (event) => event?.type === "scan_check_failed",
    );
    if (scanCheckFailure) {
        derived.push(
            buildLesson({
                type: "scan_stale",
                severity: "blocker",
                scope: "repo",
                pattern: "Scan check indicates generated context is stale.",
                fix: ["Run: repo-context-kit scan", "Re-run: repo-context-kit scan --check"].join(
                    "\n",
                ),
                active: true,
                source: {
                    eventId: eventIdFor(scanCheckFailure),
                    from: "scan",
                },
            }),
        );
    }

    const taskRegistryMismatch = mostRecentEvent(
        events,
        (event) =>
            event?.type === "scan_check_failed" && event?.taskRegistryChanged === true,
    );
    if (taskRegistryMismatch) {
        derived.push(
            buildLesson({
                type: "task_registry_mismatch",
                severity: "blocker",
                scope: "repo",
                pattern: "Task registry and task files are inconsistent.",
                fix: [
                    "Fix missing/renamed task files or update task/task.md to match.",
                    "Then run: repo-context-kit scan",
                ].join("\n"),
                active: true,
                source: {
                    eventId: eventIdFor(taskRegistryMismatch),
                    from: "scan",
                },
            }),
        );
    }

    const generatedRisk = mostRecentEvent(
        events,
        (event) =>
            event?.type === "scan_failed" &&
            event?.reason === "missing_auto_generated_markers",
    );
    if (generatedRisk) {
        derived.push(
            buildLesson({
                type: "generated_context_risk",
                severity: "blocker",
                scope: "file",
                pattern:
                    "Generated context update was skipped because AUTO-GENERATED markers were missing.",
                fix: [
                    "Restore AUTO-GENERATED markers in .aidw/project.md",
                    "Then run: repo-context-kit scan",
                ].join("\n"),
                active: true,
                source: {
                    eventId: eventIdFor(generatedRisk),
                    from: "scan",
                },
            }),
        );
    }

    return derived;
}

function renderDryRun(lessons) {
    console.log("Learn Ingest Plan");
    console.log("");
    console.log(`- will_write_pending: ${lessons.length > 0 ? "true" : "false"}`);
    console.log(`- pending_path: ${CONTEXT_LESSONS_PENDING_PATH}`);
    console.log("");
    console.log("Lessons:");
    if (lessons.length === 0) {
        console.log("- (none)");
        return;
    }
    for (const lesson of lessons) {
        console.log(`- ${lesson.id}`);
        console.log(`  - type: ${lesson.type}`);
        console.log(`  - severity: ${lesson.severity}`);
        console.log(`  - scope: ${lesson.scope}`);
        console.log(`  - active: ${lesson.active ? "true" : "false"}`);
    }
    console.log("");
    console.log("No files were written.");
}

function writePendingLessonsFile(lessons) {
    const payload = {
        version: 2,
        generatedAt: new Date().toISOString(),
        target: CONTEXT_LESSONS_PATH,
        lessons,
    };
    writeText(CONTEXT_LESSONS_PENDING_PATH, `${JSON.stringify(payload, null, 4)}\n`);
    return CONTEXT_LESSONS_PENDING_PATH;
}

function readPendingLessonsFile() {
    if (!exists(CONTEXT_LESSONS_PENDING_PATH)) {
        return null;
    }
    const fullPath = resolveFromProject(CONTEXT_LESSONS_PENDING_PATH);
    try {
        return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch {
        return null;
    }
}

export async function runLearn(args = []) {
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? "ingest";
    const dryRun = args.includes("--dry-run");

    if (!subcommand || subcommand === "help" || subcommand === "--help") {
        usage();
        return { ok: true };
    }

    if (!isDirectory(".aidw")) {
        console.error("✖ Project is not initialized.");
        console.error("Next:");
        console.error("- Run: repo-context-kit init");
        process.exitCode = 1;
        return { ok: false };
    }

    if (subcommand === "approve") {
        const pending = readPendingLessonsFile();
        if (!pending || !Array.isArray(pending.lessons)) {
            console.error("✖ Missing or invalid .aidw/lessons.pending.json");
            console.error("Next:");
            console.error("- Run: repo-context-kit learn ingest");
            process.exitCode = 1;
            return { ok: false };
        }

        ensureLessonsFile();
        const current = readLessonsFile().value;
        const mergedIds = [];

        for (const lesson of pending.lessons) {
            const result = upsertLesson(current, lesson);
            if (result.ok && result.changed) {
                mergedIds.push(result.id);
            }
        }

        writeLessonsFile(current);

        try {
            fs.unlinkSync(resolveFromProject(CONTEXT_LESSONS_PENDING_PATH));
        } catch {}

        console.log("Learn Approve");
        console.log("");
        console.log(`- merged: ${mergedIds.length}`);
        for (const id of mergedIds) {
            console.log(`  - ${id}`);
        }

        maybeAppendLearnableEvent({
            type: "learn_approve",
            ok: true,
            mergedLessons: mergedIds,
        });

        return { ok: true, mergedLessons: mergedIds };
    }

    if (subcommand !== "ingest") {
        console.error("Unknown learn command.");
        usage();
        process.exitCode = 1;
        return { ok: false };
    }

    ensureLessonsFile();
    const events = listRecentLoopEvents({ limit: 200, maxBytes: 2_000_000 });
    const derived = deriveLessonsFromEvents(events);

    if (dryRun) {
        renderDryRun(derived);
        maybeAppendLearnableEvent({
            type: "learn_ingest",
            ok: true,
            dryRun: true,
            derivedLessons: derived.map((lesson) => lesson.id),
        });
        return { ok: true, dryRun: true };
    }

    const pendingPath = writePendingLessonsFile(derived);
    console.log("Learn Ingest");
    console.log("");
    console.log(`- wrote_pending: ${pendingPath}`);
    console.log(`- derived: ${derived.length}`);
    for (const lesson of derived) {
        console.log(`  - ${lesson.id}`);
    }

    maybeAppendLearnableEvent({
        type: "learn_ingest",
        ok: true,
        dryRun: false,
        pendingPath,
        derivedLessons: derived.map((lesson) => lesson.id),
    });

    return { ok: true, pendingPath, derivedLessons: derived.map((lesson) => lesson.id) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runLearn(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exitCode = 1;
    });
}
