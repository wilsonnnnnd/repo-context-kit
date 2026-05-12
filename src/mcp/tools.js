import fs from "node:fs";
import path from "node:path";
import { spawnCli, isValidToken } from "./spawn-cli.js";
import { validateGate } from "../gate/state.js";
import { loadGateState } from "../gate/state.js";
import { validateRuntimeContract } from "../runtime/runtime-schema.js";
import { serializeJson } from "../runtime/serialize.js";
import { buildRuntimeMetrics } from "../runtime/context-observability.js";

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

function asJsonResult(payload) {
    return asTextResult(serializeJson(payload));
}

export const MCP_CAPABILITY_TIERS = Object.freeze({
    READ_ONLY: "read-only",
    WORKFLOW_WRITE: "workflow-write",
    TEST_EXEC: "test-exec",
    EXTERNAL_SIDE_EFFECT: "external-side-effect",
});

const MCP_CAPABILITY_TIER_VALUES = new Set(Object.values(MCP_CAPABILITY_TIERS));

function normalizeCapabilityTier(value) {
    const tier = String(value ?? "").trim();
    return MCP_CAPABILITY_TIER_VALUES.has(tier) ? tier : MCP_CAPABILITY_TIERS.READ_ONLY;
}

function tool(name, description, inputSchema, handler, capabilityTier = MCP_CAPABILITY_TIERS.READ_ONLY) {
    return {
        name,
        description,
        capabilityTier: normalizeCapabilityTier(capabilityTier),
        inputSchema,
        handler,
    };
}

function normalizeArgs(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function pickBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

function pickEnum(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function normalizeRuntimeMode(value) {
    const raw = String(value ?? "").trim().toUpperCase();
    return ["SAFE", "STANDARD", "REVIEW", "EXPERIMENTAL"].includes(raw) ? raw : null;
}

function requireEvidence(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        const error = new Error("evidence is required (object)");
        error.code = "MISSING_EVIDENCE";
        throw error;
    }
    if (JSON.stringify(value).length > 12_000) {
        const error = new Error("evidence is too large");
        error.code = "EVIDENCE_TOO_LARGE";
        throw error;
    }
    return value;
}

function requireWriteGate({ rootDir, taskId, token, requireTestsConfirmed }) {
    if (!isNonEmptyString(taskId)) {
        const error = new Error("taskId is required");
        error.code = "MISSING_TASK_ID";
        throw error;
    }
    if (!isValidToken(token)) {
        const error = new Error("token must be a 32-character hex string");
        error.code = "INVALID_TOKEN";
        throw error;
    }
    const result = validateGate({ taskId, token, requireTestsConfirmed }, rootDir);
    if (!result.ok) {
        const error = new Error(result.error || "Gate is not confirmed for this task.");
        error.code = "GATE_NOT_CONFIRMED";
        throw error;
    }
}

async function runGovernedCli({ rootDir, runCli, input, cliArgs, requireTestsConfirmed = false }) {
    const mode = normalizeRuntimeMode(input.runtimeMode ?? input.mode);
    if (!mode) {
        const error = new Error("runtimeMode is required");
        error.code = "MISSING_MODE";
        throw error;
    }
    if (mode === "REVIEW") {
        const error = new Error("Write is not allowed in REVIEW mode.");
        error.code = "MODE_READ_ONLY";
        throw error;
    }
    requireEvidence(input.evidence);
    requireWriteGate({
        rootDir,
        taskId: input.taskId,
        token: input.token,
        requireTestsConfirmed,
    });
    const result = await runCli({ rootDir, args: cliArgs });
    return asTextResult(result.stdout || result.stderr);
}

export function buildMcpCapabilityPolicy({ enableWrite, enableTests, enableExternalSideEffects } = {}) {
    const allowed = new Set([MCP_CAPABILITY_TIERS.READ_ONLY]);
    if (enableWrite) {
        allowed.add(MCP_CAPABILITY_TIERS.WORKFLOW_WRITE);
    }
    if (enableWrite && enableTests) {
        allowed.add(MCP_CAPABILITY_TIERS.TEST_EXEC);
    }
    if (enableWrite && enableExternalSideEffects) {
        allowed.add(MCP_CAPABILITY_TIERS.EXTERNAL_SIDE_EFFECT);
    }
    return {
        allowedTiers: [...allowed],
        allows(tier) {
            return allowed.has(normalizeCapabilityTier(tier));
        },
    };
}

function assertCapabilityAllowed(toolDef, allowedCapabilityTiers) {
    const tier = normalizeCapabilityTier(toolDef?.capabilityTier);
    if (allowedCapabilityTiers.has(tier)) {
        return;
    }
    const error = new Error(`MCP capability tier is not enabled for this server: ${tier}`);
    error.code = "MCP_CAPABILITY_NOT_ENABLED";
    throw error;
}

function loadJsonIndex(rootDir, relativePath, fallback) {
    const indexPath = path.resolve(rootDir, relativePath);
    if (!fs.existsSync(indexPath)) {
        return fallback;
    }
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
}

function loadJsonFile(rootDir, relativePath, fallback = null) {
    const filePath = path.resolve(rootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        return fallback;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return fallback;
    }
}

function loadRuntimeV1(rootDir) {
    return {
        task: loadJsonFile(rootDir, ".aidw/runtime/task.json", null),
        context: loadJsonFile(rootDir, ".aidw/runtime/context.json", null),
        execution: loadJsonFile(rootDir, ".aidw/runtime/execution.json", null),
        verification: loadJsonFile(rootDir, ".aidw/runtime/verification.json", null),
    };
}

function loadPackageMeta(rootDir) {
    const pkg = loadJsonFile(rootDir, "package.json", {});
    return {
        name: String(pkg?.name ?? "").trim() || "-",
        version: String(pkg?.version ?? "").trim() || "-",
        description: String(pkg?.description ?? "").trim() || "",
    };
}

function getRuntimeTasks(runtimeTask) {
    const tasks = runtimeTask?.payload?.tasks;
    return Array.isArray(tasks) ? tasks : [];
}

function pickNextTask(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return null;
    const inProgress = tasks.find((task) => String(task?.status ?? "").toLowerCase() === "in_progress");
    if (inProgress) return inProgress;
    const todo = tasks.find((task) => String(task?.status ?? "").toLowerCase() === "todo");
    return todo ?? null;
}

function findTask(tasks, taskId) {
    const id = String(taskId ?? "").trim().toUpperCase();
    if (!id) return null;
    return tasks.find((task) => String(task?.id ?? "").trim().toUpperCase() === id) ?? null;
}

function limitArray(values, max) {
    const list = Array.isArray(values) ? values : [];
    return list.slice(0, max);
}

function parseSection(content, heading) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const match = String(content ?? "").match(regex);
    return match?.groups?.body?.trim() ?? "";
}

