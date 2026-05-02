#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { runInit } from "./init.js";
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
  task new [title]
              Create an implementation-ready task file and update task/task.md
  ui          Start the local repo-context-kit web console

Init options:
  --dry-run   Show what init would create or skip without writing files
  --force     Recreate managed project context files without deleting unknown files

Scan options:
  --check     Check whether scan output is up to date without writing files
  --auto      Update project context without prompts or extra guidance

Global options:
  --help      Show this help message
  --version   Show package version`);
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

    if (command === "ui") {
        await runUi();
        return;
    }

    console.error(`Unknown command: ${command}`);
    console.log("Usage:");
    console.log("  repo-context-kit init");
    console.log("  repo-context-kit scan");
    console.log("  repo-context-kit task new [title]");
    console.log("  repo-context-kit ui");
    process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
