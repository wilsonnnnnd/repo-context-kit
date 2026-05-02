#!/usr/bin/env node
import fs from "fs";
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const siteDir = path.resolve(repoRoot, "site");
const cliPath = path.resolve(__dirname, "cli.js");
const DEFAULT_PORT = 3210;
const HOST = "127.0.0.1";
const TASK_EXAMPLE_PATH = "examples/task-example.md";
const TASK_EXAMPLE_FILE = path.resolve(siteDir, "task-example.md");

const ACTIONS = {
    init: ["init"],
    scan: ["scan"],
    "scan-check": ["scan", "--check"],
    "scan-auto": ["scan", "--auto"],
    "task-new": ["task", "new"],
};

const CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
};

function toWebPath(filePath) {
    return filePath.replaceAll(path.sep, "/");
}

function sendJson(res, statusCode, body) {
    res.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";

        req.setEncoding("utf-8");
        req.on("data", (chunk) => {
            body += chunk;

            if (body.length > 20_000) {
                reject(new Error("Request body too large."));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!body.trim()) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Invalid JSON body."));
            }
        });
        req.on("error", reject);
    });
}

function validateTitle(title) {
    if (typeof title !== "string") {
        return "Task title is required.";
    }

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
        return "Task title cannot be empty.";
    }

    if (trimmedTitle.length > 160) {
        return "Task title must be 160 characters or fewer.";
    }

    if (/[\r\n\t\u0000-\u001f\u007f]/u.test(trimmedTitle)) {
        return "Task title cannot contain control characters.";
    }

    return null;
}

function getActionArgs(action, payload = {}) {
    const baseArgs = ACTIONS[action];

    if (!baseArgs) {
        return {
            error: "Unsupported action.",
            args: null,
        };
    }

    if (action !== "task-new") {
        return {
            error: null,
            args: baseArgs,
        };
    }

    const titleError = validateTitle(payload.title);

    if (titleError) {
        return {
            error: titleError,
            args: null,
        };
    }

    return {
        error: null,
        args: [...baseArgs, payload.title.trim()],
    };
}

function writeLog(res, event) {
    res.write(`${JSON.stringify(event)}\n`);
}

async function handleRun(req, res) {
    let body;

    try {
        body = await readJsonBody(req);
    } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
    }

    const action = body.action;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const { error, args } = getActionArgs(action, payload);

    if (error) {
        sendJson(res, 400, { error });
        return;
    }

    res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
    });

    writeLog(res, {
        type: "start",
        action,
        command: `repo-context-kit ${args.join(" ")}`,
    });

    let child;

    try {
        child = spawn(process.execPath, [cliPath, ...args], {
            cwd: process.cwd(),
            env: process.env,
            shell: false,
            windowsHide: true,
        });
    } catch (spawnError) {
        writeLog(res, { type: "error", text: spawnError.message });
        writeLog(res, { type: "exit", code: 1, ok: false });
        res.end();
        return;
    }

    child.stdout.on("data", (chunk) => {
        writeLog(res, { type: "stdout", text: chunk.toString("utf-8") });
    });

    child.stderr.on("data", (chunk) => {
        writeLog(res, { type: "stderr", text: chunk.toString("utf-8") });
    });

    child.on("error", (spawnError) => {
        writeLog(res, { type: "error", text: spawnError.message });
    });

    child.on("close", (code) => {
        writeLog(res, {
            type: "exit",
            code,
            ok: code === 0,
        });
        res.end();
    });
}

function isTaskMarkdownPath(requestedPath) {
    const normalized = requestedPath.replaceAll("\\", "/");

    return /^task\/[^/]+\.md$/u.test(normalized);
}

function isAllowedManagedPath(requestedPath) {
    const normalized = requestedPath.replaceAll("\\", "/");

    return (
        normalized === TASK_EXAMPLE_PATH ||
        normalized === ".aidw/project.md" ||
        normalized === "task/task.md" ||
        isTaskMarkdownPath(normalized)
    );
}

