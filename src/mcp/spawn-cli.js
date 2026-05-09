import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveCliPath() {
    return path.resolve(__dirname, "../../bin/cli.js");
}

export function isValidToken(token) {
    return typeof token === "string" && /^[a-f0-9]{32}$/i.test(token);
}

export function spawnCli({ rootDir, args, timeoutMs }) {
    return new Promise((resolve, reject) => {
        const cliPath = resolveCliPath();
        const child = spawn(process.execPath, [cliPath, ...args], {
            cwd: rootDir,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let timeout = null;

        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timeout = setTimeout(() => {
                child.kill("SIGKILL");
                reject(new Error(`CLI timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        }

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf-8");
        });

        child.on("error", (error) => {
            if (timeout) {
                clearTimeout(timeout);
            }
            reject(error);
        });

        child.on("close", (code) => {
            if (timeout) {
                clearTimeout(timeout);
            }
            resolve({
                code: code ?? 0,
                stdout,
                stderr,
            });
        });
    });
}

