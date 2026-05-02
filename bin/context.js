#!/usr/bin/env node
import path from "path";
import {
    CONTEXT_INDEX_ENTRYPOINTS_PATH,
    CONTEXT_INDEX_FILES_PATH,
    CONTEXT_INDEX_FILE_GROUPS_PATH,
    CONTEXT_INDEX_SUMMARY_PATH,
    CONTEXT_INDEX_SYMBOLS_PATH,
    CONTEXT_PROJECT_MD_PATH,
    TASK_REGISTRY_PATH,
} from "../src/scan/constants.js";
import { exists, listDirSafe, readJson, readText } from "../src/scan/fs-utils.js";
import { listTaskFiles } from "../src/scan/task-files.js";
import { getRegistryStatusBreakdown, parseTaskRegistry } from "../src/scan/task-registry.js";
import { formatLoopEventsMarkdown, listRecentLoopEvents } from "../src/loop/store.js";
import { evaluateContextLoop } from "../src/loop/analyze.js";
import { getCachedBriefDigest, writeBriefDigestCache } from "../src/loop/context-cache.js";

const LIMITS = {
    brief: {
        maxChars: 8000,
    },
    "next-task": {
        maxChars: 12000,
        maxDependencySummaries: 3,
    },
    workset: {
        maxChars: 16000,
        maxRelatedFiles: 12,
        maxRelatedSymbols: 30,
        maxDependencySummaries: 3,
    },
    "workset-deep": {
        maxChars: 24000,
        maxRelatedFiles: 24,
        maxRelatedSymbols: 60,
        maxDependencySummaries: 3,
    },
    "workset-digest": {
        maxChars: 7000,
        maxRelatedFiles: 6,
        maxRelatedSymbols: 8,
        maxDependencySummaries: 3,
    },
};

function readTextSafe(filePath) {
    if (!exists(filePath)) {
        return "";
    }

    try {
        return readText(filePath);
    } catch {
        return "";
    }
}

function normalizeStatus(status) {
    return String(status ?? "").trim().toLowerCase();
}

function normalizeDependencies(dependencies) {
    const raw = String(dependencies ?? "").trim();

    if (!raw || raw === "-") {
        return [];
    }

    return raw
        .split(/[, ]+/)
        .map((dependency) => dependency.trim())
        .filter(Boolean);
}

function formatList(items) {
    if (items.length === 0) {
        return "- None";
    }

    return items.map((item) => `- ${item}`).join("\n");
}

function extractSection(content, heading) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `^##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s+|$)`,
        "im",
    );
    const match = content.match(regex);

    return match?.groups?.body?.trim() ?? "";
}

function extractFirstAvailableSection(content, headings) {
    for (const heading of headings) {
        const section = extractSection(content, heading);

        if (section) {
            return {
                heading,
                section,
            };
        }
    }

    return null;
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength - 15).trimEnd()}\n[truncated]`;
}

function readPackageMetadata() {
    const pkg = readJson("package.json");

    if (!pkg) {
        return [];
    }

    const lines = [
        pkg.name ? `name: ${pkg.name}` : null,
        pkg.version ? `version: ${pkg.version}` : null,
        pkg.description ? `description: ${pkg.description}` : null,
        pkg.type ? `module type: ${pkg.type}` : null,
        pkg.license ? `license: ${pkg.license}` : null,
    ].filter(Boolean);

    if (pkg.bin) {
        const bins = typeof pkg.bin === "string"
            ? [`package -> ${pkg.bin}`]
            : Object.entries(pkg.bin).map(([name, file]) => `${name} -> ${file}`);
        lines.push(`bin: ${bins.join(", ")}`);
    }

    return lines;
}

function readProjectContext() {
    const content = readTextSafe(CONTEXT_PROJECT_MD_PATH);
    const purpose = extractFirstAvailableSection(content, [
        "Project Role",
        "Overview",
        "Project Context",
        "Manual Notes",
    ]);
    const rules = [
        extractSection(content, "AI Working Rules"),
        extractSection(content, "Editing Boundaries"),
    ].filter(Boolean);
    const riskAreas = extractSection(content, "High-Risk Areas") || extractSection(content, "Risk Areas");

    return {
        exists: Boolean(content),
        purpose,
        rules,
        riskAreas,
    };
}

function getTaskRegistrySummary(registry = parseTaskRegistry()) {
    if (!registry.exists) {
        return "Task registry missing.";
    }

    const counts = getRegistryStatusBreakdown(registry.tasks);

    return [
        `total: ${registry.tasks.length}`,
        `todo: ${counts.todo}`,
        `in_progress: ${counts.in_progress}`,
        `blocked: ${counts.blocked}`,
        `done: ${counts.done}`,
        `cancelled: ${counts.cancelled}`,
    ].join(", ");
}

function findTaskFileMismatchWarnings(registry) {
    const warnings = [];

    if (!registry.exists && listTaskFiles().length > 0) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing but task files exist.`);
    }

    return warnings;
}

