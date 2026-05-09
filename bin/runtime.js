#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listSnapshots, readSnapshot, diffSnapshots } from "../src/runtime/snapshot-reader.js";
import { explainRuntimeContract } from "../src/runtime/explain.js";
import { serializeJson } from "../src/runtime/serialize.js";
import { applySnapshotRetentionPolicy } from "../src/runtime/retention.js";

function usage() {
    console.log(`Usage:
  repo-context-kit runtime snapshot list [--limit N] [--json]
  repo-context-kit runtime snapshot read <snapshotId> [--json]
  repo-context-kit runtime snapshot explain <snapshotId> [--json]
  repo-context-kit runtime snapshot diff <from> <to> [--json]
  repo-context-kit runtime snapshot retention [--json]
`);
}

function getArgValue(args, name) {
    const index = args.indexOf(name);
    if (index === -1) return null;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return null;
    return value;
}

function toNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function formatTable(rows) {
    const header = "| snapshotId | runtimeVersion | timestamp | mode | taskId | status | risks | goal |";
    const sep = "|---|---|---|---|---|---|---|---|";
    const lines = [header, sep];
    for (const row of rows) {
        const risks = `b${row.blockerCount}/w${row.warningCount}/t${row.riskCount}`;
        const goal = row.goal ? String(row.goal).replace(/\|/g, "\\|") : "-";
        lines.push(`| ${row.snapshotId} | ${row.runtimeVersion} | ${row.timestamp} | ${row.mode} | ${row.taskId ?? "-"} | ${row.status ?? "-"} | ${risks} | ${goal} |`);
    }
    return lines.join("\n");
}

function renderDiff(diff) {
    if (!diff.ok) {
        return [
            "# Runtime Snapshot Diff",
            "",
            `ERROR ${diff.error}`,
        ].join("\n");
    }
    const changes = diff.changes;
    const nextActions = changes.nextActions;
    const lines = [
        "# Runtime Snapshot Diff",
        "",
        `- from: ${diff.from}`,
        `- to: ${diff.to}`,
        "",
        "## Changes",
        "",
        `- runtimeVersion: ${changes.runtimeVersion.from} -> ${changes.runtimeVersion.to}`,
        `- scanStatus: ${changes.scanStatus.from} -> ${changes.scanStatus.to}`,
        `- riskCount: ${changes.riskCount.from} -> ${changes.riskCount.to}`,
        `- blockerCount: ${changes.blockerCount.from} -> ${changes.blockerCount.to}`,
        `- warningCount: ${changes.warningCount.from} -> ${changes.warningCount.to}`,
        `- worksetSize: ${changes.worksetSize.from} -> ${changes.worksetSize.to}`,
        `- taskId: ${changes.task.id.from ?? "-"} -> ${changes.task.id.to ?? "-"}`,
        `- taskTitle: ${changes.task.title.from ?? "-"} -> ${changes.task.title.to ?? "-"}`,
    ];
    if (nextActions.added.length || nextActions.removed.length) {
        lines.push("");
        lines.push("## NextActions");
        lines.push("");
        lines.push(nextActions.added.length ? `- added:\n${nextActions.added.map((x) => `  - ${x}`).join("\n")}` : "- added: none");
        lines.push(nextActions.removed.length ? `- removed:\n${nextActions.removed.map((x) => `  - ${x}`).join("\n")}` : "- removed: none");
    }
    return lines.join("\n");
}

