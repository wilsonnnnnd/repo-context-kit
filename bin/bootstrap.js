#!/usr/bin/env node
import fs from "node:fs";
import { planBootstrapRuntime } from "../src/bootstrap/plan.js";
import { applyBootstrapPlan } from "../src/bootstrap/apply.js";
import { inspectBootstrapPlan } from "../src/bootstrap/inspect.js";
import { serializeJson } from "../src/runtime/serialize.js";

function usage() {
    console.log(`Usage:
  repo-context-kit bootstrap plan --from-doc <path> [--write-mode create-only|overwrite-managed] [--json] [--explain]
  repo-context-kit bootstrap inspect --from-plan <path|-> [--json]
  repo-context-kit bootstrap apply --from-plan <path|-> --confirm <token> --enable-write [--json]
`);
}

function getArgValue(args, name) {
    const index = args.indexOf(name);
    if (index === -1) return null;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return null;
    return value;
}

function hasFlag(args, name) {
    return args.includes(name);
}

function writePlanFile(plan, planPath) {
    const filePath = String(planPath ?? "").trim();
    if (!filePath) return null;
    fs.writeFileSync(filePath, serializeJson(plan).trimEnd() + "\n", "utf-8");
    return filePath;
}

export async function runBootstrap(args = []) {
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? "help";
    const json = hasFlag(args, "--json");
    if (subcommand === "help" || hasFlag(args, "--help")) {
        usage();
        return { output: null };
    }

    if (subcommand === "plan") {
        const fromDoc = getArgValue(args, "--from-doc");
        if (!fromDoc) {
            usage();
            process.exitCode = 1;
            return { output: null };
        }
        const writeMode = getArgValue(args, "--write-mode") ?? "create-only";
        const explain = hasFlag(args, "--explain");
        const outPath = getArgValue(args, "--out");
        const result = planBootstrapRuntime({ repoRoot: process.cwd(), fromDoc, writeMode });
        if (outPath) {
            writePlanFile({ ...result, plan: result.plan, contract: result.contract }, outPath);
        }
        if (json) {
            const payload = {
                ok: true,
                command: "bootstrap",
                action: "plan",
                repoRoot: result.repoRoot,
                fromDoc: result.fromDoc,
                writeMode: result.plan.writeMode,
                digest: result.digest,
                pauseToken: result.pauseToken,
                scaffoldHints: result.scaffoldHints,
                plan: result.plan,
                contract: result.contract,
                risks: result.risks,
                nextActions: result.nextActions,
                explain: explain ? result.explain : undefined,
            };
            console.log(serializeJson(payload));
            return { output: null, result: payload };
        }
        const lines = [
            "OK Bootstrap plan generated",
            "",
            `- fromDoc: ${result.fromDoc}`,
            `- writeMode: ${result.plan.writeMode}`,
            `- digest: ${result.digest}`,
            `- pauseToken: ${result.pauseToken}`,
            "",
            "Next:",
            `* Apply with: repo-context-kit bootstrap apply --from-plan <plan.json> --confirm ${result.pauseToken} --enable-write`,
            "* Then: repo-context-kit scan",
        ];
        if (Array.isArray(result.scaffoldHints) && result.scaffoldHints.length) {
            lines.push("");
            lines.push("Scaffold Hints:");
            for (const hint of result.scaffoldHints.slice(0, 3)) {
                const command = String(hint?.command ?? "").trim();
                const args = Array.isArray(hint?.args) ? hint.args.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
                if (command) {
                    lines.push(`* ${[command, ...args].join(" ").trim()}`);
                }
            }
        }
        if (explain) {
            lines.push("");
            lines.push("Explain:");
            lines.push(`* extractedSections: ${(result.explain?.extractedSections ?? []).join(", ") || "-"}`);
        }
        console.log(lines.join("\n").trimEnd());
        return { output: lines.join("\n") };
    }

    if (subcommand === "inspect") {
        const fromPlan = getArgValue(args, "--from-plan") ?? getArgValue(args, "--plan");
        if (!fromPlan) {
            usage();
            process.exitCode = 1;
            return { output: null };
        }
        const inspected = inspectBootstrapPlan({ planSource: fromPlan });
        if (json) {
            console.log(inspected.output);
            return { output: null };
        }
        const lines = [
            "Bootstrap Plan Inspect",
            "",
            `- version: ${inspected.bootstrapVersion}`,
            `- writeMode: ${inspected.writeMode}`,
            `- digest: ${inspected.digest ?? "-"}`,
            `- pauseToken: ${inspected.pauseToken ?? "-"}`,
            "",
            `- ops: ${inspected.counts.ops} (mkdir=${inspected.counts.mkdir} writeFile=${inspected.counts.writeFile} copyTemplate=${inspected.counts.copyTemplate} snapshot=${inspected.counts.snapshot})`,
        ];
        console.log(lines.join("\n").trimEnd());
        return { output: lines.join("\n") };
    }

    if (subcommand === "apply") {
        const fromPlan = getArgValue(args, "--from-plan") ?? getArgValue(args, "--plan");
        const confirm = getArgValue(args, "--confirm");
        const enableWrite = hasFlag(args, "--enable-write");
        if (!fromPlan || !confirm) {
            usage();
            process.exitCode = 1;
            return { output: null };
        }
        try {
            const applied = applyBootstrapPlan({ repoRoot: process.cwd(), planSource: fromPlan, enableWrite, confirm });
            if (json) {
                console.log(
                    serializeJson({
                        ok: true,
                        command: "bootstrap",
                        action: "apply",
                        repoRoot: applied.repoRoot,
                        snapshotId: applied.snapshotId,
                        summary: applied.summary,
                        applyReport: applied.applyReport,
                        contract: applied.contract,
                    }),
                );
                return { output: null };
            }
            const lines = [
                "OK Bootstrap apply completed",
                "",
                `- snapshotId: ${applied.snapshotId}`,
                "",
                "Next:",
                "* Run repo-context-kit scan",
            ];
            console.log(lines.join("\n").trimEnd());
            return { output: lines.join("\n") };
        } catch (error) {
            const message = error?.message ? String(error.message) : String(error);
            console.error(`ERROR ${message}`);
            process.exitCode = 1;
            return { output: null };
        }
    }

    console.error("Unknown bootstrap command.");
    usage();
    process.exitCode = 1;
    return { output: null };
}