function taskById(registry, taskId) {
    return registry.tasks.find((task) => task.id.toLowerCase() === taskId.toLowerCase()) ?? null;
}

function selectNextTask(registry) {
    const doneIds = new Set(
        registry.tasks
            .filter((task) => normalizeStatus(task.status) === "done")
            .map((task) => task.id),
    );
    const inProgress = registry.tasks.find(
        (task) => normalizeStatus(task.status) === "in_progress",
    );

    if (inProgress) {
        return inProgress;
    }

    return registry.tasks.find((task) => {
        if (normalizeStatus(task.status) !== "todo") {
            return false;
        }

        return normalizeDependencies(task.dependencies).every((dependency) =>
            doneIds.has(dependency),
        );
    }) ?? null;
}

function summarizeTaskDetail(content) {
    const headings = ["Goal", "Scope", "Acceptance Criteria"];
    const sections = headings
        .map((heading) => ({
            heading,
            body: extractSection(content, heading),
        }))
        .filter((section) => section.body);

    if (sections.length === 0) {
        return truncateText(content.trim(), 3000);
    }

    return sections
        .map((section) => `## ${section.heading}\n\n${section.body}`)
        .join("\n\n");
}

function summarizeDependency(task) {
    return `${task.id}: ${task.title} (${task.status || "unknown"})`;
}

function getDependencySummaries(task, registry, maxDependencySummaries, warnings) {
    const dependencies = normalizeDependencies(task?.dependencies);
    const summaries = [];

    for (const dependencyId of dependencies.slice(0, maxDependencySummaries)) {
        const dependency = taskById(registry, dependencyId);

        if (!dependency) {
            warnings.push(`Dependency ${dependencyId} is listed but not found in ${TASK_REGISTRY_PATH}.`);
            continue;
        }

        summaries.push(summarizeDependency(dependency));
    }

    if (dependencies.length > maxDependencySummaries) {
        warnings.push(`Dependency summaries limited to ${maxDependencySummaries}.`);
    }

    return summaries;
}

function tokenize(text) {
    return [
        ...new Set(
            String(text ?? "")
                .toLowerCase()
                .match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [],
        ),
    ].filter((token) => !["task", "with", "from", "that", "this", "only"].includes(token));
}

