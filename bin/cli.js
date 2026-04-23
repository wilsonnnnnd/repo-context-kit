#!/usr/bin/env node
import { runInit } from "./init.js";
import { runScan } from "./scan.js";

const command = process.argv[2] ?? "init";

async function main() {
    if (command === "init") {
        await runInit();
        return;
    }

    if (command === "scan") {
        await runScan();
        return;
    }

    console.error(`Unknown command: ${command}`);
    console.log("Usage:");
    console.log("  ai-dev-workflow init");
    console.log("  ai-dev-workflow scan");
    process.exit(1);
}

main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
});