function resolveManagedPath(requestedPath) {
    if (typeof requestedPath !== "string" || !isAllowedManagedPath(requestedPath)) {
        return null;
    }

    if (requestedPath.replaceAll("\\", "/") === TASK_EXAMPLE_PATH) {
        return TASK_EXAMPLE_FILE;
    }

    const fullPath = path.resolve(process.cwd(), requestedPath);
    const cwd = path.resolve(process.cwd());
    const relative = path.relative(cwd, fullPath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return null;
    }

    return fullPath;
}

function handleFiles(_req, res) {
    const taskDir = path.resolve(process.cwd(), "task");
    const tasks = fs.existsSync(taskDir)
        ? fs
              .readdirSync(taskDir, { withFileTypes: true })
              .filter((entry) => entry.isFile())
              .map((entry) => `task/${entry.name}`)
              .filter((filePath) => filePath !== "task/task.md" && isTaskMarkdownPath(filePath))
              .sort()
        : [];

    sendJson(res, 200, {
        project: ".aidw/project.md",
        example: TASK_EXAMPLE_PATH,
        tasks,
        registry: "task/task.md",
    });
}

function handleFile(req, res) {
    const url = new URL(req.url, `http://${HOST}`);
    const requestedPath = url.searchParams.get("path");
    const fullPath = resolveManagedPath(requestedPath);

    if (!fullPath) {
        sendJson(res, 403, { error: "File path is not allowed." });
        return;
    }

    if (!fs.existsSync(fullPath)) {
        sendJson(res, 404, { error: "File does not exist." });
        return;
    }

    sendJson(res, 200, {
        path: requestedPath === TASK_EXAMPLE_PATH
            ? TASK_EXAMPLE_PATH
            : toWebPath(path.relative(process.cwd(), fullPath)),
        content: fs.readFileSync(fullPath, "utf-8"),
    });
}

function serveStatic(req, res) {
    const url = new URL(req.url, `http://${HOST}`);
    const requestedPath = decodeURIComponent(url.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
    const fullPath = path.resolve(siteDir, relativePath);
    const relativeToSite = path.relative(siteDir, fullPath);

    if (relativeToSite.startsWith("..") || path.isAbsolute(relativeToSite)) {
        sendJson(res, 403, { error: "Path is not allowed." });
        return;
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        sendJson(res, 404, { error: "Not found." });
        return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
        "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
        "cache-control": "no-store",
    });
    fs.createReadStream(fullPath).pipe(res);
}

function createUiServer() {
    return http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/run") {
            handleRun(req, res);
            return;
        }

        if (req.method === "GET" && req.url === "/api/files") {
            handleFiles(req, res);
            return;
        }

        if (req.method === "GET" && req.url?.startsWith("/api/file")) {
            handleFile(req, res);
            return;
        }

        if (req.url?.startsWith("/api/")) {
            sendJson(res, 404, { error: "API route not found." });
            return;
        }

        if (req.method !== "GET" && req.method !== "HEAD") {
            sendJson(res, 405, { error: "Method not allowed." });
            return;
        }

        serveStatic(req, res);
    });
}

function openBrowser(url) {
    const platform = process.platform;
    const command =
        platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
    const args =
        platform === "win32" ? ["/c", "start", "", url] : [url];

    const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
    });

    child.on("error", () => {
        console.log(`Open ${url} in your browser.`);
    });

    child.unref();
}

export function startUiServer(options = {}) {
    const port = Number.parseInt(options.port ?? DEFAULT_PORT, 10);
    const server = createUiServer();

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
            server.off("error", reject);
            const address = server.address();
            const resolvedPort = typeof address === "object" && address ? address.port : port;
            const url = `http://localhost:${resolvedPort}`;

            console.log(`repo-context-kit UI running at ${url}`);

            if (options.openBrowser !== false) {
                try {
                    openBrowser(url);
                } catch {
                    console.log(`Open ${url} in your browser.`);
                }
            }

            resolve({
                server,
                url,
            });
        });
    });
}

export async function runUi(options = {}) {
    await startUiServer(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    runUi().catch((error) => {
        console.error("Unexpected error:", error);
        process.exit(1);
    });
}
