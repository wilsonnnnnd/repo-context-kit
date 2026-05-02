#!/usr/bin/env node
import { evaluateContextLoop } from "../src/loop/analyze.js";

function formatList(items) {
    if (!items || items.length === 0) {
        return "- None";
    }
    return items.map((item) => `- ${item}`).join("\n");
}

function formatCommandStats(entries = []) {
    if (!entries.length) {
        return "- None";
    }
    return entries
        .map((entry) => `- ${entry.command}: fail=${entry.fail}, pass=${entry.pass}`)
        .join("\n");
}

export async function runLoop(args = []) {
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? "report";
    const taskFlagIndex = args.indexOf("--task");
    const taskId = taskFlagIndex !== -1 ? args[taskFlagIndex + 1] : null;

    if (subcommand !== "report") {
        console.error("Unknown loop command.");
        console.log("Usage:");
        console.log("  repo-context-kit loop report [--task <taskId>]");
        process.exitCode = 1;
        return { output: null };
    }

    const result = evaluateContextLoop({ taskId });

    const output = [
        "# Context Loop Report",
        "",
        "## Constraints",
        "",
        `- blockNewTask: ${result.constraints.blockNewTask ? "true" : "false"}`,
        `- blockReason: ${result.constraints.blockReason ?? "-"}`,
        `- unstable: ${result.constraints.unstable ? "true" : "false"}`,
        `- requireRootCauseAnalysis: ${result.constraints.requireRootCauseAnalysis ? "true" : "false"}`,
        `- rootCauseCommand: ${result.constraints.rootCauseCommand ?? "-"}`,
        "",
        "## Patterns",
        "",
        `- recentTestCount: ${result.patterns.recentTestCount}`,
        `- failureStreak: ${result.patterns.failureStreak}`,
        "",
        "### Top Failing Commands",
        "",
        formatCommandStats(result.patterns.topFailingCommands),
        "",
        "## Task Mutations (preview)",
        "",
        "### Risk",
        "",
        formatList(result.mutations.riskItems),
        "",
        "### Test Strategy",
        "",
        formatList(result.mutations.testStrategyItems),
        "",
        "### Requirements",
        "",
        formatList(result.mutations.requirementItems),
        "",
        "### Acceptance Criteria",
        "",
        formatList(result.mutations.acceptanceCriteriaItems),
    ].join("\n");

    console.log(output.trimEnd());
    return { output };
}

