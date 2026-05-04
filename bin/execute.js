#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadExecutorState } from "../src/executor/state.js";
import {
    confirmPause,
    loadNextTask,
    loadTask,
    reset,
    syncTestResult,
} from "../src/executor/runner.js";

function usage() {
    console.log(`Usage:
  repo-context-kit execute status
  repo-context-kit execute next
  repo-context-kit execute run <taskId>
  repo-context-kit execute confirm <pauseId>
  repo-context-kit execute sync
  repo-context-kit execute reset
`);
}

function formatTask(task) {
    if (!task) {
        return ["- id: -", "- title: -", "- status: -"].join("\n");
    }
    return [
        `- id: ${task.id ?? "-"}`,
        `- title: ${task.title ?? "-"}`,
        `- status: ${task.status ?? "-"}`,
        `- file: ${task.file ?? "-"}`,
    ].join("\n");
}

function formatState(state) {
    return [
        "# Executor State",
        "",
        `- protocol: ${state?.protocol ?? "-"}`,
        `- taskId: ${state?.activeTaskId ?? "-"}`,
        `- phase: ${state?.phase ?? "-"}`,
        `- pauseId: ${state?.pauseId ?? "-"}`,
        `- next_action: ${state?.pauseType ?? "-"}`,
        `- message: ${state?.message ?? "-"}`,
        `- updatedAt: ${state?.updatedAt ?? "-"}`,
    ].join("\n");
}

function formatNextStepsFromState(state) {
    const lines = [];
    const taskId = state?.activeTaskId ?? null;
    const phase = state?.phase ?? null;
    const pauseId = state?.pauseId ?? null;

    if (pauseId && typeof pauseId === "string") {
        lines.push("Next:");
        lines.push(`repo-context-kit execute confirm ${pauseId}`);
    }

    if (phase === "testing" && taskId) {
        lines.push("");
        lines.push("Next (testing):");
        lines.push(`repo-context-kit gate confirm task ${taskId} --json`);
        lines.push(`repo-context-kit gate confirm tests ${taskId}`);
        lines.push(`repo-context-kit gate run-test ${taskId} --token <token>`);
        lines.push("repo-context-kit execute sync");
    }

    if (phase === "completed") {
        lines.push("");
        lines.push("Next:");
        lines.push("repo-context-kit execute next");
    }

    if (phase === "failed") {
        lines.push("");
        lines.push("Next:");
        lines.push("- Fix the task and re-run gate tests, then:");
        lines.push("  repo-context-kit execute sync");
    }

    return lines.length ? lines.join("\n") : "";
}

function formatHints(hints) {
    const list = Array.isArray(hints) ? hints.filter(Boolean) : [];
    if (!list.length) {
        return "";
    }
    return ["## Hints", "", ...list.map((hint) => `- ${hint}`)].join("\n");
}

function printExecutorResult(result) {
    const blocks = [];
    if (result?.task) {
        blocks.push("# Semi-Auto Executor");
        blocks.push("");
        blocks.push("## Task");
        blocks.push("");
        blocks.push(formatTask(result.task));
    }
    if (result?.taskSummary) {
        if (blocks.length) blocks.push("");
        blocks.push("## Task Summary");
        blocks.push("");
        blocks.push(String(result.taskSummary).trim());
    }
    if (result?.worksetSummary) {
        if (blocks.length) blocks.push("");
        blocks.push("## Context Summary");
        blocks.push("");
        blocks.push(String(result.worksetSummary).trim());
    }
    if (result?.state) {
        if (blocks.length) blocks.push("");
        blocks.push(formatState(result.state));
        const nextSteps = formatNextStepsFromState(result.state);
        if (nextSteps) {
            blocks.push("");
            blocks.push(nextSteps);
        }
    }
    if (result?.hints?.length) {
        if (blocks.length) blocks.push("");
        blocks.push(formatHints(result.hints));
    }
    console.log(blocks.join("\n").trimEnd());
}

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

export async function runExecute(args = []) {
    const subcommand = args[0];

    if (!subcommand || subcommand === "help" || subcommand === "--help") {
        usage();
        return;
    }

    if (subcommand === "status") {
        const state = loadExecutorState();
        const output = [formatState(state), "", formatNextStepsFromState(state)].join("\n").trimEnd();
        console.log(output);
        return;
    }

    if (subcommand === "reset") {
        const result = reset();
        if (!result.ok) {
            fail(result.error || "Failed to reset executor.");
            return;
        }
        console.log("OK Executor reset: .aidw/executor-state.json");
        printExecutorResult({ state: result.state });
        return;
    }

    if (subcommand === "run") {
        const taskId = args[1];
        if (!taskId) {
            fail("Missing task id.");
            usage();
            return;
        }
        const result = loadTask(taskId);
        if (!result.ok) {
            fail(result.error || "Failed to load task.");
            return;
        }
        printExecutorResult(result);
        return;
    }

    if (subcommand === "next") {
        const result = loadNextTask();
        if (!result.ok) {
            fail(result.error || "Failed to load next task.");
            return;
        }
        printExecutorResult(result);
        return;
    }

    if (subcommand === "confirm") {
        const pauseId = args[1];
        if (!pauseId) {
            fail("Missing pauseId.");
            usage();
            return;
        }
        const result = confirmPause(pauseId);
        if (!result.ok) {
            fail(result.error || "Failed to confirm pause.");
            return;
        }
        printExecutorResult(result);
        return;
    }

    if (subcommand === "sync") {
        const result = syncTestResult();
        if (!result.ok) {
            fail(result.error || "Failed to sync test result.");
            return;
        }
        const extra = [];
        if (result.status === "pending") {
            extra.push("## Sync Result");
            extra.push("");
            extra.push("- no test result found in context loop");
        }
        if (result.status === "completed") {
            extra.push("## Sync Result");
            extra.push("");
            extra.push("- test passed: executor marked task as completed");
        }
        if (result.status === "failed") {
            extra.push("## Sync Result");
            extra.push("");
            extra.push("- test failed: executor marked task as failed");
        }
        const blocks = [];
        blocks.push(...extra);
        blocks.push(formatState(result.state));
        const nextSteps = formatNextStepsFromState(result.state);
        if (nextSteps) {
            blocks.push("");
            blocks.push(nextSteps);
        }
        console.log(blocks.join("\n").trimEnd());
        return;
    }

    fail("Unknown execute command.");
    usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runExecute(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
