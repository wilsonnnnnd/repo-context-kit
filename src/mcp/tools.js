import { spawnCli, isValidToken } from "./spawn-cli.js";

function asTextResult(text) {
    return {
        content: [
            {
                type: "text",
                text: typeof text === "string" ? text : String(text ?? ""),
            },
        ],
    };
}

function tool(name, description, inputSchema, handler) {
    return {
        name,
        description,
        inputSchema,
        handler,
    };
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function pickBoolean(value, fallback) {
    if (typeof value === "boolean") {
        return value;
    }
    return fallback;
}

function pickEnum(value, allowed, fallback) {
    if (allowed.includes(value)) {
        return value;
    }
    return fallback;
}

function normalizeArgs(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}

export function buildMcpTools({ rootDir, enableWrite, enableTests }) {
    const tools = [];

    const readOnly = [
        tool(
            "rck.context.brief",
            "Print concise project-level AI context (repo-context-kit context brief).",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const result = await spawnCli({ rootDir, args: ["context", "brief"] });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.context.nextTask",
            "Print the next active task context (repo-context-kit context next-task).",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const result = await spawnCli({ rootDir, args: ["context", "next-task"] });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.context.workset",
            "Print bounded implementation context for one task (repo-context-kit context workset <taskId>).",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: {
                    taskId: { type: "string" },
                    deep: { type: "boolean" },
                    detail: {
                        type: "string",
                        enum: ["compact", "digest", "full"],
                    },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const taskId = input.taskId;
                if (!isNonEmptyString(taskId)) {
                    throw new Error("taskId is required");
                }
                const deep = pickBoolean(input.deep, false);
                const detail = pickEnum(input.detail, ["compact", "digest", "full"], "compact");

                const cliArgs = ["context", "workset", taskId];
                if (deep) {
                    cliArgs.push("--deep");
                }
                if (detail === "compact") {
                    cliArgs.push("--compact");
                } else if (detail === "digest") {
                    cliArgs.push("--digest");
                } else if (detail === "full") {
                    cliArgs.push("--full");
                }

                const result = await spawnCli({ rootDir, args: cliArgs });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.scan.check",
            "Check whether scan output is up to date without writing files (repo-context-kit scan --check).",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const result = await spawnCli({ rootDir, args: ["scan", "--check"] });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.scan.plan",
            "Preview which files scan would update without writing files (repo-context-kit scan --plan).",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const result = await spawnCli({ rootDir, args: ["scan", "--plan"] });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.task.prompt",
            "Print an AI-ready implementation prompt for one task (repo-context-kit task prompt <taskId>).",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: {
                    taskId: { type: "string" },
                    deep: { type: "boolean" },
                    detail: {
                        type: "string",
                        enum: ["compact", "full-detail", "full-workset"],
                    },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const taskId = input.taskId;
                if (!isNonEmptyString(taskId)) {
                    throw new Error("taskId is required");
                }
                const deep = pickBoolean(input.deep, false);
                const detail = pickEnum(
                    input.detail,
                    ["compact", "full-detail", "full-workset"],
                    "compact",
                );

                const cliArgs = ["task", "prompt", taskId];
                if (deep) {
                    cliArgs.push("--deep");
                }
                if (detail === "compact") {
                    cliArgs.push("--compact");
                } else if (detail === "full-detail") {
                    cliArgs.push("--full-detail");
                } else if (detail === "full-workset") {
                    cliArgs.push("--full-workset");
                }

                const result = await spawnCli({ rootDir, args: cliArgs });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.task.checklist",
            "Print a bounded test and verification checklist for one task (repo-context-kit task checklist <taskId>).",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: {
                    taskId: { type: "string" },
                    deep: { type: "boolean" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const taskId = input.taskId;
                if (!isNonEmptyString(taskId)) {
                    throw new Error("taskId is required");
                }
                const deep = pickBoolean(input.deep, false);

                const cliArgs = ["task", "checklist", taskId];
                if (deep) {
                    cliArgs.push("--deep");
                }

                const result = await spawnCli({ rootDir, args: cliArgs });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.task.pr",
            "Print a bounded pull request description for one task (repo-context-kit task pr <taskId>).",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: {
                    taskId: { type: "string" },
                    deep: { type: "boolean" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const taskId = input.taskId;
                if (!isNonEmptyString(taskId)) {
                    throw new Error("taskId is required");
                }
                const deep = pickBoolean(input.deep, false);

                const cliArgs = ["task", "pr", taskId];
                if (deep) {
                    cliArgs.push("--deep");
                }

                const result = await spawnCli({ rootDir, args: cliArgs });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.gate.status",
            "Show confirmation gate state (repo-context-kit gate status).",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const result = await spawnCli({ rootDir, args: ["gate", "status"] });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
    ];

    tools.push(...readOnly);

    if (enableWrite) {
        tools.push(
            tool(
                "rck.init",
                "Copy workflow template into the current repository (repo-context-kit init).",
                {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        dryRun: { type: "boolean" },
                        force: { type: "boolean" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const dryRun = pickBoolean(input.dryRun, false);
                    const force = pickBoolean(input.force, false);

                    const cliArgs = ["init"];
                    if (dryRun) {
                        cliArgs.push("--dry-run");
                    }
                    if (force) {
                        cliArgs.push("--force");
                    }

                    const result = await spawnCli({ rootDir, args: cliArgs });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
            tool(
                "rck.scan",
                "Update project context (.aidw/*) (repo-context-kit scan).",
                {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        mode: {
                            type: "string",
                            enum: ["normal", "auto"],
                        },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const mode = pickEnum(input.mode, ["normal", "auto"], "normal");

                    const cliArgs = ["scan"];
                    if (mode === "auto") {
                        cliArgs.push("--auto");
                    }

                    const result = await spawnCli({ rootDir, args: cliArgs });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
            tool(
                "rck.task.new",
                "Create an implementation-ready task file and update task/task.md (repo-context-kit task new).",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["title"],
                    properties: {
                        title: { type: "string" },
                        dryRun: { type: "boolean" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const title = input.title;
                    if (!isNonEmptyString(title)) {
                        throw new Error("title is required");
                    }
                    const dryRun = pickBoolean(input.dryRun, false);

                    const cliArgs = ["task", "new", title];
                    if (dryRun) {
                        cliArgs.push("--dry-run");
                    }

                    const result = await spawnCli({ rootDir, args: cliArgs });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
            tool(
                "rck.task.cleanup",
                "Archive and delete one completed task and remove it from task/task.md (repo-context-kit task cleanup).",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId"],
                    properties: {
                        taskId: { type: "string" },
                        dryRun: { type: "boolean" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const taskId = input.taskId;
                    if (!isNonEmptyString(taskId)) {
                        throw new Error("taskId is required");
                    }
                    const dryRun = pickBoolean(input.dryRun, false);

                    const cliArgs = ["task", "cleanup", taskId];
                    if (dryRun) {
                        cliArgs.push("--dry-run");
                    }

                    const result = await spawnCli({ rootDir, args: cliArgs });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
            tool(
                "rck.gate.confirmTask",
                "Confirm one task and generate a time-limited gate token (repo-context-kit gate confirm task <taskId> --json).",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId"],
                    properties: {
                        taskId: { type: "string" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const taskId = input.taskId;
                    if (!isNonEmptyString(taskId)) {
                        throw new Error("taskId is required");
                    }
                    const result = await spawnCli({
                        rootDir,
                        args: ["gate", "confirm", "task", taskId, "--json"],
                    });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
            tool(
                "rck.gate.confirmTests",
                "Confirm test execution for the selected task (repo-context-kit gate confirm tests <taskId>).",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId"],
                    properties: {
                        taskId: { type: "string" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const taskId = input.taskId;
                    if (!isNonEmptyString(taskId)) {
                        throw new Error("taskId is required");
                    }
                    const result = await spawnCli({
                        rootDir,
                        args: ["gate", "confirm", "tests", taskId],
                    });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
        );
    }

    if (enableWrite && enableTests) {
        tools.push(
            tool(
                "rck.gate.runTest",
                "Run the selected task's test command via the confirmation gate (repo-context-kit gate run-test <taskId> --token <token>).",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId", "token"],
                    properties: {
                        taskId: { type: "string" },
                        token: { type: "string" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const taskId = input.taskId;
                    const token = input.token;
                    if (!isNonEmptyString(taskId)) {
                        throw new Error("taskId is required");
                    }
                    if (!isValidToken(token)) {
                        throw new Error("token must be a 32-character hex string");
                    }

                    const result = await spawnCli({
                        rootDir,
                        args: ["gate", "run-test", taskId, "--token", token],
                    });
                    return asTextResult(result.stdout || result.stderr);
                },
            ),
        );
    }

    const toolByName = new Map(tools.map((t) => [t.name, t]));

    return {
        listTools() {
            return tools.map(({ name, description, inputSchema }) => ({
                name,
                description,
                inputSchema,
            }));
        },
        async callTool(name, args) {
            const found = toolByName.get(name);
            if (!found) {
                const error = new Error(`Unknown tool: ${name}`);
                error.code = "UNKNOWN_TOOL";
                throw error;
            }
            return await found.handler(args);
        },
    };
}

