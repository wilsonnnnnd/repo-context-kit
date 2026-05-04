#!/usr/bin/env node
import fs from "node:fs";
import {
    getGitHubTokenFromUserConfig,
    setGitHubTokenInUserConfig,
    unsetGitHubTokenInUserConfig,
} from "../src/github/auth.js";

function readStdin() {
    try {
        return fs.readFileSync(0, "utf-8");
    } catch {
        return "";
    }
}

export async function runGithub(args = []) {
    const subcommand = args[0];
    const action = args[1];

    if (subcommand !== "auth") {
        console.error("Unknown github subcommand.");
        process.exitCode = 1;
        return { ok: false };
    }

    if (action === "status") {
        const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
        const configToken = getGitHubTokenFromUserConfig() || "";
        const source = envToken ? "env" : configToken ? "user-config" : "none";
        const configured = Boolean(envToken || configToken);
        console.log(`# GitHub Auth`);
        console.log("");
        console.log(`- configured: ${configured ? "true" : "false"}`);
        console.log(`- source: ${source}`);
        if (!configured) {
            console.log("");
            console.log("Get a GitHub token:");
            console.log("- Fine-grained: https://github.com/settings/tokens?type=beta");
            console.log("- Classic: https://github.com/settings/tokens/new");
            console.log("");
            console.log("Then run:");
            console.log("- repo-context-kit github auth set --stdin");
        }
        return { ok: true, configured, source };
    }

    if (action === "set") {
        const tokenIndex = args.indexOf("--token");
        const stdin = args.includes("--stdin");
        const rawToken =
            tokenIndex >= 0 && args[tokenIndex + 1] && !String(args[tokenIndex + 1]).startsWith("--")
                ? String(args[tokenIndex + 1])
                : stdin
                    ? readStdin()
                    : "";
        const token = String(rawToken ?? "").trim();

        if (!token) {
            console.error("Missing token. Use --token <token> or --stdin.");
            process.exitCode = 1;
            return { ok: false };
        }

        const result = setGitHubTokenInUserConfig(token);
        if (!result.ok) {
            console.error("Failed to save token.");
            process.exitCode = 1;
            return { ok: false };
        }

        console.log("GitHub token saved to user config.");
        return { ok: true };
    }

    if (action === "unset") {
        const result = unsetGitHubTokenInUserConfig();
        if (!result.ok) {
            console.error("Failed to remove token.");
            process.exitCode = 1;
            return { ok: false };
        }
        console.log("GitHub token removed from user config.");
        return { ok: true, changed: Boolean(result.changed) };
    }

    console.error("Unknown github auth action.");
    process.exitCode = 1;
    return { ok: false };
}
