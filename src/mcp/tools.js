import fs from "node:fs";
import path from "node:path";
import { spawnCli, isValidToken } from "./spawn-cli.js";
import { orchestrateAuto } from "../auto/orchestrator.js";
import { createVirtualTask } from "../task/virtual-task.js";
import { buildRuntimeContract } from "../runtime/runtime-contract.js";
import { inspectRuntimeSession } from "../runtime/sessions.js";
import { withRepoRoot } from "../runtime/root-context.js";
import { computeScanCheckState, runScan } from "../scan/index.js";
import { listRecentLoopEvents } from "../loop/store.js";
import { readLessonsFile } from "../lessons/store.js";
import { validateRuntimeContract } from "../runtime/runtime-schema.js";
import { serializeJson, serializeRuntimeContract } from "../runtime/serialize.js";
import { renderRuntimeRiskSummary } from "../runtime/risk-summary.js";
import { listSnapshots, readSnapshot, diffSnapshots } from "../runtime/snapshot-reader.js";
import { explainRuntimeContract } from "../runtime/explain.js";
import { loadDesignDoc } from "../docs/doc-loader.js";
import { extractPlanningData } from "../docs/doc-extractor.js";

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

function loadFileSummariesIndex(rootDir) {
    const indexPath = path.resolve(rootDir, ".aidw/index/file-summaries.json");
    if (!fs.existsSync(indexPath)) {
        const error = new Error("file-summaries index is missing. Run repo-context-kit scan first.");
        error.code = "MISSING_INDEX";
        throw error;
    }
    const raw = fs.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        const error = new Error("file-summaries index is invalid.");
        error.code = "INVALID_INDEX";
        throw error;
    }
    return parsed;
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
    const query = String(value ?? "").trim();
    if (!query) {
        throw new Error("query is required");
    }
    return query;
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
        tool(
            "rck.file.summary",
            "Return a summary for a single file from .aidw/index/file-summaries.json (read-only).",
            {
                type: "object",
                additionalProperties: false,
                required: ["path"],
                properties: {
                    path: { type: "string" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const filePath = normalizeRepoRelativePath(input.path);
                const summaries = loadFileSummariesIndex(rootDir);
                const match = summaries.find((summary) => summary && summary.path === filePath);
                if (!match) {
                    const error = new Error(`No summary found for ${filePath}`);
                    error.code = "NOT_FOUND";
                    throw error;
                }
                return asTextResult(`${JSON.stringify(match, null, 4)}\n`);
            },
        ),
        tool(
            "rck.file.search",
            "Search file summaries by path/roleSummary/symbol names from .aidw/index/file-summaries.json (read-only).",
            {
                type: "object",
                additionalProperties: false,
                required: ["query"],
                properties: {
                    query: { type: "string" },
                    limit: { type: "number" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const query = normalizeQuery(input.query).toLowerCase();
                const limitRaw = Number(input.limit ?? 10);
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;
                const summaries = loadFileSummariesIndex(rootDir);

                const matches = [];
                for (const summary of summaries) {
                    if (!summary || typeof summary !== "object") continue;
                    const haystacks = [
                        String(summary.path ?? ""),
                        String(summary.roleSummary ?? ""),
                        Array.isArray(summary.exports) ? summary.exports.map((s) => s?.name).filter(Boolean).join(" ") : "",
                        Array.isArray(summary.keySymbols) ? summary.keySymbols.map((s) => s?.name).filter(Boolean).join(" ") : "",
                    ].join(" ").toLowerCase();

                    if (haystacks.includes(query)) {
                        matches.push({
                            path: summary.path,
                            roleSummary: summary.roleSummary,
                            exports: Array.isArray(summary.exports) ? summary.exports.slice(0, 8) : [],
                            risks: Array.isArray(summary.risks) ? summary.risks : [],
                        });
                        if (matches.length >= limit) break;
                    }
                }

                return asTextResult(`${JSON.stringify({ query: input.query, limit, matches }, null, 4)}\n`);
            },
        ),
        tool(
            "rck.symbol.lookup",
            "Lookup a symbol name across file summaries (read-only).",
            {
                type: "object",
                additionalProperties: false,
                required: ["name"],
                properties: {
                    name: { type: "string" },
                    limit: { type: "number" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const name = normalizeQuery(input.name);
                const needle = name.toLowerCase();
                const limitRaw = Number(input.limit ?? 10);
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;
                const summaries = loadFileSummariesIndex(rootDir);

                const matches = [];
                for (const summary of summaries) {
                    if (!summary || typeof summary !== "object") continue;
                    const exportsMatch = Array.isArray(summary.exports)
                        ? summary.exports.some((s) => String(s?.name ?? "").toLowerCase() === needle)
                        : false;
                    const keyMatch = Array.isArray(summary.keySymbols)
                        ? summary.keySymbols.some((s) => String(s?.name ?? "").toLowerCase() === needle)
                        : false;
                    if (exportsMatch || keyMatch) {
                        matches.push({
                            name,
                            file: summary.path,
                            roleSummary: summary.roleSummary,
                            exported: exportsMatch,
                        });
                        if (matches.length >= limit) break;
                    }
                }

                return asTextResult(`${JSON.stringify({ name, limit, matches }, null, 4)}\n`);
            },
        ),
        tool(
            "rck.auto.plan",
            "Plan an auto workflow without writing files (equivalent to: repo-context-kit auto --goal \"...\" --dry-run --json).",
            {
                type: "object",
                additionalProperties: false,
                required: ["goal"],
                properties: {
                    goal: { type: "string" },
                    deep: { type: "boolean" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const goal = input.goal;
                if (!isNonEmptyString(goal)) {
                    throw new Error("goal is required");
                }
                const deep = pickBoolean(input.deep, false);
                const result = await orchestrateAuto({
                    rootDir,
                    goal,
                    deep,
                    dryRun: true,
                    allowWrite: false,
                });
                const contract = result.contract ?? null;
                if (contract) {
                    const validation = validateRuntimeContract(contract);
                    if (!validation.valid) {
                        const error = new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
                        error.code = "INVALID_CONTRACT";
                        throw error;
                    }
                    return asTextResult(serializeRuntimeContract(contract));
                }
                return asTextResult(serializeJson(result));
            },
        ),
        tool(
            "rck.doc.extract",
            "Extract planning data from a design doc using deterministic heuristics (read-only).",
            {
                type: "object",
                additionalProperties: false,
                required: ["path"],
                properties: {
                    path: { type: "string" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const docPath = input.path;
                if (!isNonEmptyString(docPath)) {
                    throw new Error("path is required");
                }
                const doc = loadDesignDoc(docPath, { repoRoot: rootDir });
                const planning = extractPlanningData(doc);
                return asTextResult(
                    serializeJson({
                        ok: true,
                        planning: {
                            path: doc.path,
                            title: doc.metadata?.title ?? null,
                            goals: planning.goals,
                            requirements: planning.requirements,
                            scope: planning.scope,
                            acceptanceCriteria: planning.acceptanceCriteria,
                            constraints: planning.constraints,
                            suggestedTasks: planning.suggestedTasks,
                            analysis: planning.analysis ?? null,
                        },
                    }),
                );
            },
        ),
        tool(
            "rck.doc.plan",
            "Plan a doc-driven workflow (equivalent to: repo-context-kit auto --from-doc <path> --dry-run --json). Read-only.",
            {
                type: "object",
                additionalProperties: false,
                required: ["path"],
                properties: {
                    path: { type: "string" },
                    deep: { type: "boolean" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const docPath = input.path;
                if (!isNonEmptyString(docPath)) {
                    throw new Error("path is required");
                }
                const deep = pickBoolean(input.deep, false);
                const result = await orchestrateAuto({
                    rootDir,
                    fromDocPath: docPath,
                    deep,
                    dryRun: true,
                    allowWrite: false,
                });
                if (!result.ok) {
                    const error = new Error(result.error || "Doc planning failed");
                    error.code = "DOC_PLAN_FAILED";
                    throw error;
                }
                const contract = result.contract ?? null;
                if (contract) {
                    const validation = validateRuntimeContract(contract);
                    if (!validation.valid) {
                        const error = new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
                        error.code = "INVALID_CONTRACT";
                        throw error;
                    }
                }
                return asTextResult(
                    serializeJson({
                        ok: true,
                        path: docPath,
                        deep,
                        planning: result.planning ?? null,
                        selectedTask: result.selectedTask ?? null,
                        runtimeContract: contract,
                        risks: contract?.risks ?? [],
                        nextActions: contract?.nextActions ?? [],
                    }),
                );
            },
        ),
        tool(
            "rck.runtime.validate",
            "Validate a runtime contract payload without writing files (read-only).",
            {
                type: "object",
                additionalProperties: false,
                required: ["contract"],
                properties: {
                    contract: { type: "object" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const contract = input.contract;
                const validation = validateRuntimeContract(contract);
                const runtimeVersion = contract && typeof contract === "object"
                    ? String(contract.runtimeVersion ?? "").trim() || null
                    : null;
                return asTextResult(serializeJson({ runtimeVersion, valid: validation.valid, errors: validation.errors, warnings: validation.warnings }));
            },
        ),
        tool(
            "rck.runtime.plan",
            "Plan a virtual task runtime contract (read-only). Generates a virtual task, workset, prompt, and related files without writing files.",
            {
                type: "object",
                additionalProperties: false,
                required: ["goal"],
                properties: {
                    goal: { type: "string" },
                    deep: { type: "boolean" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const goal = input.goal;
                if (!isNonEmptyString(goal)) {
                    throw new Error("goal is required");
                }
                const deep = pickBoolean(input.deep, false);
                const requiredPaths = [
                    path.resolve(rootDir, "AGENTS.md"),
                    path.resolve(rootDir, ".aidw"),
                    path.resolve(rootDir, "task/task.md"),
                ];
                const missing = requiredPaths.filter((filePath) => !fs.existsSync(filePath));
                if (missing.length > 0) {
                    const error = new Error("Project is not initialized. Run repo-context-kit init first.");
                    error.code = "NOT_INITIALIZED";
                    throw error;
                }
                const scan = await withRepoRoot(rootDir, async () => {
                    const required = [
                        path.resolve(rootDir, ".aidw/project.md"),
                        path.resolve(rootDir, ".aidw/system-overview.md"),
                        path.resolve(rootDir, ".aidw/index/summary.json"),
                    ];
                    if (required.some((filePath) => !fs.existsSync(filePath))) {
                        return { status: "missing", plan: [] };
                    }
                    const { update } = computeScanCheckState();
                    const status = update?.changed ? "stale" : "fresh";
                    const plan = [];
                    if (status === "stale") {
                        const planned = await (async () => {
                            const log = console.log;
                            const error = console.error;
                            console.log = () => {};
                            console.error = () => {};
                            try {
                                return await runScan({ mode: "plan" });
                            } finally {
                                console.log = log;
                                console.error = error;
                            }
                        })();
                        if (Array.isArray(planned?.willUpdate)) {
                            plan.push(...planned.willUpdate);
                        }
                    }
                    return { status, plan: [...new Set(plan)].filter(Boolean).sort() };
                });
                const lessons = withRepoRoot(rootDir, () => {
                    const result = readLessonsFile();
                    return Array.isArray(result?.value?.lessons) ? result.value.lessons : [];
                });
                const loop = listRecentLoopEvents({ limit: 80, maxBytes: 1_000_000 }, rootDir);
                const virtual = createVirtualTask({ goal, deep, repoRoot: rootDir });
                const contract = buildRuntimeContract({
                    repoRoot: rootDir,
                    task: virtual.task,
                    scan,
                    workset: {
                        mode: deep ? "deep" : "digest",
                        files: virtual.relatedFiles,
                        summary: "",
                        text: virtual.workset,
                    },
                    prompt: virtual.prompt,
                    lessons,
                    loop,
                    runtime: { writeEnabled: Boolean(enableWrite) },
                    nextActions: scan.status === "fresh" ? [] : ["repo-context-kit scan"],
                    executionState: { sessionId: null, pauseId: null, phase: "planning", status: "planned" },
                });
                const validation = validateRuntimeContract(contract);
                if (!validation.valid) {
                    const error = new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
                    error.code = "INVALID_CONTRACT";
                    throw error;
                }
                return asTextResult(serializeRuntimeContract(contract));
            },
        ),
        tool(
            "rck.runtime.risks",
            "Compute runtime risks for a goal (read-only). Returns structured risks and a bounded summary without writing files.",
            {
                type: "object",
                additionalProperties: false,
                required: ["goal"],
                properties: {
                    goal: { type: "string" },
                    deep: { type: "boolean" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const goal = input.goal;
                if (!isNonEmptyString(goal)) {
                    throw new Error("goal is required");
                }
                const deep = pickBoolean(input.deep, false);
                const planned = await (async () => {
                    const runtimePlan = await (async () => {
                        const requiredPaths = [
                            path.resolve(rootDir, "AGENTS.md"),
                            path.resolve(rootDir, ".aidw"),
                            path.resolve(rootDir, "task/task.md"),
                        ];
                        const missing = requiredPaths.filter((filePath) => !fs.existsSync(filePath));
                        if (missing.length > 0) {
                            const error = new Error("Project is not initialized. Run repo-context-kit init first.");
                            error.code = "NOT_INITIALIZED";
                            throw error;
                        }
                        const scan = await withRepoRoot(rootDir, async () => {
                            const required = [
                                path.resolve(rootDir, ".aidw/project.md"),
                                path.resolve(rootDir, ".aidw/system-overview.md"),
                                path.resolve(rootDir, ".aidw/index/summary.json"),
                            ];
                            if (required.some((filePath) => !fs.existsSync(filePath))) {
                                return { status: "missing", plan: [] };
                            }
                            const { update } = computeScanCheckState();
                            return { status: update?.changed ? "stale" : "fresh", plan: [] };
                        });
                        const lessons = withRepoRoot(rootDir, () => {
                            const result = readLessonsFile();
                            return Array.isArray(result?.value?.lessons) ? result.value.lessons : [];
                        });
                        const loop = listRecentLoopEvents({ limit: 80, maxBytes: 1_000_000 }, rootDir);
                        const virtual = createVirtualTask({ goal, deep, repoRoot: rootDir });
                        return buildRuntimeContract({
                            repoRoot: rootDir,
                            task: virtual.task,
                            scan,
                            workset: {
                                mode: deep ? "deep" : "digest",
                                files: virtual.relatedFiles,
                                summary: "",
                                text: virtual.workset,
                            },
                            prompt: virtual.prompt,
                            lessons,
                            loop,
                            runtime: { writeEnabled: Boolean(enableWrite) },
                            nextActions: [],
                            executionState: { sessionId: null, pauseId: null, phase: "planning", status: "planned" },
                        });
                    })();
                    const validation = validateRuntimeContract(runtimePlan);
                    if (!validation.valid) {
                        const error = new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
                        error.code = "INVALID_CONTRACT";
                        throw error;
                    }
                    return runtimePlan;
                })();
                return asTextResult(serializeJson({
                    runtimeVersion: planned.runtimeVersion,
                    risks: planned.risks,
                    summary: renderRuntimeRiskSummary(planned.risks, { maxChars: 1200, maxItems: 10 }),
                }));
            },
        ),
        tool(
            "rck.runtime.inspect",
            "Inspect a recorded runtime session metadata by sessionId (read-only). Does not return prompt or source code.",
            {
                type: "object",
                additionalProperties: false,
                required: ["sessionId"],
                properties: {
                    sessionId: { type: "string" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const sessionId = input.sessionId;
                if (!isNonEmptyString(sessionId)) {
                    throw new Error("sessionId is required");
                }
                const match = inspectRuntimeSession(sessionId, rootDir);
                const scan = await withRepoRoot(rootDir, async () => {
                    const required = [
                        path.resolve(rootDir, ".aidw/project.md"),
                        path.resolve(rootDir, ".aidw/system-overview.md"),
                        path.resolve(rootDir, ".aidw/index/summary.json"),
                    ];
                    if (required.some((filePath) => !fs.existsSync(filePath))) {
                        return { status: "missing", plan: [] };
                    }
                    const { update } = computeScanCheckState();
                    return { status: update?.changed ? "stale" : "fresh", plan: [] };
                });
                const lessons = withRepoRoot(rootDir, () => {
                    const result = readLessonsFile();
                    return Array.isArray(result?.value?.lessons) ? result.value.lessons : [];
                });
                const loop = listRecentLoopEvents({ limit: 80, maxBytes: 1_000_000 }, rootDir);
                const contract = buildRuntimeContract({
                    repoRoot: rootDir,
                    task: match?.taskId ? { id: match.taskId, title: "-" } : null,
                    scan,
                    workset: { mode: match?.worksetMode || "digest", files: [], summary: "", text: "" },
                    prompt: "",
                    lessons,
                    loop,
                    runtime: { writeEnabled: Boolean(enableWrite) },
                    nextActions: [],
                    executionState: { sessionId, pauseId: match?.pauseId ?? null, phase: null, status: match?.status ?? null },
                });
                const validation = validateRuntimeContract(contract);
                return asTextResult(serializeJson({
                    runtimeVersion: contract.runtimeVersion,
                    sessionId,
                    match,
                    risks: contract.risks,
                    validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
                }));
            },
        ),
        tool(
            "rck.runtime.snapshot.list",
            "List recent runtime snapshots (read-only). Does not return prompt or source code.",
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    limit: { type: "number" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const limitRaw = Number(input.limit ?? 20);
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
                const snapshots = listSnapshots({ repoRoot: rootDir, limit });
                const rows = snapshots.map(({ contract, validation, ...row }) => row);
                return asTextResult(serializeJson({ snapshots: rows }));
            },
        ),
        tool(
            "rck.runtime.snapshot.read",
            "Read one runtime snapshot by snapshotId (read-only). Snapshot is bounded and does not include source code.",
            {
                type: "object",
                additionalProperties: false,
                required: ["snapshotId"],
                properties: {
                    snapshotId: { type: "string" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const snapshotId = input.snapshotId;
                if (!isNonEmptyString(snapshotId)) {
                    throw new Error("snapshotId is required");
                }
                const snapshot = readSnapshot({ repoRoot: rootDir, snapshotId });
                if (!snapshot) {
                    const error = new Error("Snapshot not found.");
                    error.code = "NOT_FOUND";
                    throw error;
                }
                const validation = validateRuntimeContract(snapshot.contract);
                if (!validation.valid) {
                    const error = new Error(`Invalid snapshot contract: ${validation.errors.join("; ")}`);
                    error.code = "INVALID_CONTRACT";
                    throw error;
                }
                return asTextResult(serializeJson({
                    snapshotId: snapshot.snapshotId,
                    runtimeVersion: snapshot.runtimeVersion,
                    timestamp: snapshot.timestamp,
                    mode: snapshot.mode,
                    goal: snapshot.goal,
                    taskId: snapshot.taskId,
                    status: snapshot.status,
                    riskCount: snapshot.riskCount,
                    blockerCount: snapshot.blockerCount,
                    warningCount: snapshot.warningCount,
                    contract: snapshot.contract,
                    validation: snapshot.validation,
                }));
            },
        ),
        tool(
            "rck.runtime.snapshot.diff",
            "Diff two runtime snapshots (bounded structural diff, read-only).",
            {
                type: "object",
                additionalProperties: false,
                required: ["from", "to"],
                properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const from = input.from;
                const to = input.to;
                if (!isNonEmptyString(from) || !isNonEmptyString(to)) {
                    throw new Error("from and to are required");
                }
                const diff = diffSnapshots({ repoRoot: rootDir, from, to });
                if (!diff.ok) {
                    const error = new Error(diff.error || "Diff failed.");
                    error.code = "NOT_FOUND";
                    throw error;
                }
                return asTextResult(serializeJson(diff));
            },
        ),
        tool(
            "rck.runtime.explain",
            "Explain one runtime snapshot (read-only). Returns a bounded, human-readable explanation.",
            {
                type: "object",
                additionalProperties: false,
                required: ["snapshotId"],
                properties: {
                    snapshotId: { type: "string" },
                },
            },
            async (args) => {
                const input = normalizeArgs(args);
                const snapshotId = input.snapshotId;
                if (!isNonEmptyString(snapshotId)) {
                    throw new Error("snapshotId is required");
                }
                const snapshot = readSnapshot({ repoRoot: rootDir, snapshotId });
                if (!snapshot) {
                    const error = new Error("Snapshot not found.");
                    error.code = "NOT_FOUND";
                    throw error;
                }
                const validation = validateRuntimeContract(snapshot.contract);
                if (!validation.valid) {
                    const error = new Error(`Invalid snapshot contract: ${validation.errors.join("; ")}`);
                    error.code = "INVALID_CONTRACT";
                    throw error;
                }
                const explain = explainRuntimeContract(snapshot.contract);
                const output = [
                    "# Runtime Snapshot Explain",
                    "",
                    `- snapshotId: ${snapshot.snapshotId}`,
                    `- runtimeVersion: ${snapshot.runtimeVersion}`,
                    `- timestamp: ${snapshot.timestamp}`,
                    `- mode: ${snapshot.mode}`,
                    "",
                    explain.trimEnd(),
                    "",
                ].join("\n");
                return asTextResult(output);
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
            tool(
                "rck.auto.start",
                "Start an auto workflow (equivalent to: repo-context-kit auto --goal \"...\" --json). Creates task + executor pause, but does not run tests or modify source code.",
                {
                    type: "object",
                    additionalProperties: false,
                    required: ["goal"],
                    properties: {
                        goal: { type: "string" },
                        deep: { type: "boolean" },
                    },
                },
                async (args) => {
                    const input = normalizeArgs(args);
                    const goal = input.goal;
                    if (!isNonEmptyString(goal)) {
                        throw new Error("goal is required");
                    }
                    const deep = pickBoolean(input.deep, false);
                    const result = await orchestrateAuto({
                        rootDir,
                        goal,
                        deep,
                        dryRun: false,
                        allowWrite: true,
                    });
                    const contract = result.contract ?? null;
                    if (contract) {
                        const validation = validateRuntimeContract(contract);
                        if (!validation.valid) {
                            const error = new Error(`Invalid runtime contract: ${validation.errors.join("; ")}`);
                            error.code = "INVALID_CONTRACT";
                            throw error;
                        }
                        return asTextResult(serializeRuntimeContract(contract));
                    }
                    return asTextResult(serializeJson(result));
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
