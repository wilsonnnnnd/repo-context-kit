#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { runContext } from "./context.js";
import { runBudget } from "./budget.js";
import { runGate } from "./gate.js";
import { runInit } from "./init.js";
import { runLoop } from "./loop.js";
import { runScan } from "./scan.js";
import { runTask } from "./task.js";
import { runUi } from "./ui.js";
import { runExecute } from "./execute.js";
import { runGithub } from "./github.js";
import { runDecision } from "./decision.js";
import { runLearn } from "./learn.js";
import { runCheck } from "./check.js";
import { runAuto } from "./auto.js";
import { runRuntime } from "./runtime.js";
import { runBootstrap } from "./bootstrap.js";
import {
    CONTEXT_PROJECT_MD_PATH,
    CONTEXT_SYSTEM_OVERVIEW_PATH,
} from "../src/scan/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
    console.log(`Usage:
  repo-context-kit <command> [options]

Getting Started:
  init                     Copy workflow template into the current repository
  scan                     Update ${CONTEXT_PROJECT_MD_PATH}, ${CONTEXT_SYSTEM_OVERVIEW_PATH}, and indexes
  auto --goal "<goal>"      Create a bounded plan (task + workset + runtime contract); no source edits
  auto --from-doc <path>    Create a bounded plan from a design doc (deterministic extraction; no source edits)
  task generate --from-doc  Generate task files from a design doc (bounded, deterministic)

Core Runtime:
  runtime snapshot          Browse snapshots (list/read/explain/diff/retention)
  bootstrap                 New project bootstrap runtime (plan/inspect/apply)
  task                      Create tasks and print prompts/checklists/PR text
  context                   Print bounded task context (worksets)
  execute                   Pause/confirm flow (does not edit code)
  gate                      Confirmation gate and allowlisted test runs

Advanced Runtime:
  learn                     Derive lessons from failures
  check                     Enforce lessons-derived constraints
  decision                  Explain recent runtime decisions
  budget                    Show budget policy
  loop                      Report loop signals (no command execution)
  github                    GitHub helpers (token stored in user config)
  ui                        Local web console

Global options:
  --help                    Show this help message
  --version                 Show package version

Init options:
  --dry-run                 Show what init would create without writing files
  --force                   Recreate managed files without deleting unknown files

Scan options:
  --check                   Check whether scan output is up to date (no writes)
  --plan                    Preview which files scan would update (no writes)
  --auto                    Update project context without prompts

Budget options (context/task):
  --budget <mode>           off | auto | full (or REPO_CONTEXT_KIT_BUDGET)`);
}

function getVersion() {
    const packagePath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

    return pkg.version;
}

export async function main(args = process.argv.slice(2)) {
    const command = args.find((arg) => !arg.startsWith("--")) ?? "init";

    if (args.includes("--help")) {
        printHelp();
        return;
    }

    if (args.includes("--version")) {
        console.log(getVersion());
        return;
    }

    if (command === "init") {
        await runInit({
            dryRun: args.includes("--dry-run"),
            force: args.includes("--force"),
        });
        return;
    }

    if (command === "scan") {
        const scanModes = [
            args.includes("--check") ? "check" : null,
            args.includes("--auto") ? "auto" : null,
            args.includes("--plan") ? "plan" : null,
        ].filter(Boolean);

        if (scanModes.length > 1) {
            console.error("Only one scan mode can be used at a time.");
            process.exit(1);
        }

        await runScan({ mode: scanModes[0] || "normal" });
        return;
    }

    if (command === "auto") {
        const commandIndex = args.indexOf(command);
        await runAuto(args.slice(commandIndex + 1));
        return;
    }

    if (command === "task") {
        const commandIndex = args.indexOf(command);
        await runTask(args.slice(commandIndex + 1));
        return;
    }

    if (command === "context") {
        const commandIndex = args.indexOf(command);
        await runContext(args.slice(commandIndex + 1));
        return;
    }

    if (command === "budget") {
        const commandIndex = args.indexOf(command);
        await runBudget(args.slice(commandIndex + 1));
        return;
    }

    if (command === "decision") {
        const commandIndex = args.indexOf(command);
        await runDecision(args.slice(commandIndex + 1));
        return;
    }

    if (command === "learn") {
        const commandIndex = args.indexOf(command);
        await runLearn(args.slice(commandIndex + 1));
        return;
    }

    if (command === "check") {
        const commandIndex = args.indexOf(command);
        await runCheck(args.slice(commandIndex + 1));
        return;
    }

    if (command === "gate") {
        const commandIndex = args.indexOf(command);
        await runGate(args.slice(commandIndex + 1));
        return;
    }

    if (command === "loop") {
        const commandIndex = args.indexOf(command);
        await runLoop(args.slice(commandIndex + 1));
        return;
    }

    if (command === "execute") {
        const commandIndex = args.indexOf(command);
        await runExecute(args.slice(commandIndex + 1));
        return;
    }

    if (command === "github") {
        const commandIndex = args.indexOf(command);
        await runGithub(args.slice(commandIndex + 1));
        return;
    }

    if (command === "ui") {
        await runUi();
        return;
    }

    if (command === "runtime") {
        const commandIndex = args.indexOf(command);
        await runRuntime(args.slice(commandIndex + 1));
        return;
    }

    if (command === "bootstrap") {
        const commandIndex = args.indexOf(command);
        await runBootstrap(args.slice(commandIndex + 1));
        return;
    }

    console.error(`Unknown command: ${command}`);
    console.log("Usage:");
    console.log("  repo-context-kit init");
    console.log("  repo-context-kit scan");
    console.log("  repo-context-kit auto --goal \"<user goal>\" [--dry-run] [--json] [--deep]");
    console.log("  repo-context-kit context brief");
    console.log("  repo-context-kit context next-task");
    console.log("  repo-context-kit context workset <taskId> [--deep]");
    console.log("  repo-context-kit gate status");
    console.log("  repo-context-kit gate confirm task <taskId>");
    console.log("  repo-context-kit gate confirm tests <taskId>");
    console.log("  repo-context-kit gate run-test <taskId> --token <token>");
    console.log("  repo-context-kit loop report [--task <taskId>]");
    console.log("  repo-context-kit budget show");
    console.log("  repo-context-kit decision explain");
    console.log("  repo-context-kit learn ingest --dry-run");
    console.log("  repo-context-kit learn approve");
    console.log("  repo-context-kit check --explain");
    console.log("  repo-context-kit check --strict");
    console.log("  repo-context-kit check --warn-only");
    console.log("  repo-context-kit task new [title] [--dry-run]");
    console.log("  repo-context-kit task checklist <taskId> [--deep]");
    console.log("  repo-context-kit task pr <taskId> [--deep]");
    console.log("  repo-context-kit task cleanup <taskId> [--dry-run]");
    console.log("  repo-context-kit task prompt <taskId> [--deep]");
    console.log("  repo-context-kit github auth status");
    console.log("  repo-context-kit github auth set --token <token>");
    console.log("  repo-context-kit github auth set --stdin");
    console.log("  repo-context-kit github auth unset");
    console.log("  repo-context-kit execute status");
    console.log("  repo-context-kit execute next");
    console.log("  repo-context-kit execute run <taskId>");
    console.log("  repo-context-kit execute confirm <pauseId>");
    console.log("  repo-context-kit execute sync");
    console.log("  repo-context-kit execute reset");
    console.log("  repo-context-kit ui");
    console.log("  repo-context-kit runtime snapshot list");
    console.log("  repo-context-kit --help");
    process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
