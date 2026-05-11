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
import { runHygiene } from "./hygiene.js";
import { runMetrics } from "./metrics.js";
import { loadGateState } from "../src/gate/state.js";
import { computeScanCheckState } from "../src/scan/index.js";
import { getRegistryStatusBreakdown, parseTaskRegistry } from "../src/scan/task-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_COMMAND_SURFACE = [
    { command: "init", description: "Install the repo workflow files" },
    { command: "scan", description: "Build or refresh the repository map" },
    { command: "bootstrap doctor", description: "Run the read-only preflight risk gate" },
    { command: "task prompt <taskId>", description: "Print bounded AI implementation context" },
    { command: "task checklist <taskId>", description: "Prepare the verification checklist" },
    { command: "task pr <taskId>", description: "Prepare review/PR text" },
    { command: "scan --check", description: "Check generated context freshness" },
    { command: "bootstrap doctor --check", description: "Check preflight policy for CI/local gates" },
];

const ADVANCED_COMMAND_GROUPS = [
    {
        title: "Advanced Task Setup",
        commands: [
            "status",
            'task new "Task title" [--force] [--dry-run]',
            "task from-doc <path> [--dry-run] [--json]",
            "context brief",
            "context doctor [--json]",
            "context trace <taskId>",
            "context budget",
            "context next",
            "context for <taskId> [--compact|--digest] [--deep]",
            "metrics",
        ],
    },
    {
        title: "Runtime Controls",
        commands: [
            "gate status|reset",
            "gate confirm task <taskId> [--ttl-minutes N] [--json]",
            "gate confirm tests <taskId> [--json]",
            "gate run-test <taskId> --token <token>",
            "execute status|next|run <taskId>|confirm <pauseId>|sync|reset",
            "loop report [--task <taskId>]",
            "budget show",
            "decision explain",
            "learn ingest [--dry-run]",
            "learn approve",
            "check [--explain] [--strict|--warn-only]",
        ],
    },
    {
        title: "Infrastructure",
        commands: [
            "runtime snapshot list|read|explain|diff|retention",
            "bootstrap plan|doctor|inspect|explain|diff|apply",
            "hygiene scan|plan|apply",
            "github auth status|set|unset",
            "ui",
        ],
    },
];

function formatDefaultCommandSurface() {
    return DEFAULT_COMMAND_SURFACE.map((item) => `  ${item.command.padEnd(24)} ${item.description}`).join("\n");
}

function printHelp() {
    console.log(`Usage:
  repo-context-kit <command> [options]

AI Preflight Journey:
${formatDefaultCommandSurface()}

Global options:
  --help                    Show this help message
  --version                 Show package version
  --help --advanced         Show all commands

More commands are available with: repo-context-kit --help --advanced`);
}

function printAdvancedHelp() {
    const advancedGroups = ADVANCED_COMMAND_GROUPS.map((group) => [
        `${group.title}:`,
        ...group.commands.map((command) => `  ${command}`),
    ].join("\n")).join("\n\n");
    console.log(`Usage:
  repo-context-kit <command> [options]

Default Journey:
${DEFAULT_COMMAND_SURFACE.map((item) => `  ${item.command}`).join("\n")}

${advancedGroups}

MCP:
  repo-context-kit-mcp [--root <path>] [--enable-write] [--enable-tests] [--enable-external-side-effects]

Context detail options:
  --budget <mode>           off | auto | full (or REPO_CONTEXT_KIT_BUDGET)`);
}

function getVersion() {
    const packagePath = path.resolve(__dirname, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

    return pkg.version;
}

function printStatus() {
    const registry = parseTaskRegistry();
    const breakdown = getRegistryStatusBreakdown(registry.tasks);
    const gate = loadGateState();
    let scanKnown = false;
    let scanFresh = false;

    try {
        const { update } = computeScanCheckState();
        scanKnown = true;
        scanFresh = !update.changed;
    } catch {
        scanKnown = false;
    }

    const next = registry.tasks.find((task) => ["in_progress", "todo"].includes(String(task.status || "todo").toLowerCase()));

    console.log("Project Status");
    console.log("");
    console.log(`- repository map: ${scanKnown ? (scanFresh ? "current" : "needs refresh") : "unknown"}`);
    console.log(`- tasks: todo=${breakdown.todo}, in_progress=${breakdown.in_progress}, done=${breakdown.done}, blocked=${breakdown.blocked}`);
    console.log(`- approval: ${gate.active?.taskId ? `active for ${gate.active.taskId}` : "none"}`);
    console.log("");
    console.log("Next:");
    if (!scanFresh) {
        console.log("- Refresh the repository map: repo-context-kit scan");
    } else if (next?.id) {
        console.log(`- Prepare AI context: repo-context-kit task prompt ${next.id}`);
    } else {
        console.log('- Define work: repo-context-kit task new "Describe the work"');
    }
}

export async function main(args = process.argv.slice(2)) {
    const command = args.find((arg) => !arg.startsWith("--")) ?? "init";

    if (args.includes("--help") && args.includes("--advanced")) {
        printAdvancedHelp();
        return;
    }

    if (args.includes("--help") && command === "task") {
        await runTask(["help"]);
        return;
    }

    if (args.includes("--help") && command === "context") {
        await runContext(["help"]);
        return;
    }

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

    if (command === "status") {
        printStatus();
        return;
    }

    if (command === "auto") {
        const commandIndex = args.indexOf(command);
        await runAuto(args.slice(commandIndex + 1));
        return;
    }

    if (command === "task") {
        const commandIndex = args.indexOf(command);
        const taskArgs = args.slice(commandIndex + 1);
        if (taskArgs[0] === "plan") {
            await runAuto(taskArgs.slice(1));
            return;
        }
        if (taskArgs[0] === "from-doc") {
            const [docPath, ...rest] = taskArgs.slice(1);
            await runTask(["generate", "--from-doc", docPath, ...rest].filter(Boolean));
            return;
        }
        await runTask(taskArgs);
        return;
    }

    if (command === "context") {
        const commandIndex = args.indexOf(command);
        const contextArgs = args.slice(commandIndex + 1);
        if (contextArgs[0] === "next") {
            await runContext(["next-task", ...contextArgs.slice(1)]);
            return;
        }
        if (contextArgs[0] === "for") {
            await runContext(["workset", ...contextArgs.slice(1)]);
            return;
        }
        await runContext(contextArgs);
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

    if (command === "metrics") {
        const commandIndex = args.indexOf(command);
        await runMetrics(args.slice(commandIndex + 1));
        return;
    }

    if (command === "bootstrap") {
        const commandIndex = args.indexOf(command);
        await runBootstrap(args.slice(commandIndex + 1));
        return;
    }

    if (command === "hygiene") {
        const commandIndex = args.indexOf(command);
        await runHygiene(args.slice(commandIndex + 1));
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
