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
import {
    CONTEXT_PROJECT_MD_PATH,
    CONTEXT_SYSTEM_OVERVIEW_PATH,
} from "../src/scan/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
    console.log(`Usage:
  repo-context-kit [command] [options]

Commands:
  init        Copy workflow template into the current repository
  scan        Update ${CONTEXT_PROJECT_MD_PATH}, ${CONTEXT_SYSTEM_OVERVIEW_PATH}, and indexes
  context brief
              Print concise project-level AI context
  context next-task
              Print the next active task context
  context workset <taskId> [--deep]
              Print bounded implementation context for one task
  context workset <taskId> --digest
              Print a token-efficient digest of the task workset
  context workset <taskId> --full
              Disable digest output for the workset
  gate status
              Show confirmation gate state
  gate confirm task <taskId>
              Confirm one task and generate a time-limited gate token
  gate confirm tests <taskId>
              Confirm test execution for the selected task
  gate run-test <taskId> --token <token>
              Run the selected task's test command when tests are confirmed and token is valid
  loop report [--task <taskId>]
              Print context-loop constraints and patterns
  loop run [--task <taskId>]
              Alias for loop report (does not execute commands)
  task new [title]
              Create an implementation-ready task file and update task/task.md
  task generate
              Print a docs→tasks scaffold (does not auto-edit code)
  task run
              Print a tasks→execute→commit→PR scaffold (does not auto-edit code)
  task checklist <taskId> [--deep]
              Print a bounded test and verification checklist for one task
  task pr <taskId> [--deep]
              Print a bounded pull request description for one task
  task prompt <taskId> [--deep]
              Print an AI-ready implementation prompt for one task
              Options: --compact --full-detail --full-workset
  ui          Start the local repo-context-kit web console
  budget show Print the current effective budget mode (env-based)

Task-driven workflow:
  context brief -> context next-task -> context workset <taskId>
  task prompt <taskId> -> task checklist <taskId> -> task pr <taskId>
  gate confirm task <taskId> -> gate confirm tests <taskId> -> gate run-test <taskId> --token <token>
  loop report
  budget show

Init options:
  --dry-run   Show what init would create or skip without writing files
  --force     Recreate managed project context files without deleting unknown files

Scan options:
  --check     Check whether scan output is up to date without writing files
  --auto      Update project context without prompts or extra guidance

Global options:
  --help      Show this help message
  --version   Show package version

Budget options (context/task):
  --budget <mode>  Token budget mode: off | auto | full
                  (also via REPO_CONTEXT_KIT_BUDGET)`);
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
        ].filter(Boolean);

        if (scanModes.length > 1) {
            console.error("Only one scan mode can be used at a time.");
            process.exit(1);
        }

        await runScan({ mode: scanModes[0] || "normal" });
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

    if (command === "ui") {
        await runUi();
        return;
    }

    console.error(`Unknown command: ${command}`);
    console.log("Usage:");
    console.log("  repo-context-kit init");
    console.log("  repo-context-kit scan");
    console.log("  repo-context-kit context brief");
    console.log("  repo-context-kit context next-task");
    console.log("  repo-context-kit context workset <taskId> [--deep]");
    console.log("  repo-context-kit gate status");
    console.log("  repo-context-kit gate confirm task <taskId>");
    console.log("  repo-context-kit gate confirm tests <taskId>");
    console.log("  repo-context-kit gate run-test <taskId> --token <token>");
    console.log("  repo-context-kit loop report [--task <taskId>]");
    console.log("  repo-context-kit budget show");
    console.log("  repo-context-kit task new [title]");
    console.log("  repo-context-kit task checklist <taskId> [--deep]");
    console.log("  repo-context-kit task pr <taskId> [--deep]");
    console.log("  repo-context-kit task prompt <taskId> [--deep]");
    console.log("  repo-context-kit ui");
    process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