function parseSectionList(content, heading) {
    const section = parseSection(content, heading);
    if (!section) return [];
    return section
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).trim())
        .filter(Boolean)
        .slice(0, 16);
}

function readTaskDetail(rootDir, taskFile) {
    const rel = String(taskFile ?? "").trim();
    if (!rel) return "";
    const full = path.resolve(rootDir, rel);
    if (!fs.existsSync(full)) return "";
    try {
        return fs.readFileSync(full, "utf-8");
    } catch {
        return "";
    }
}

function normalizeRepoRelativePath(value) {
    const raw = String(value ?? "").trim().replaceAll("\\", "/");
    if (!raw) {
        throw new Error("path is required");
    }
    if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
        throw new Error("path must be repo-relative");
    }
    const parts = raw.split("/");
    if (parts.some((part) => part === ".." || part === "." || part === "")) {
        throw new Error("path must not contain traversal segments");
    }
    return parts.join("/");
}

function normalizeQuery(value) {
    const query = String(value ?? "").trim().toLowerCase();
    if (!query) {
        throw new Error("query is required");
    }
    return query;
}

function boundedLimit(value, fallback = 10, max = 50) {
    const limit = Number(value);
    if (!Number.isFinite(limit)) {
        return fallback;
    }
    return Math.min(max, Math.max(1, Math.floor(limit)));
}

