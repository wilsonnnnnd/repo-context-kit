#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { orchestrateAuto } from "../src/auto/orchestrator.js";
import { validateRuntimeContract } from "../src/runtime/runtime-schema.js";
import { serializeJson, serializeRuntimeContract } from "../src/runtime/serialize.js";

function usage() {
    console.log(`Usage:
  repo-context-kit auto --goal "<user goal>" [--dry-run] [--json] [--deep]
  repo-context-kit auto --from-doc <path> [--dry-run] [--json] [--deep]
`);
}

function getArgValue(args, name) {
    const index = args.indexOf(name);
    if (index === -1) {
        return null;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        return null;
    }
    return value;
}

function formatScan(scan) {
    const status = scan?.status ?? "-";
    const plan = Array.isArray(scan?.plan) ? scan.plan : [];
    const planLines = plan.length ? plan.map((item) => `- ${item}`).join("\n") : "- (none)";
    return [
        "## Scan",
        "",
        `- status: ${status}`,
        "",
        "### Plan",
        "",
        planLines,
    ].join("\n");
}

function formatWorkset(workset) {
    const mode = workset?.mode ?? "-";
    const files = Array.isArray(workset?.files) ? workset.files : [];
    const fileLines = files.length ? files.map((file) => `- ${file}`).join("\n") : "- (none)";
    const summary = String(workset?.summary ?? "").trim();
    const blocks = [];
    blocks.push("## Workset");
    blocks.push("");
    blocks.push(`- mode: ${mode}`);
    blocks.push("");
    blocks.push("### Files");
    blocks.push("");
    blocks.push(fileLines);
    if (summary) {
        blocks.push("");
        blocks.push("### File Summary References");
        blocks.push("");
        blocks.push(summary);
    }
    return blocks.join("\n");
}

export async function runAuto(args = []) {
    if (args.includes("--help") || args.includes("help")) {
        usage();
        return;
    }

    const goal = getArgValue(args, "--goal");
    const fromDoc = getArgValue(args, "--from-doc");
    const dryRun = args.includes("--dry-run");
    const json = args.includes("--json");
    const deep = args.includes("--deep");

    if ((goal && fromDoc) || (!goal && !fromDoc)) {
        console.error("ERROR Provide exactly one of --goal or --from-doc.");
        usage();
        process.exitCode = 1;
        return;
    }

    const result = await orchestrateAuto({
        rootDir: process.cwd(),
        goal: goal || null,
        fromDocPath: fromDoc || null,
        deep,
        dryRun,
        allowWrite: !dryRun,
    });

    if (!result.ok) {
        if (json) {
            console.log(serializeJson({ command: "auto", goal: goal || null, fromDoc: fromDoc || null, ok: false, error: result.error, nextActions: result.nextActions ?? [] }));
        } else {
            console.error(`ERROR ${result.error}`);
            console.error("");
            console.error("Next:");
            for (const action of result.nextActions ?? []) {
                console.error(`- ${action}`);
            }
        }
        process.exitCode = 1;
        return;
    }

    if (json) {
        const validation = validateRuntimeContract(result.contract);
        if (!validation.valid) {
            process.exitCode = 1;
            console.log(serializeJson({ command: "auto", goal: goal || null, fromDoc: fromDoc || null, ok: false, error: "Invalid runtime contract.", validation }));
            return;
        }
        if (fromDoc) {
            console.log(
                serializeJson({
                    command: "auto",
                    ok: true,
                    fromDoc,
                    deep,
                    dryRun,
                    planning: result.planning ?? null,
                    selectedTask: result.selectedTask ?? null,
                    runtimeContract: result.contract,
                    risks: result.contract?.risks ?? [],
                    nextActions: result.contract?.nextActions ?? [],
                }),
            );
            return;
        }
        console.log(serializeRuntimeContract(result.contract));
        return;
    }

    const contract = result.contract;
    const blocks = [];
    blocks.push("# AI Auto Workflow");
    blocks.push("");
    blocks.push(`- goal: ${contract.task?.goal || goal || "-"}`);
    blocks.push(`- taskId: ${contract.task?.id || "-"}`);
    if (result.createdTaskFile) {
        blocks.push(`- taskFile: ${result.createdTaskFile}`);
    }
    if (result.snapshotId) {
        blocks.push(`- snapshotId: ${result.snapshotId}`);
    }
    if (contract.executionState?.pauseId) {
        blocks.push(`- pauseId: ${contract.executionState.pauseId}`);
    }
    blocks.push("");
    blocks.push(formatScan(contract.scan));
    blocks.push("");

    if (result.dryRun) {
        blocks.push("## Next");
        blocks.push("");
        blocks.push("- No files were written.");
        blocks.push("- Run without --dry-run to create a task and executor pause point.");
        blocks.push(`- Example: repo-context-kit auto --goal "${goal}" --json`);
        console.log(blocks.join("\n").trimEnd());
        return;
    }

    blocks.push(formatWorkset(contract.workset));
    blocks.push("");
    blocks.push("## Prompt");
    blocks.push("");
    blocks.push(String(contract.prompt ?? "").trimEnd());
    blocks.push("");
    blocks.push("## Next");
    blocks.push("");
    for (const action of contract.nextActions ?? []) {
        blocks.push(`- ${action}`);
    }

    console.log(blocks.join("\n").trimEnd());
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runAuto(process.argv.slice(2)).catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