export async function runRuntime(args = []) {
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? "help";
    if (subcommand === "help" || args.includes("--help")) {
        usage();
        return { output: null };
    }
    if (subcommand !== "snapshot") {
        console.error("Unknown runtime command.");
        usage();
        process.exitCode = 1;
        return { output: null };
    }
    const rest = args.slice(args.indexOf("snapshot") + 1);
    const action = rest.find((arg) => !arg.startsWith("--")) ?? "help";
    const json = rest.includes("--json");
    const limit = toNumber(getArgValue(rest, "--limit"), 20);
    const repoRoot = process.cwd();

    if (action === "list") {
        const snapshots = listSnapshots({ repoRoot, limit });
        if (json) {
            console.log(serializeJson({ snapshots: snapshots.map(({ contract, validation, ...row }) => row) }));
            return { output: null };
        }
        const rows = snapshots.map(({ contract, validation, ...row }) => row);
        const output = [
            "# Runtime Snapshots",
            "",
            `- newest_first: true`,
            `- limit: ${Math.min(100, Math.max(1, Math.floor(limit)))}`,
            "",
            formatTable(rows),
        ].join("\n");
        console.log(output.trimEnd());
        return { output };
    }

    if (action === "read") {
        const snapshotId = rest[rest.indexOf(action) + 1];
        if (!snapshotId) {
            usage();
            process.exitCode = 1;
            return { output: null };
        }
        const snapshot = readSnapshot({ repoRoot, snapshotId });
        if (!snapshot) {
            console.error("ERROR Snapshot not found.");
            process.exitCode = 1;
            return { output: null };
        }
        if (json) {
            console.log(serializeJson({
                snapshotId: snapshot.snapshotId,
                runtimeVersion: snapshot.runtimeVersion,
                timestamp: snapshot.timestamp,
                mode: snapshot.mode,
                goal: snapshot.goal,
                taskId: snapshot.taskId,
                status: snapshot.status,
                riskCount: snapshot.riskCount,
                blockerCount: snapshot.blockerCount,
                warningCount: snapshot.warningCount,
                contract: snapshot.contract,
                validation: snapshot.validation,
            }));
            return { output: null };
        }
        const output = [
            "# Runtime Snapshot",
            "",
            `- snapshotId: ${snapshot.snapshotId}`,
            `- runtimeVersion: ${snapshot.runtimeVersion}`,
            `- timestamp: ${snapshot.timestamp}`,
            `- mode: ${snapshot.mode}`,
            `- taskId: ${snapshot.taskId ?? "-"}`,
            `- status: ${snapshot.status ?? "-"}`,
            `- risks: blocker=${snapshot.blockerCount} warning=${snapshot.warningCount} total=${snapshot.riskCount}`,
            snapshot.goal ? `- goal: ${snapshot.goal}` : null,
            "",
            "## Contract",
            "",
            serializeJson(snapshot.contract).trimEnd(),
        ].filter(Boolean).join("\n");
        console.log(output.trimEnd());
        return { output };
    }

    if (action === "explain") {
        const snapshotId = rest[rest.indexOf(action) + 1];
        if (!snapshotId) {
            usage();
            process.exitCode = 1;
            return { output: null };
        }
        const snapshot = readSnapshot({ repoRoot, snapshotId });
        if (!snapshot) {
            console.error("ERROR Snapshot not found.");
            process.exitCode = 1;
            return { output: null };
        }
        const explain = explainRuntimeContract(snapshot.contract).trimEnd();
        if (json) {
            console.log(serializeJson({ snapshotId, runtimeVersion: snapshot.runtimeVersion, timestamp: snapshot.timestamp, mode: snapshot.mode, explain }));
            return { output: null };
        }
        const output = [
            "# Runtime Snapshot Explain",
            "",
            `- snapshotId: ${snapshot.snapshotId}`,
            `- runtimeVersion: ${snapshot.runtimeVersion}`,
            `- timestamp: ${snapshot.timestamp}`,
            `- mode: ${snapshot.mode}`,
            "",
            explain,
        ].join("\n");
        console.log(output.trimEnd());
        return { output };
    }

    if (action === "diff") {
        const from = rest[rest.indexOf(action) + 1];
        const to = rest[rest.indexOf(action) + 2];
        if (!from || !to) {
            usage();
            process.exitCode = 1;
            return { output: null };
        }
        const diff = diffSnapshots({ repoRoot, from, to });
        if (json) {
            console.log(serializeJson(diff));
            return { output: null };
        }
        const output = renderDiff(diff);
        if (!diff.ok) {
            console.error(output.trimEnd());
            process.exitCode = 1;
            return { output: null };
        }
        console.log(output.trimEnd());
        return { output };
    }

    if (action === "retention") {
        const report = applySnapshotRetentionPolicy({ repoRoot });
        if (json) {
            console.log(serializeJson(report));
            return { output: null };
        }
        const output = [
            "# Runtime Snapshot Retention",
            "",
            `- snapshots_count: ${report.count ?? "unknown"}`,
            report.oldestTimestamp ? `- oldest: ${report.oldestTimestamp}` : "- oldest: -",
            report.warnings?.length ? `- warnings:\n${report.warnings.map((w) => `  - ${w}`).join("\n")}` : "- warnings: none",
        ].join("\n");
        console.log(output.trimEnd());
        return { output };
    }

    console.error("Unknown runtime snapshot command.");
    usage();
    process.exitCode = 1;
    return { output: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runRuntime(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