export function buildMcpTools({ rootDir, enableWrite, enableTests, enableExternalSideEffects = false, runCli = spawnCli }) {
    const tools = [];
    const capabilityPolicy = buildMcpCapabilityPolicy({ enableWrite, enableTests, enableExternalSideEffects });
    const allowedCapabilityTiers = new Set(capabilityPolicy.allowedTiers);

    tools.push(
        tool(
            "rck.repo.summary",
            "Read repository runtime summary (MCP-first, runtime/v1 JSON-backed).",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const runtime = loadRuntimeV1(rootDir);
                const pkg = loadPackageMeta(rootDir);
                const tasks = getRuntimeTasks(runtime.task);
                const payload = {
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    repository: pkg,
                    runtime: {
                        taskFile: ".aidw/runtime/task.json",
                        contextFile: ".aidw/runtime/context.json",
                        executionFile: ".aidw/runtime/execution.json",
                        verificationFile: ".aidw/runtime/verification.json",
                    },
                    summary: {
                        taskCount: tasks.length,
                        projectType: runtime.context?.payload?.projectType ?? null,
                        indexedFiles: runtime.context?.payload?.index?.indexedFiles ?? null,
                        indexedSymbols: runtime.context?.payload?.index?.indexedSymbols ?? null,
                    },
                };
                return asJsonResult(payload);
            },
        ),
        tool(
            "rck.context.brief",
            "Read compact bounded repository context from runtime/v1 JSON.",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const runtime = loadRuntimeV1(rootDir);
                const pkg = loadPackageMeta(rootDir);
                const payload = {
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    repository: pkg,
                    context: {
                        projectType: runtime.context?.payload?.projectType ?? null,
                        techStack: limitArray(runtime.context?.payload?.techStack, 12),
                        riskAreas: limitArray(runtime.context?.payload?.riskAreas, 12),
                        index: runtime.context?.payload?.index ?? {},
                    },
                    verification: {
                        requiredChecks: limitArray(runtime.verification?.payload?.requiredChecks, 8),
                    },
                };
                return asJsonResult(payload);
            },
        ),
        tool(
            "rck.context.nextTask",
            "Read next active task from runtime/v1 JSON.",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const runtime = loadRuntimeV1(rootDir);
                const tasks = getRuntimeTasks(runtime.task);
                const nextTask = pickNextTask(tasks);
                const counts = tasks.reduce(
                    (acc, task) => {
                        const status = String(task?.status ?? "").toLowerCase();
                        if (status === "todo") acc.todo += 1;
                        else if (status === "in_progress") acc.in_progress += 1;
                        else if (status === "done") acc.done += 1;
                        else acc.other += 1;
                        return acc;
                    },
                    { todo: 0, in_progress: 0, done: 0, other: 0 },
                );
                return asJsonResult({
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    nextTask,
                    taskCounts: counts,
                });
            },
        ),
        tool(
            "rck.context.workset",
            "Read bounded task workset context from runtime/v1 JSON.",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: {
                    taskId: { type: "string" },
                    deep: { type: "boolean" },
                    detail: { type: "string", enum: ["compact", "digest", "full"] },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                if (!isNonEmptyString(input.taskId)) {
                    throw new Error("taskId is required");
                }
                const detail = pickEnum(input.detail, ["compact", "digest", "full"], "compact");
                const deep = pickBoolean(input.deep, false);
                const runtime = loadRuntimeV1(rootDir);
                const tasks = getRuntimeTasks(runtime.task);
                const task = findTask(tasks, input.taskId);
                if (!task) {
                    throw new Error(`taskId not found in runtime state: ${input.taskId}`);
                }
                const baseLimit = detail === "full" ? 20 : detail === "compact" ? 10 : 6;
                const fileLimit = deep ? Math.min(baseLimit + 8, 28) : baseLimit;
                const files = limitArray(runtime.context?.payload?.topFiles, fileLimit).map((file) => ({
                    path: file?.path ?? null,
                    type: file?.type ?? null,
                    description: file?.description ?? null,
                }));
                return asJsonResult({
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    task,
                    workset: {
                        detail,
                        deep,
                        files,
                        entrypoints: limitArray(runtime.context?.payload?.entrypoints, deep ? 20 : 12),
                        riskAreas: limitArray(runtime.context?.payload?.riskAreas, deep ? 16 : 10),
                    },
                });
            },
        ),
        tool(
            "rck.task.prompt",
            "Read structured prompt framing for one task (runtime-first).",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: { taskId: { type: "string" }, deep: { type: "boolean" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                if (!isNonEmptyString(input.taskId)) throw new Error("taskId is required");
                const runtime = loadRuntimeV1(rootDir);
                const task = findTask(getRuntimeTasks(runtime.task), input.taskId);
                if (!task) throw new Error(`taskId not found in runtime state: ${input.taskId}`);
                const detail = readTaskDetail(rootDir, task.file);
                return asJsonResult({
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    kind: "task-prompt",
                    task: {
                        id: task.id,
                        title: task.title,
                        goal: parseSection(detail, "Goal") || null,
                        scope: parseSectionList(detail, "Scope"),
                        requirements: parseSectionList(detail, "Requirements"),
                        acceptanceCriteria: parseSectionList(detail, "Acceptance Criteria"),
                        testCommand: parseSection(detail, "Test Command") || null,
                    },
                    context: {
                        riskAreas: limitArray(runtime.context?.payload?.riskAreas, 10),
                        entrypoints: limitArray(runtime.context?.payload?.entrypoints, 12),
                    },
                });
            },
        ),
        tool(
            "rck.task.checklist",
            "Read structured verification checklist framing for one task.",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: { taskId: { type: "string" }, deep: { type: "boolean" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                if (!isNonEmptyString(input.taskId)) throw new Error("taskId is required");
                const runtime = loadRuntimeV1(rootDir);
                const task = findTask(getRuntimeTasks(runtime.task), input.taskId);
                if (!task) throw new Error(`taskId not found in runtime state: ${input.taskId}`);
                const detail = readTaskDetail(rootDir, task.file);
                return asJsonResult({
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    kind: "task-checklist",
                    task: { id: task.id, title: task.title },
                    checklist: {
                        acceptanceCriteria: parseSectionList(detail, "Acceptance Criteria"),
                        definitionOfDone: parseSectionList(detail, "Definition of Done"),
                        requiredChecks: limitArray(runtime.verification?.payload?.requiredChecks, 8),
                    },
                });
            },
        ),
        tool(
            "rck.task.pr",
            "Read structured PR framing for one task.",
            {
                type: "object",
                additionalProperties: false,
                required: ["taskId"],
                properties: { taskId: { type: "string" }, deep: { type: "boolean" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                if (!isNonEmptyString(input.taskId)) throw new Error("taskId is required");
                const runtime = loadRuntimeV1(rootDir);
                const task = findTask(getRuntimeTasks(runtime.task), input.taskId);
                if (!task) throw new Error(`taskId not found in runtime state: ${input.taskId}`);
                const detail = readTaskDetail(rootDir, task.file);
                return asJsonResult({
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    kind: "task-pr-framing",
                    pr: {
                        title: `${task.id} ${task.title}`,
                        summary: parseSection(detail, "Goal") || null,
                        scope: parseSectionList(detail, "Scope"),
                        verification: {
                            requiredChecks: limitArray(runtime.verification?.payload?.requiredChecks, 8),
                            warnings: limitArray(runtime.verification?.payload?.warnings, 8),
                        },
                    },
                });
            },
        ),
        tool(
            "rck.gate.status",
            "Read current confirmation gate state.",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const state = loadGateState(rootDir);
                return asJsonResult({
                    schemaVersion: "runtime/v1",
                    interface: "mcp",
                    gate: state,
                });
            },
        ),
        tool(
            "rck.scan.check",
            "Check whether runtime JSON and indexes are current.",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                const result = await runCli({ rootDir, args: ["scan", "--check"] });
                return asTextResult(result.stdout || result.stderr);
            },
        ),
        tool(
            "rck.metrics",
            "Read compact runtime metrics JSON.",
            { type: "object", additionalProperties: false, properties: {} },
            async () => {
                return asJsonResult(buildRuntimeMetrics());
            },
        ),
        tool(
            "rck.runtime.validate",
            "Validate a runtime contract object.",
            {
                type: "object",
                additionalProperties: false,
                required: ["contract"],
                properties: { contract: { type: "object" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                return asTextResult(serializeJson(validateRuntimeContract(input.contract)));
            },
        ),
        tool(
            "rck.file.summary",
            "Read one bounded file summary from the generated index.",
            {
                type: "object",
                additionalProperties: false,
                required: ["path"],
                properties: { path: { type: "string" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const filePath = normalizeRepoRelativePath(input.path);
                const summaries = loadJsonIndex(rootDir, ".aidw/index/file-summaries.json", []);
                const found = Array.isArray(summaries) ? summaries.find((item) => item.path === filePath) : null;
                return asTextResult(serializeJson(found ?? { path: filePath, found: false }));
            },
        ),
        tool(
            "rck.file.search",
            "Search generated file index entries.",
            {
                type: "object",
                additionalProperties: false,
                required: ["query"],
                properties: { query: { type: "string" }, limit: { type: "number" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const query = normalizeQuery(input.query);
                const limit = boundedLimit(input.limit);
                const files = loadJsonIndex(rootDir, ".aidw/index/files.json", []);
                const matches = Array.isArray(files)
                    ? files
                          .filter((item) => `${item.path ?? ""} ${item.description ?? ""} ${item.type ?? ""}`.toLowerCase().includes(query))
                          .slice(0, limit)
                    : [];
                return asTextResult(serializeJson({ query, matches }));
            },
        ),
        tool(
            "rck.symbol.lookup",
            "Search generated symbol index entries.",
            {
                type: "object",
                additionalProperties: false,
                required: ["query"],
                properties: { query: { type: "string" }, limit: { type: "number" } },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const query = normalizeQuery(input.query);
                const limit = boundedLimit(input.limit);
                const symbols = loadJsonIndex(rootDir, ".aidw/index/symbols.json", []);
                const matches = Array.isArray(symbols)
                    ? symbols
                          .filter((item) => `${item.name ?? ""} ${item.file ?? ""} ${item.description ?? ""}`.toLowerCase().includes(query))
                          .slice(0, limit)
                    : [];
                return asTextResult(serializeJson({ query, matches }));
            },
        ),
    );

    if (enableWrite) {
        tools.push(
            tool(
                "rck.init",
                "Initialize repository runtime files through the gated MCP write surface.",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["runtimeMode", "taskId", "token", "evidence"],
                    properties: {
                        dryRun: { type: "boolean" },
                        force: { type: "boolean" },
                        runtimeMode: { type: "string", enum: ["SAFE", "STANDARD", "EXPERIMENTAL"] },
                        taskId: { type: "string" },
                        token: { type: "string" },
                        evidence: { type: "object", additionalProperties: true },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const cliArgs = ["init"];
                    if (pickBoolean(input.dryRun, false)) cliArgs.push("--dry-run");
                    if (pickBoolean(input.force, false)) cliArgs.push("--force");
                    return runGovernedCli({ rootDir, runCli, input, cliArgs });
                },
                MCP_CAPABILITY_TIERS.WORKFLOW_WRITE,
            ),
            tool(
                "rck.scan",
                "Update runtime JSON and generated indexes through the gated MCP write surface.",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["runtimeMode", "taskId", "token", "evidence"],
                    properties: {
                        mode: { type: "string", enum: ["normal", "auto"] },
                        runtimeMode: { type: "string", enum: ["SAFE", "STANDARD", "EXPERIMENTAL"] },
                        taskId: { type: "string" },
                        token: { type: "string" },
                        evidence: { type: "object", additionalProperties: true },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const cliArgs = ["scan"];
                    if (pickEnum(input.mode, ["normal", "auto"], "normal") === "auto") cliArgs.push("--auto");
                    return runGovernedCli({ rootDir, runCli, input, cliArgs });
                },
                MCP_CAPABILITY_TIERS.WORKFLOW_WRITE,
            ),
            tool(
                "rck.gate.confirmTask",
                "Confirm one task and generate a time-limited gate token.",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId"],
                    properties: { taskId: { type: "string" } },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    if (!isNonEmptyString(input.taskId)) throw new Error("taskId is required");
                    const result = await runCli({ rootDir, args: ["gate", "confirm", "task", input.taskId, "--json"] });
                    return asTextResult(result.stdout || result.stderr);
                },
                MCP_CAPABILITY_TIERS.WORKFLOW_WRITE,
            ),
            tool(
                "rck.gate.confirmTests",
                "Confirm test execution for one task.",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId"],
                    properties: { taskId: { type: "string" } },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    if (!isNonEmptyString(input.taskId)) throw new Error("taskId is required");
                    const result = await runCli({ rootDir, args: ["gate", "confirm", "tests", input.taskId] });
                    return asTextResult(result.stdout || result.stderr);
                },
                MCP_CAPABILITY_TIERS.WORKFLOW_WRITE,
            ),
        );
    }

    if (enableWrite && enableTests) {
        tools.push(
            tool(
                "rck.gate.runTest",
                "Run the selected task's test command through the confirmation gate.",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["taskId", "token", "runtimeMode", "evidence"],
                    properties: {
                        taskId: { type: "string" },
                        token: { type: "string" },
                        runtimeMode: { type: "string", enum: ["SAFE", "STANDARD", "EXPERIMENTAL"] },
                        evidence: { type: "object", additionalProperties: true },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    if (!isNonEmptyString(input.taskId)) throw new Error("taskId is required");
                    if (!isValidToken(input.token)) throw new Error("token must be a 32-character hex string");
                    return runGovernedCli({
                        rootDir,
                        runCli,
                        input,
                        cliArgs: ["gate", "run-test", input.taskId, "--token", input.token],
                        requireTestsConfirmed: true,
                    });
                },
                MCP_CAPABILITY_TIERS.TEST_EXEC,
            ),
        );
    }

    const toolByName = new Map(tools.map((item) => [item.name, item]));

    return {
        listTools() {
            return tools.map(({ name, description, capabilityTier, inputSchema }) => ({
                name,
                description,
                capabilityTier,
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
            assertCapabilityAllowed(found, allowedCapabilityTiers);
            return await found.handler(args);
        },
    };
}
