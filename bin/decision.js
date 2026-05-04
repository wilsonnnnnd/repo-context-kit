#!/usr/bin/env node
import { pathToFileURL } from "url";
import path from "path";
import { listRecentLoopEvents } from "../src/loop/store.js";

function usage() {
    console.log(`Usage:
  repo-context-kit decision explain
`);
}

function formatList(items) {
    if (!items || items.length === 0) {
        return "- None";
    }
    return items.map((item) => `- ${item}`).join("\n");
}

function mapReasonCode(code) {
    const value = String(code ?? "").trim().toUpperCase();
    if (!value) return null;
    const mapping = {
        RECENT_TEST_FAIL: "last test failed",
        FAILURE_STREAK: "failure streak detected",
        REQUIRE_RCA: "root cause analysis required",
        HIGH_RISK_AREAS: "task touched high-risk areas",
        STALE_SCAN: "generated context may be stale",
    };
    return mapping[value] ?? null;
}

function renderDecisionExplain(events) {
    const decision = events.find((event) => event?.type === "budget_decision") ?? null;
    const lastTest = events.find((event) => event?.type === "test") ?? null;

    if (!decision) {
        return [
            "Decision Explain",
            "",
            "- No decision events found.",
            "",
            "No files were written.",
        ].join("\n");
    }

    const upgrades = Array.isArray(decision.upgradesApplied) ? decision.upgradesApplied : [];
    const reasonCodes = Array.isArray(decision.reasonCodes) ? decision.reasonCodes : [];
    const evidence = Array.isArray(decision.evidence) ? decision.evidence : [];
    const whyLines = [
        ...reasonCodes
            .map((code) => mapReasonCode(code))
            .filter(Boolean),
        ...reasonCodes.map((code) => `reason_code: ${String(code)}`),
    ];

    const evidenceLines = [
        ...evidence.map((item) => String(item)),
        ...(lastTest
            ? [
                  `last_test_exit: ${lastTest.exitCode ?? "-"}`,
                  lastTest.command ? `last_test_command: ${lastTest.command}` : null,
              ].filter(Boolean)
            : []),
    ];

    return [
        "Decision Explain",
        "",
        "Decision:",
        `- mode: ${decision.mode ?? "-"}`,
        `- decision: ${decision.decision ?? "-"}`,
        `- upgrades: ${upgrades.length ? upgrades.join(", ") : "-"}`,
        decision.command ? `- command: ${decision.command}` : null,
        "",
        "Why:",
        formatList([...new Set(whyLines)]),
        "",
        "Evidence:",
        formatList(evidenceLines),
        "",
        "How to override:",
        formatList([
            "use --budget off to disable automatic expansion",
            "use --budget full to force full expansion",
            "use --verbose to print full warnings",
            "run repo-context-kit scan --auto to refresh context",
        ]),
        "",
        "No files were written.",
    ]
        .filter(Boolean)
        .join("\n");
}

export async function runDecision(args = []) {
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? "explain";

    if (!subcommand || subcommand === "help" || subcommand === "--help") {
        usage();
        return { output: null };
    }

    if (subcommand !== "explain") {
        console.error("Unknown decision command.");
        usage();
        process.exitCode = 1;
        return { output: null };
    }

    const events = listRecentLoopEvents({ limit: 80, maxBytes: 1_000_000 });
    const output = renderDecisionExplain(events);
    console.log(output.trimEnd());
    return { output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runDecision(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exitCode = 1;
    });
}