function scoreText(text, keywords) {
    const haystack = String(text ?? "").toLowerCase();

    return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function selectRelatedFiles(task, detailContent, limits, warnings) {
    const files = readJson(CONTEXT_INDEX_FILES_PATH);
    const entrypoints = readJson(CONTEXT_INDEX_ENTRYPOINTS_PATH);
    const fileGroups = readJson(CONTEXT_INDEX_FILE_GROUPS_PATH);

    if (!files) {
        warnings.push(`${CONTEXT_INDEX_FILES_PATH} is missing. Run repo-context-kit scan.`);
        return [];
    }
    if (!entrypoints) {
        warnings.push(`${CONTEXT_INDEX_ENTRYPOINTS_PATH} is missing. Run repo-context-kit scan.`);
    }
    if (!fileGroups) {
        warnings.push(`${CONTEXT_INDEX_FILE_GROUPS_PATH} is missing. Run repo-context-kit scan.`);
    }

    const keywords = tokenize(`${task.id} ${task.title} ${detailContent}`);
    const explicitPaths = new Set(
        (detailContent.match(/(?:bin|src|test|tests|app|template|site)\/[A-Za-z0-9._/-]+/g) ?? [])
            .map((filePath) => filePath.replace(/[),.;]+$/g, "")),
    );
    const entrypointPaths = new Set((Array.isArray(entrypoints) ? entrypoints : []).map((entry) => entry.path));
    const groupKeyFiles = new Set(
        (Array.isArray(fileGroups) ? fileGroups : [])
            .flatMap((group) => group.keyFiles ?? []),
    );

    return files
        .map((file) => {
            const textScore = scoreText(`${file.path} ${file.description} ${file.type}`, keywords);
            const explicit = explicitPaths.has(file.path);
            const entrypoint = entrypointPaths.has(file.path);
            const groupKey = groupKeyFiles.has(file.path);
            const score = textScore + (explicit ? 5 : 0) + (entrypoint ? 2 : 0) + (groupKey ? 1 : 0);

            if (score <= 0) {
                return null;
            }

            const reasons = [
                explicit ? "mentioned in task detail" : null,
                textScore > 0 ? `matched task keywords (${textScore})` : null,
                entrypoint ? "known entry point" : null,
                groupKey ? "key file in indexed file group" : null,
            ].filter(Boolean);

            return {
                path: file.path,
                description: file.description,
                confidence: Math.min(0.95, Number(file.confidence ?? 0.5) + score * 0.03),
                reason: reasons.join("; "),
                score,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.path.localeCompare(b.path))
        .slice(0, limits.maxRelatedFiles);
}

function selectRelatedSymbols(task, detailContent, relatedFiles, limits, warnings) {
    const symbols = readJson(CONTEXT_INDEX_SYMBOLS_PATH);

    if (!symbols) {
        warnings.push(`${CONTEXT_INDEX_SYMBOLS_PATH} is missing. Run repo-context-kit scan.`);
        return [];
    }

    const keywords = tokenize(`${task.id} ${task.title} ${detailContent}`);
    const relatedFilePaths = new Set(relatedFiles.map((file) => file.path));

    return symbols
        .map((symbol) => {
            const fileMatch = relatedFilePaths.has(symbol.file);
            const textScore = scoreText(`${symbol.name} ${symbol.file} ${symbol.description}`, keywords);
            const score = textScore + (fileMatch ? 2 : 0);

            if (score <= 0) {
                return null;
            }

            return {
                name: symbol.name,
                type: symbol.type,
                file: symbol.file,
                confidence: Math.min(0.95, Number(symbol.confidence ?? 0.5) + score * 0.03),
                reason: [
                    fileMatch ? "defined in selected related file" : null,
                    textScore > 0 ? `matched task keywords (${textScore})` : null,
                ].filter(Boolean).join("; "),
                score,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.file.localeCompare(b.file))
        .slice(0, limits.maxRelatedSymbols);
}

function renderManifest(manifest) {
    const warnings = [...new Set(manifest.warnings)];

    return [
        "## Context Manifest",
        "",
        `- context level: ${manifest.level}`,
        `- selected task id: ${manifest.taskId ?? "none"}`,
        `- included sources: ${manifest.includedSources.length ? manifest.includedSources.join(", ") : "none"}`,
        `- excluded sources: ${manifest.excludedSources.length ? manifest.excludedSources.join(", ") : "none"}`,
        `- limits used: ${manifest.limits}`,
        `- warnings: ${warnings.length ? warnings.join(" | ") : "none"}`,
    ].join("\n");
}

function renderWarningsSummary(warnings, options = {}) {
    const unique = [...new Set(warnings)];
    if (unique.length === 0) {
        return "";
    }
    if (options.verbose) {
        return `## Warnings\n\n${formatList(unique)}`;
    }
    const shown = unique.slice(0, 3);
    const more = unique.length - shown.length;
    const suffix = more > 0 ? ` (+${more} more; use --verbose)` : "";
    return `## Warnings\n\n${formatList(shown)}${suffix ? `\n\n- ${suffix}` : ""}`;
}

function renderMeta(manifest, options = {}) {
    const warnings = [...new Set(manifest.warnings)];
    const lines = [
        "## Context Meta",
        "",
        `- level: ${manifest.level}`,
        `- selected task id: ${manifest.taskId ?? "none"}`,
        `- included sources: ${manifest.includedSources.length}`,
        `- excluded sources: ${manifest.excludedSources.length}`,
        `- limits: ${manifest.limits}`,
        `- warnings: ${warnings.length}`,
    ];
    if (options.manifest) {
        lines.push("", renderManifest(manifest));
    }
    return lines.join("\n");
}

function renderBounded(bodyParts, manifest, maxChars, options = {}) {
    let body = bodyParts.filter(Boolean).join("\n\n").trim();
    const warningsBlock = renderWarningsSummary(manifest.warnings, options);
    const metaText = renderMeta(manifest, options);
    const footerParts = [warningsBlock, metaText].filter(Boolean).join("\n\n");
    let output = `${body}${footerParts ? `\n\n${footerParts}` : ""}\n`;

    if (output.length <= maxChars) {
        return output;
    }

    manifest.warnings.push(`Output exceeded ${maxChars} characters and was truncated.`);
    const nextWarningsBlock = renderWarningsSummary(manifest.warnings, options);
    const nextMetaText = renderMeta(manifest, options);
    const nextFooter = [nextWarningsBlock, nextMetaText].filter(Boolean).join("\n\n");
    const bodyLimit = Math.max(0, maxChars - nextFooter.length - 20);
    body = truncateText(body, bodyLimit);
    output = `${body}${nextFooter ? `\n\n${nextFooter}` : ""}\n`;

    if (output.length <= maxChars) {
        return output;
    }

    return output.slice(0, Math.max(0, maxChars - 14)).trimEnd() + "\n[truncated]\n";
}

function formatLoopDigest(options = {}) {
    const result = evaluateContextLoop({ taskId: options.taskId ?? null });
    const lastTest = result.mostRecentTest;
    const lastTestSummary = lastTest
        ? `${lastTest.ok ? "pass" : "fail"} (exit ${lastTest.exitCode ?? "?"})${lastTest.command ? `: ${lastTest.command}` : ""}`
        : "-";

    const topFail = result.patterns.topFailingCommands?.[0]?.command ?? "-";

    return [
        `- decision: ${result.constraints.blockNewTask ? "BLOCK_NEW_TASK" : "ALLOW_NEW_TASK"}`,
        `- unstable: ${result.constraints.unstable ? "true" : "false"}`,
        `- last_test: ${lastTestSummary}`,
        `- failure_streak: ${result.patterns.failureStreak}`,
        `- top_failing_command: ${topFail}`,
        `- require_rca: ${result.constraints.requireRootCauseAnalysis ? "true" : "false"}`,
    ].join("\n");
}

function buildBrief(options = {}) {
    const warnings = [];
    const registry = parseTaskRegistry();
    const project = readProjectContext();
    const summary = readJson(CONTEXT_INDEX_SUMMARY_PATH);
    const metadata = readPackageMetadata();
    const includedSources = [];
    const digest = Boolean(options.digest);
    const rawLoop = Boolean(options.rawLoop);
    const loopEvents = listRecentLoopEvents({ limit: digest ? 3 : 6 });

    warnings.push(...findTaskFileMismatchWarnings(registry));

    if (!summary) {
        warnings.push(`${CONTEXT_INDEX_SUMMARY_PATH} is missing. Run repo-context-kit scan.`);
    }

    const parts = ["# Project Context Brief"];

    if (metadata.length > 0) {
        includedSources.push("package.json");
        parts.push(`## Package Metadata\n\n${formatList(metadata)}`);
    }

    if (project.exists) {
        includedSources.push(CONTEXT_PROJECT_MD_PATH);
        if (project.purpose) {
            parts.push(`## Project Purpose\n\n${truncateText(project.purpose.section, 1800)}`);
        }
        if (project.rules.length > 0) {
            parts.push(`## Project Boundaries / AI Working Rules\n\n${truncateText(project.rules.join("\n\n"), 2600)}`);
        }
    }

    if (summary) {
        includedSources.push(CONTEXT_INDEX_SUMMARY_PATH);
        if (digest) {
            const minimal = {
                generatedAt: summary.generatedAt,
                indexedFiles: summary.indexedFiles,
                indexedSymbols: summary.indexedSymbols,
                fileGroups: summary.fileGroups,
                truncated: summary.truncated,
            };
            parts.push(`## Scan Summary (Digest)\n\n\`\`\`json\n${JSON.stringify(minimal, null, 2)}\n\`\`\``);
        } else {
            parts.push(`## Scan Summary\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``);
        }
    }

    if (registry.exists) {
        includedSources.push(TASK_REGISTRY_PATH);
        parts.push(`## Task Registry Summary\n\n${getTaskRegistrySummary(registry)}`);
    }

    if (digest) {
        parts.push(`## Context Loop Digest\n\n${formatLoopDigest({ taskId: null })}`);
        if (rawLoop) {
            parts.push(`## Recent Context Loop (Raw)\n\n${formatLoopEventsMarkdown(loopEvents)}`);
        }
    } else {
        parts.push(`## Recent Context Loop\n\n${formatLoopEventsMarkdown(loopEvents)}`);
    }

    return renderBounded(parts, {
        level: "brief",
        taskId: null,
        includedSources,
        excludedSources: [
            CONTEXT_INDEX_FILES_PATH,
            CONTEXT_INDEX_SYMBOLS_PATH,
            "task/*.md task detail files",
            "full generated indexes",
        ],
        limits: `maxChars=${LIMITS.brief.maxChars}`,
        warnings,
    }, LIMITS.brief.maxChars, options);
}

function buildTaskContext(task, registry, level, limits, warnings, options = {}) {
    const includedSources = [TASK_REGISTRY_PATH];
    const parts = [`# ${level === "next-task" ? "Next Task Context" : "Task Context"}`];
    const digest = Boolean(options.digest);
    const rawLoop = Boolean(options.rawLoop);
    const loopEvents = listRecentLoopEvents({ limit: digest ? 3 : 6, taskId: task.id });

    parts.push([
        "## Registry Metadata",
        "",
        `- id: ${task.id}`,
        `- title: ${task.title}`,
        `- status: ${task.status || "unknown"}`,
        `- priority: ${task.priority || "-"}`,
        `- owner: ${task.owner || "-"}`,
        `- dependencies: ${task.dependencies || "-"}`,
        `- file: ${task.file || "-"}`,
    ].join("\n"));

    let detailContent = "";
    if (task.file && exists(task.file)) {
        includedSources.push(task.file);
        detailContent = readText(task.file);
        parts.push(`## Selected Task Detail\n\n${summarizeTaskDetail(detailContent)}`);
    } else if (task.file) {
        warnings.push(`Selected task detail file is missing: ${task.file}.`);
    } else {
        warnings.push(`Selected task ${task.id} has no detail file listed.`);
    }

    const dependencySummaries = getDependencySummaries(
        task,
        registry,
        limits.maxDependencySummaries,
        warnings,
    );
    parts.push(`## Dependency Summaries\n\n${formatList(dependencySummaries)}`);
    if (digest) {
        parts.push(`## Context Loop Digest\n\n${formatLoopDigest({ taskId: task.id })}`);
        if (rawLoop) {
            parts.push(`## Recent Context Loop (Raw)\n\n${formatLoopEventsMarkdown(loopEvents)}`);
        }
    } else {
        parts.push(`## Recent Context Loop\n\n${formatLoopEventsMarkdown(loopEvents)}`);
    }

    return {
        parts,
        includedSources,
        detailContent,
    };
}

function buildNextTask(options = {}) {
    const warnings = [];
    const registry = parseTaskRegistry();
    warnings.push(...findTaskFileMismatchWarnings(registry));
    const digest = Boolean(options.digest);

    if (!registry.exists) {
        return renderBounded(["# Next Task Context", "No task registry is available."], {
            level: "next-task",
            taskId: null,
            includedSources: [],
            excludedSources: ["task/*.md task detail files", "generated indexes"],
            limits: `maxChars=${LIMITS["next-task"].maxChars}, maxDependencySummaries=${LIMITS["next-task"].maxDependencySummaries}`,
            warnings,
        }, LIMITS["next-task"].maxChars);
    }

    const task = selectNextTask(registry);
    if (!task) {
        return renderBounded(["# Next Task Context", "No available task found. All tasks are done, blocked, cancelled, or waiting on unfinished dependencies."], {
            level: "next-task",
            taskId: null,
            includedSources: [TASK_REGISTRY_PATH],
            excludedSources: ["task/*.md task detail files", "generated indexes"],
            limits: `maxChars=${LIMITS["next-task"].maxChars}, maxDependencySummaries=${LIMITS["next-task"].maxDependencySummaries}`,
            warnings,
        }, LIMITS["next-task"].maxChars);
    }

    const taskContext = buildTaskContext(task, registry, "next-task", LIMITS["next-task"], warnings, options);

    return renderBounded(taskContext.parts, {
        level: "next-task",
        taskId: task.id,
        includedSources: taskContext.includedSources,
        excludedSources: [
            "unselected task detail files",
            CONTEXT_INDEX_FILES_PATH,
            CONTEXT_INDEX_SYMBOLS_PATH,
            "full generated indexes",
        ],
        limits: `maxChars=${LIMITS["next-task"].maxChars}, maxDependencySummaries=${LIMITS["next-task"].maxDependencySummaries}`,
        warnings,
    }, LIMITS["next-task"].maxChars, options);
}

function selectDigestSymbols(symbols = [], maxTotal = 8) {
    const picked = [];
    const seenFiles = new Set();
    for (const symbol of symbols) {
        if (!symbol?.file) {
            continue;
        }
        if (seenFiles.has(symbol.file)) {
            continue;
        }
        seenFiles.add(symbol.file);
        picked.push(symbol);
        if (picked.length >= maxTotal) {
            break;
        }
    }
    return picked;
}

function buildWorksetDigest(taskId, warnings = [], options = {}) {
    const registry = parseTaskRegistry();
    warnings.push(...findTaskFileMismatchWarnings(registry));

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBounded(["# Workset Context", "Usage: repo-context-kit context workset <taskId> [--digest] [--deep]"], {
            level: "workset --digest",
            taskId: null,
            includedSources: [],
            excludedSources: ["task detail files", "generated indexes"],
            limits: `maxChars=${LIMITS["workset-digest"].maxChars}, maxRelatedFiles=${LIMITS["workset-digest"].maxRelatedFiles}, maxRelatedSymbols=${LIMITS["workset-digest"].maxRelatedSymbols}, maxDependencySummaries=${LIMITS["workset-digest"].maxDependencySummaries}`,
            warnings,
        }, LIMITS["workset-digest"].maxChars);
    }

    if (!registry.exists) {
        return renderBounded(["# Workset Context", "No task registry is available."], {
            level: "workset --digest",
            taskId,
            includedSources: [],
            excludedSources: ["task detail files", "generated indexes"],
            limits: `maxChars=${LIMITS["workset-digest"].maxChars}, maxRelatedFiles=${LIMITS["workset-digest"].maxRelatedFiles}, maxRelatedSymbols=${LIMITS["workset-digest"].maxRelatedSymbols}, maxDependencySummaries=${LIMITS["workset-digest"].maxDependencySummaries}`,
            warnings,
        }, LIMITS["workset-digest"].maxChars);
    }

    const task = taskById(registry, taskId);
    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBounded(["# Workset Context", `Task not found: ${taskId}`], {
            level: "workset --digest",
            taskId,
            includedSources: [TASK_REGISTRY_PATH],
            excludedSources: ["task detail files", "generated indexes"],
            limits: `maxChars=${LIMITS["workset-digest"].maxChars}, maxRelatedFiles=${LIMITS["workset-digest"].maxRelatedFiles}, maxRelatedSymbols=${LIMITS["workset-digest"].maxRelatedSymbols}, maxDependencySummaries=${LIMITS["workset-digest"].maxDependencySummaries}`,
            warnings,
        }, LIMITS["workset-digest"].maxChars);
    }

    const limits = LIMITS["workset-digest"];
    const taskContext = buildTaskContext(task, registry, "workset", limits, warnings, options);
    const relatedFiles = selectRelatedFiles(task, taskContext.detailContent, limits, warnings);
    const relatedSymbolsRaw = selectRelatedSymbols(task, taskContext.detailContent, relatedFiles, limits, warnings);
    const relatedSymbols = selectDigestSymbols(relatedSymbolsRaw, limits.maxRelatedSymbols);
    const entrypoints = readJson(CONTEXT_INDEX_ENTRYPOINTS_PATH);
    const project = readProjectContext();
    const includedSources = [...taskContext.includedSources];

    if (project.exists) {
        includedSources.push(CONTEXT_PROJECT_MD_PATH);
    }
    if (!readJson(CONTEXT_INDEX_SUMMARY_PATH)) {
        warnings.push(`${CONTEXT_INDEX_SUMMARY_PATH} is missing. Run repo-context-kit scan.`);
    }
    if (readJson(CONTEXT_INDEX_FILES_PATH)) {
        includedSources.push(CONTEXT_INDEX_FILES_PATH);
    }
    if (readJson(CONTEXT_INDEX_SYMBOLS_PATH)) {
        includedSources.push(CONTEXT_INDEX_SYMBOLS_PATH);
    }
    if (entrypoints) {
        includedSources.push(CONTEXT_INDEX_ENTRYPOINTS_PATH);
    }

    const parts = [
        "# Workset Context (Digest)",
        ...taskContext.parts,
        `## Related File Candidates\n\n${formatList(relatedFiles.map((file) => `${file.path} (confidence ${file.confidence.toFixed(2)}): ${file.reason}`))}`,
    ];

    if (Array.isArray(entrypoints)) {
        parts.push(`## Relevant Entry Points\n\n${formatList(entrypoints.slice(0, 3).map((entry) => `${entry.path} (${entry.name}, confidence ${Number(entry.confidence ?? 0).toFixed(2)})`))}`);
    }

    if (project.riskAreas) {
        parts.push(`## Relevant Risk Areas\n\n${truncateText(project.riskAreas, 700)}`);
    }

    parts.push(`## Related Symbols\n\n${formatList(relatedSymbols.map((symbol) => `${symbol.name} (${symbol.type}) in ${symbol.file} (confidence ${symbol.confidence.toFixed(2)}): ${symbol.reason}`))}`);
    parts.push(`## Suggested Read Order\n\n${formatList([
        task.file,
        ...normalizeDependencies(task.dependencies).map((dependencyId) => taskById(registry, dependencyId)?.file).filter(Boolean),
        ...relatedFiles.map((file) => file.path),
    ].filter(Boolean).slice(0, limits.maxRelatedFiles + 1))}`);

    return renderBounded(parts, {
        level: "workset --digest",
        taskId: task.id,
        includedSources: [...new Set(includedSources)],
        excludedSources: ["unselected task detail files", "full files.json dump", "full symbols.json dump"],
        limits: `maxChars=${limits.maxChars}, maxRelatedFiles=${limits.maxRelatedFiles}, maxRelatedSymbols=${limits.maxRelatedSymbols}, maxDependencySummaries=${limits.maxDependencySummaries}`,
        warnings,
    }, limits.maxChars, options);
}

function buildWorkset(taskId, options = {}) {
    const deep = Boolean(options.deep);
    const digest = Boolean(options.digest) || options.mode === "digest";

    if (digest && !deep) {
        const warnings = [];
        return buildWorksetDigest(taskId, warnings, options);
    }

    const level = deep ? "workset --deep" : "workset";
    const limits = deep ? LIMITS["workset-deep"] : LIMITS.workset;
    const warnings = [];
    const registry = parseTaskRegistry();
    warnings.push(...findTaskFileMismatchWarnings(registry));

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBounded(["# Workset Context", "Usage: repo-context-kit context workset <taskId>"], {
            level,
            taskId: null,
            includedSources: [],
            excludedSources: ["task detail files", "generated indexes"],
            limits: `maxChars=${limits.maxChars}, maxRelatedFiles=${limits.maxRelatedFiles}, maxRelatedSymbols=${limits.maxRelatedSymbols}, maxDependencySummaries=${limits.maxDependencySummaries}`,
            warnings,
        }, limits.maxChars);
    }

    if (!registry.exists) {
        return renderBounded(["# Workset Context", "No task registry is available."], {
            level,
            taskId,
            includedSources: [],
            excludedSources: ["task detail files", "generated indexes"],
            limits: `maxChars=${limits.maxChars}, maxRelatedFiles=${limits.maxRelatedFiles}, maxRelatedSymbols=${limits.maxRelatedSymbols}, maxDependencySummaries=${limits.maxDependencySummaries}`,
            warnings,
        }, limits.maxChars);
    }

    const task = taskById(registry, taskId);
    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBounded(["# Workset Context", `Task not found: ${taskId}`], {
            level,
            taskId,
            includedSources: [TASK_REGISTRY_PATH],
            excludedSources: ["task detail files", "generated indexes"],
            limits: `maxChars=${limits.maxChars}, maxRelatedFiles=${limits.maxRelatedFiles}, maxRelatedSymbols=${limits.maxRelatedSymbols}, maxDependencySummaries=${limits.maxDependencySummaries}`,
            warnings,
        }, limits.maxChars);
    }

    const brief = buildBrief({ ...options, digest: true }).replace(/^## Context Meta[\s\S]*$/m, "").trim();
    const taskContext = buildTaskContext(task, registry, "workset", limits, warnings, options);
    const relatedFiles = selectRelatedFiles(task, taskContext.detailContent, limits, warnings);
    const relatedSymbols = selectRelatedSymbols(task, taskContext.detailContent, relatedFiles, limits, warnings);
    const entrypoints = readJson(CONTEXT_INDEX_ENTRYPOINTS_PATH);
    const project = readProjectContext();
    const includedSources = [...taskContext.includedSources];

    if (project.exists) {
        includedSources.push(CONTEXT_PROJECT_MD_PATH);
    }
    if (readJson(CONTEXT_INDEX_SUMMARY_PATH)) {
        includedSources.push(CONTEXT_INDEX_SUMMARY_PATH);
    } else {
        warnings.push(`${CONTEXT_INDEX_SUMMARY_PATH} is missing. Run repo-context-kit scan.`);
    }
    if (readJson(CONTEXT_INDEX_FILES_PATH)) {
        includedSources.push(CONTEXT_INDEX_FILES_PATH);
    }
    if (readJson(CONTEXT_INDEX_SYMBOLS_PATH)) {
        includedSources.push(CONTEXT_INDEX_SYMBOLS_PATH);
    }

    if (entrypoints) {
        includedSources.push(CONTEXT_INDEX_ENTRYPOINTS_PATH);
    }

    const parts = [
        brief,
        ...taskContext.parts,
        `## Related File Candidates\n\n${formatList(relatedFiles.map((file) => `${file.path} (confidence ${file.confidence.toFixed(2)}): ${file.reason}. ${file.description}`))}`,
    ];

    if (Array.isArray(entrypoints)) {
        parts.push(`## Relevant Entry Points\n\n${formatList(entrypoints.slice(0, 5).map((entry) => `${entry.path} (${entry.name}, confidence ${Number(entry.confidence ?? 0).toFixed(2)})`))}`);
    }

    if (project.riskAreas) {
        parts.push(`## Relevant Risk Areas\n\n${truncateText(project.riskAreas, 1800)}`);
    }

    parts.push(`## Related Symbols\n\n${formatList(relatedSymbols.map((symbol) => `${symbol.name} (${symbol.type}) in ${symbol.file} (confidence ${symbol.confidence.toFixed(2)}): ${symbol.reason}`))}`);
    parts.push(`## Suggested Read Order\n\n${formatList([
        task.file,
        ...normalizeDependencies(task.dependencies).map((dependencyId) => taskById(registry, dependencyId)?.file).filter(Boolean),
        ...relatedFiles.map((file) => file.path),
    ].filter(Boolean).slice(0, limits.maxRelatedFiles + 1))}`);

    return renderBounded(parts, {
        level,
        taskId: task.id,
        includedSources: [...new Set(includedSources)],
        excludedSources: ["unselected task detail files", "full files.json dump", "full symbols.json dump"],
        limits: `maxChars=${limits.maxChars}, maxRelatedFiles=${limits.maxRelatedFiles}, maxRelatedSymbols=${limits.maxRelatedSymbols}, maxDependencySummaries=${limits.maxDependencySummaries}`,
        warnings,
    }, limits.maxChars, options);
}

export function buildWorksetContext(taskId, options = {}) {
    return buildWorkset(taskId, options);
}

export async function runContext(args = []) {
    const subcommand = args.find((arg) => !arg.startsWith("--"));
    const deep = args.includes("--deep");
    const digestFlag = args.includes("--digest");
    const full = args.includes("--full");
    const digest = digestFlag || !full;
    const manifest = args.includes("--manifest");
    const verbose = args.includes("--verbose");
    const rawLoop = args.includes("--raw-loop");
    const noCache = args.includes("--no-cache");
    let output;

    if (subcommand === "brief") {
        const cached = digest && !noCache ? getCachedBriefDigest() : null;
        if (cached) {
            output = cached;
        } else {
            output = buildBrief({ digest, manifest, verbose, rawLoop });
            if (digest && !noCache) {
                writeBriefDigestCache(output);
            }
        }
    } else if (subcommand === "next-task") {
        output = buildNextTask({ digest, manifest, verbose, rawLoop });
    } else if (subcommand === "workset") {
        const worksetIndex = args.indexOf("workset");
        const taskId = args.slice(worksetIndex + 1).find((arg) => !arg.startsWith("--"));
        output = buildWorkset(taskId, { deep, digest: digestFlag || (!deep && !full), manifest, verbose, rawLoop });
    } else {
        console.error("Unknown context command.");
        console.log("Usage:");
        console.log("  repo-context-kit context brief");
        console.log("  repo-context-kit context next-task");
        console.log("  repo-context-kit context workset <taskId> [--digest] [--deep]");
        console.log("Options:");
        console.log("  --full       Disable digest output");
        console.log("  --manifest   Include full context manifest footer");
        console.log("  --verbose    Print all warnings instead of summarizing");
        console.log("  --raw-loop   Include raw recent loop events in addition to digest");
        console.log("  --no-cache   Disable brief digest cache");
        process.exitCode = 1;
        return {
            output: null,
        };
    }

    console.log(output.trimEnd());

    return {
        output,
    };
}
