#!/usr/bin/env node
import path from "path";
import { buildWorksetContext } from "./context.js";
import {
    CONTEXT_PROJECT_MD_PATH,
    CONTEXT_SYSTEM_OVERVIEW_PATH,
    TASK_REGISTRY_PATH,
} from "../src/scan/constants.js";
import { exists, listDirSafe, readText, writeText } from "../src/scan/fs-utils.js";
import { evaluateContextLoop } from "../src/loop/analyze.js";
import { appendLoopEvent } from "../src/loop/store.js";
import { resolveBudgetMode } from "../src/budget/policy.js";
import { buildBudgetDecisionEvent, formatBudgetDecisionMarkdown } from "../src/budget/decision.js";
import {
    appendTaskToRegistry,
    ensureTaskRegistry,
    getKnownTaskIds,
    parseTaskRegistry,
} from "../src/scan/task-registry.js";

const TASK_DIR = "task";
const PROMPT_LIMITS = {
    default: 20000,
    deep: 28000,
};
const CHECKLIST_LIMITS = {
    default: 14000,
    deep: 20000,
};
const PR_LIMITS = {
    default: 14000,
    deep: 20000,
};

function renderLoopSignals(taskId, taskTitle) {
    const result = evaluateContextLoop({ taskId, requestedTitle: taskTitle });
    const last = result.mostRecentTest;
    const lastSummary = last
        ? `${Number(last.exitCode) === 0 ? "pass" : "fail"} (exit ${last.exitCode ?? "?"})${last.command ? `: ${last.command}` : ""}`
        : "-";
    const topFail = result.patterns.topFailingCommands?.[0]?.command ?? "-";

    return [
        "## Context Loop Signals",
        "",
        `- block_new_task: ${result.constraints.blockNewTask ? "true" : "false"}`,
        `- unstable: ${result.constraints.unstable ? "true" : "false"}`,
        `- last_test: ${lastSummary}`,
        `- failure_streak: ${result.patterns.failureStreak}`,
        `- top_failing_command: ${topFail}`,
        `- require_rca: ${result.constraints.requireRootCauseAnalysis ? "true" : "false"}`,
    ].join("\n");
}

function toTitleCase(slug) {
    return slug
        .split("-")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function normalizeTitle(title) {
    return title
        .trim()
        .split(/\s+/)
        .map((word) =>
            /^[A-Z0-9]+$/.test(word)
                ? word
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
}

function slugify(title) {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return slug || "new-task";
}

function getNextTaskNumber() {
    const fileNumbers = listDirSafe(TASK_DIR)
        .map((fileName) => fileName.match(/^T-(\d{3})\b/i)?.[1])
        .filter(Boolean)
        .map((value) => Number.parseInt(value, 10));
    const numbers = [...fileNumbers, ...getKnownTaskIds()];
    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

    return String(next).padStart(3, "0");
}

function detectDefaultTestCommand() {
    const hasPackageJson = exists("package.json");
    const hasPythonConfig =
        exists("pyproject.toml") ||
        exists("requirements.txt") ||
        exists("pytest.ini");

    if (hasPackageJson) {
        return "npm test";
    }

    if (hasPythonConfig) {
        return "pytest";
    }

    return "TODO: add test command";
}

function toBulletList(items, fallback) {
    const cleaned = (items ?? [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
    if (cleaned.length === 0) {
        return `- ${fallback}`;
    }
    return cleaned.map((item) => `- ${item}`).join("\n");
}

function buildTaskTemplate(taskId, title, testCommand, seed = {}) {
    const requirements = toBulletList(seed.requirementItems, " ");
    const risk = toBulletList(seed.riskItems, " ");
    const testStrategy = toBulletList(seed.testStrategyItems, " ");
    const acceptanceCriteria = toBulletList(seed.acceptanceCriteriaItems, " ");
    return `# ${taskId} ${title}

## Goal

Describe the user-facing or developer-facing outcome.

## Background

Explain why this task exists and any product/domain boundaries.

## Scope

Allowed to change:

- 

Do not change:

- 

## Requirements

${requirements}

## Risk

${risk}

## Test Strategy

${testStrategy}

## Acceptance Criteria

${acceptanceCriteria}

## Test Command

\`\`\`bash
${testCommand}
\`\`\`

## Definition of Done

- Code implemented.
- Tests added or updated.
- Test command passes.
- Summary includes changed files and verification.
`;
}

function findTaskById(registry, taskId) {
    return registry.tasks.find((task) => task.id.toLowerCase() === taskId.toLowerCase()) ?? null;
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
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = content.match(regex);

    return match?.groups?.body?.trim() ?? "";
}

function extractWorksetSection(workset, heading) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = workset.match(regex);

    return match?.groups?.body?.trim() ?? "";
}

function toCheckboxItems(content, fallback) {
    const items = String(content ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\[[ xX]\]\s+/, ""))
        .filter(Boolean);

    if (items.length === 0) {
        return [`- [ ] ${fallback}`];
    }

    return items.map((item) => `- [ ] ${item}`);
}

function getDependencySummaries(task, registry) {
    return normalizeDependencies(task.dependencies).map((dependencyId) => {
        const dependency = findTaskById(registry, dependencyId);

        if (!dependency) {
            return `${dependencyId}: not found in ${TASK_REGISTRY_PATH}`;
        }

        return `${dependency.id}: ${dependency.title} (${dependency.status || "unknown"})`;
    });
}

function readTaskDetail(task, warnings) {
    if (!task.file) {
        warnings.push(`Task ${task.id} has no detail file listed.`);
        return "";
    }

    if (!exists(task.file)) {
        warnings.push(`Task detail file is missing: ${task.file}.`);
        return "";
    }

    return readText(task.file);
}

function renderTaskOutputManifestText({
    level,
    taskId,
    deep,
    maxChars,
    warnings,
    excludedSources = [],
}) {
    return [
        "## Context Manifest",
        "",
        `- context level: ${level}`,
        `- selected task id: ${taskId ?? "none"}`,
        `- included sources: ${TASK_REGISTRY_PATH}, selected task detail when available, context workset ${deep ? "--deep" : "default"}`,
        `- excluded sources: ${[
            "unselected task detail files",
            "full files.json dump",
            "full symbols.json dump",
            "generated index dumps",
            ...excludedSources,
        ].join(", ")}`,
        `- limits used: maxChars=${maxChars}, worksetMode=${deep ? "deep" : "default"}`,
        `- warnings: ${warnings.length ? [...new Set(warnings)].join(" | ") : "none"}`,
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
    const suffix = more > 0 ? `(+${more} more; use --verbose)` : "";
    return `## Warnings\n\n${formatList(shown)}${suffix ? `\n\n- ${suffix}` : ""}`;
}

function renderTaskOutputMeta(
    {
        level,
        taskId,
        deep,
        maxChars,
        warnings,
        excludedSources = [],
    },
    options = {},
) {
    const uniqueWarnings = [...new Set(warnings)];
    const lines = [
        "## Context Meta",
        "",
        `- level: ${level}`,
        `- selected task id: ${taskId ?? "none"}`,
        `- limits: maxChars=${maxChars}, worksetMode=${deep ? "deep" : "default"}`,
        `- warnings: ${uniqueWarnings.length}`,
    ];

    if (options.manifest) {
        lines.push(
            "",
            renderTaskOutputManifestText({
                level,
                taskId,
                deep,
                maxChars,
                warnings: uniqueWarnings,
                excludedSources,
            }),
        );
    }

    return lines.join("\n");
}

function renderTaskOutputFooter(manifestOptions, options = {}) {
    const warningsUnique = [...new Set(manifestOptions.warnings)];
    const budgetEnabled = options.budget === "auto" || options.budget === "full";
    const budgetBlock = budgetEnabled
        ? formatBudgetDecisionMarkdown(options.budgetDecision, {
              warningsCount: warningsUnique.length,
              failureStreak: options.budgetFailureStreak ?? null,
              signalCount: options.budgetSignalCount ?? null,
          })
        : "";
    const warningsBlock = renderWarningsSummary(manifestOptions.warnings, options);
    const metaBlock = renderTaskOutputMeta(manifestOptions, options);
    const footer = [budgetBlock, warningsBlock, metaBlock].filter(Boolean).join("\n\n");

    if (budgetEnabled) {
        const event = buildBudgetDecisionEvent(options.budgetDecision, {
            taskId: manifestOptions.taskId,
            warningsCount: warningsUnique.length,
            failureStreak: options.budgetFailureStreak ?? null,
            signalCount: options.budgetSignalCount ?? null,
            command: manifestOptions.level,
        });
        if (event) {
            appendLoopEvent(event);
        }
    }

    return footer;
}

function renderPromptFooter(options, outputOptions) {
    return renderTaskOutputFooter(
        {
            ...options,
            level: "task prompt",
        },
        outputOptions,
    );
}

function renderChecklistFooter(options, outputOptions) {
    return renderTaskOutputFooter(
        {
            ...options,
            level: "task checklist",
        },
        outputOptions,
    );
}

function renderPrFooter(options, outputOptions) {
    return renderTaskOutputFooter(
        {
            ...options,
            level: "task pr",
            excludedSources: ["git diff", "GitHub data"],
        },
        outputOptions,
    );
}

function renderBoundedPrompt(parts, footer, maxChars) {
    let body = parts.filter(Boolean).join("\n\n").trim();
    let output = `${body}${footer ? `\n\n${footer}` : ""}\n`;

    if (output.length <= maxChars) {
        return output;
    }

    body = `${body.slice(0, Math.max(0, maxChars - String(footer ?? "").length - 80)).trimEnd()}\n[truncated]`;
    output = `${body}${footer ? `\n\n${footer}` : ""}\n`;

    if (output.length <= maxChars) {
        return output;
    }

    return output.slice(0, Math.max(0, maxChars - 14)).trimEnd() + "\n[truncated]\n";
}

function getLikelyTestFiles(workset) {
    return [
        ...new Set(
            (workset.match(/(?:^|\s)((?:test|tests)\/[A-Za-z0-9._/-]+)/gm) ?? [])
                .map((match) => match.trim().replace(/^[-*]\s+/, "").split(/\s+/)[0])
                .map((filePath) => filePath.replace(/[),.;]+$/g, "")),
        ),
    ];
}

function summarizeTaskDetailForPrompt(taskDetail) {
    const content = String(taskDetail ?? "").trim();
    if (!content) {
        return "";
    }

    const headings = [
        "Goal",
        "Background",
        "Scope",
        "Requirements",
        "Risk",
        "Test Strategy",
        "Acceptance Criteria",
        "Test Command",
    ];

    const sections = headings
        .map((heading) => {
            const body = extractSection(content, heading);
            return body ? `### ${heading}\n\n${body}` : null;
        })
        .filter(Boolean);

    if (sections.length === 0) {
        return content.length > 3000 ? `${content.slice(0, 2985).trimEnd()}\n[truncated]` : content;
    }

    const joined = sections.join("\n\n");
    return joined.length > 6000 ? `${joined.slice(0, 5985).trimEnd()}\n[truncated]` : joined;
}

function buildTaskPrDescription(taskId, options = {}) {
    const budget = options.budget || "off";
    const base = {
        deep: Boolean(options.deep),
        fullWorkset: Boolean(options.fullWorkset),
        manifest: Boolean(options.manifest),
        verbose: Boolean(options.verbose),
    };
    let deep = Boolean(options.deep);
    let fullWorkset = Boolean(options.fullWorkset);
    let manifest = Boolean(options.manifest);
    let verbose = Boolean(options.verbose);
    let maxChars = deep ? PR_LIMITS.deep : PR_LIMITS.default;
    const warnings = [];
    const registry = parseTaskRegistry();

    if (budget === "full") {
        if (!options.deepLocked) deep = true;
        if (!options.fullWorksetLocked) fullWorkset = true;
        if (!options.manifestLocked) manifest = true;
        if (!options.verboseLocked) verbose = true;
        maxChars = deep ? PR_LIMITS.deep : PR_LIMITS.default;
    }

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBoundedPrompt([
            "# Pull Request Description",
            "Warning: missing task id.",
            "Usage: repo-context-kit task pr <taskId> [--deep]",
        ], renderPrFooter({ taskId: null, deep, maxChars, warnings }, { ...options, manifest, verbose, budget }), maxChars);
    }

    if (!registry.exists) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing. Create tasks with repo-context-kit task new or restore the task registry.`);
        return renderBoundedPrompt([
            "# Pull Request Description",
            `Warning: ${TASK_REGISTRY_PATH} is missing.`,
            "A PR description could not be generated because the task registry is required to resolve task IDs.",
        ], renderPrFooter({ taskId, deep, maxChars, warnings }, { ...options, manifest, verbose, budget }), maxChars);
    }

    const task = findTaskById(registry, taskId);

    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBoundedPrompt([
            "# Pull Request Description",
            `Warning: task not found: ${taskId}.`,
            `Check ${TASK_REGISTRY_PATH} for available task IDs.`,
        ], renderPrFooter({ taskId, deep, maxChars, warnings }, { ...options, manifest, verbose, budget }), maxChars);
    }

    const taskDetail = readTaskDetail(task, warnings);
    const goal = extractSection(taskDetail, "Goal") || "Address the selected task using the available registry metadata and workset context.";
    const scope = extractSection(taskDetail, "Scope");
    const acceptanceCriteria = extractSection(taskDetail, "Acceptance Criteria");
    const loopResult = budget === "auto" || budget === "full"
        ? evaluateContextLoop({ taskId: task.id, requestedTitle: task.title })
        : null;
    const hasFailedTest = Boolean(loopResult?.mostRecentTest && Number(loopResult.mostRecentTest.exitCode) !== 0);

    let workset = buildWorksetContext(task.id, { deep, digest: !deep && !fullWorkset });
    let riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
    let relatedFiles = extractWorksetSection(workset, "Related File Candidates");
    const hasRiskAreas = Boolean(riskAreas && !riskAreas.includes("_No indexed risk areas were available._"));
    const staleScan = workset.includes("Run repo-context-kit scan");
    const exceptionBudget = budget === "auto" && Boolean(
        hasFailedTest ||
        loopResult?.constraints?.unstable ||
        loopResult?.constraints?.requireRootCauseAnalysis ||
        hasRiskAreas ||
        staleScan,
    );

    if (exceptionBudget) {
        if (!options.verboseLocked) verbose = true;
        if (!options.fullWorksetLocked) fullWorkset = true;
        if (!options.deepLocked && (hasFailedTest || hasRiskAreas || staleScan)) {
            deep = true;
        }
        maxChars = deep ? PR_LIMITS.deep : PR_LIMITS.default;
        workset = buildWorksetContext(task.id, { deep, digest: !deep && !fullWorkset });
        riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
        relatedFiles = extractWorksetSection(workset, "Related File Candidates");
    }

    const upgradesApplied = [];
    if (!base.deep && deep) upgradesApplied.push("deep");
    if (!base.fullWorkset && fullWorkset) upgradesApplied.push("full-workset");
    if (!base.manifest && manifest) upgradesApplied.push("manifest");
    if (!base.verbose && verbose) upgradesApplied.push("verbose");
    const reasonCodes = [];
    const evidence = [];
    if (hasFailedTest && loopResult?.mostRecentTest) {
        reasonCodes.push("RECENT_TEST_FAIL");
        const exitCode = Number(loopResult.mostRecentTest.exitCode);
        const command = loopResult.mostRecentTest.command ? String(loopResult.mostRecentTest.command) : "";
        evidence.push(command ? `last_test_exit=${exitCode} command="${command}"` : `last_test_exit=${exitCode}`);
    }
    if (loopResult?.constraints?.unstable) reasonCodes.push("FAILURE_STREAK");
    if (loopResult?.constraints?.requireRootCauseAnalysis) reasonCodes.push("REQUIRE_RCA");
    if (hasRiskAreas) {
        reasonCodes.push("HIGH_RISK_AREAS");
        evidence.push("risk_areas_present=true");
    }
    if (staleScan) {
        reasonCodes.push("STALE_SCAN");
        evidence.push("stale_scan_hint=true");
    }
    const budgetDecision = budget === "off"
        ? null
        : {
              mode: budget,
              decision: budget === "full" ? "FULL" : exceptionBudget ? "EXCEPTION" : "DEFAULT",
              upgradesApplied,
              reasonCodes,
              evidence,
          };
    const budgetFailureStreak = loopResult?.patterns?.failureStreak ?? null;
    const budgetSignalCount = reasonCodes.length;

    if (workset.includes("Run repo-context-kit scan")) {
        warnings.push("Generated indexes may be missing or stale. Run repo-context-kit scan for richer workset context.");
    }

    const scopeItems = scope
        ? toCheckboxItems(scope, "Review proposed task scope.")
        : toCheckboxItems(relatedFiles, "Review related workset candidates before editing.");
    const verificationItems = acceptanceCriteria
        ? toCheckboxItems(acceptanceCriteria, "Verify the task outcome.")
        : [
            "- [ ] Verify the selected task goal is satisfied.",
            "- [ ] Confirm behavior manually where automated coverage is unavailable.",
        ];
    const parts = [
        "# Pull Request Description",
        [
            "## Title Suggestion",
            "",
            `${task.id}: ${task.title}`,
        ].join("\n"),
        [
            "## Summary",
            "",
            "This PR is intended to address the selected task. The description is generated before reading any git diff, so proposed changes are phrased as planned scope rather than completed work.",
            "",
            goal,
        ].join("\n"),
        [
            "## Linked Task",
            "",
            `- task: ${task.id}`,
            `- title: ${task.title}`,
            `- status: ${task.status || "unknown"}`,
            `- priority: ${task.priority || "-"}`,
            `- owner: ${task.owner || "-"}`,
            `- dependencies: ${task.dependencies || "-"}`,
            `- file: ${task.file || "-"}`,
        ].join("\n"),
        exceptionBudget ? renderLoopSignals(task.id, task.title) : null,
        [
            "## Scope",
            "",
            ...scopeItems,
        ].join("\n"),
        [
            "## Changes Checklist",
            "",
            "- [ ] Make only the changes needed for this task.",
            "- [ ] Keep changes minimal and aligned with existing project style.",
            "- [ ] Avoid manual edits to generated `.aidw/index/*` files.",
            "- [ ] Update docs or tests only when they are part of the task scope.",
        ].join("\n"),
        [
            "## Verification Checklist",
            "",
            ...verificationItems,
            "- [ ] Run appropriate tests before marking the PR ready.",
            "- [ ] Record actual commands and results after tests are run.",
        ].join("\n"),
        [
            "## Risk Areas",
            "",
            riskAreas || "_No indexed risk areas were available._",
        ].join("\n"),
        [
            "## Rollback / Review Notes",
            "",
            "- Review related entry points and shared modules carefully before merge.",
            "- If the task changes CLI behavior, compare command output before and after the change.",
            "- Rollback should revert only this task's scoped changes.",
        ].join("\n"),
        [
            "## Missing Context Warnings",
            "",
            warnings.length ? formatList([...new Set(warnings)]) : "- None",
        ].join("\n"),
    ];

    return renderBoundedPrompt(
        parts,
        renderPrFooter(
            { taskId: task.id, deep, maxChars, warnings },
            { ...options, deep, fullWorkset, manifest, verbose, budget, budgetDecision, budgetFailureStreak, budgetSignalCount },
        ),
        maxChars,
    );
}

function buildTaskChecklist(taskId, options = {}) {
    const budget = options.budget || "off";
    const base = {
        deep: Boolean(options.deep),
        fullWorkset: Boolean(options.fullWorkset),
        manifest: Boolean(options.manifest),
        verbose: Boolean(options.verbose),
    };
    let deep = Boolean(options.deep);
    let fullWorkset = Boolean(options.fullWorkset);
    let manifest = Boolean(options.manifest);
    let verbose = Boolean(options.verbose);
    let maxChars = deep ? CHECKLIST_LIMITS.deep : CHECKLIST_LIMITS.default;
    const warnings = [];
    const registry = parseTaskRegistry();

    if (budget === "full") {
        if (!options.deepLocked) deep = true;
        if (!options.fullWorksetLocked) fullWorkset = true;
        if (!options.manifestLocked) manifest = true;
        if (!options.verboseLocked) verbose = true;
        maxChars = deep ? CHECKLIST_LIMITS.deep : CHECKLIST_LIMITS.default;
    }

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBoundedPrompt([
            "# Task Test Checklist",
            "Warning: missing task id.",
            "Usage: repo-context-kit task checklist <taskId> [--deep]",
        ], renderChecklistFooter({ taskId: null, deep, maxChars, warnings }, { ...options, manifest, verbose, budget }), maxChars);
    }

    if (!registry.exists) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing. Create tasks with repo-context-kit task new or restore the task registry.`);
        return renderBoundedPrompt([
            "# Task Test Checklist",
            `Warning: ${TASK_REGISTRY_PATH} is missing.`,
            "A checklist could not be generated because the task registry is required to resolve task IDs.",
        ], renderChecklistFooter({ taskId, deep, maxChars, warnings }, { ...options, manifest, verbose, budget }), maxChars);
    }

    const task = findTaskById(registry, taskId);

    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBoundedPrompt([
            "# Task Test Checklist",
            `Warning: task not found: ${taskId}.`,
            `Check ${TASK_REGISTRY_PATH} for available task IDs.`,
        ], renderChecklistFooter({ taskId, deep, maxChars, warnings }, { ...options, manifest, verbose, budget }), maxChars);
    }

    const taskDetail = readTaskDetail(task, warnings);
    const goal = extractSection(taskDetail, "Goal") || "Review task detail and registry metadata to confirm the intended outcome.";
    const acceptanceCriteria = extractSection(taskDetail, "Acceptance Criteria");
    const loopResult = budget === "auto" || budget === "full"
        ? evaluateContextLoop({ taskId: task.id, requestedTitle: task.title })
        : null;
    const hasFailedTest = Boolean(loopResult?.mostRecentTest && Number(loopResult.mostRecentTest.exitCode) !== 0);

    let workset = buildWorksetContext(task.id, { deep, digest: !deep && !fullWorkset });
    let riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
    let likelyTestFiles = getLikelyTestFiles(workset);
    const hasRiskAreas = Boolean(riskAreas && !riskAreas.includes("_No indexed risk areas were available._"));
    const staleScan = workset.includes("Run repo-context-kit scan");
    const exceptionBudget = budget === "auto" && Boolean(
        hasFailedTest ||
        loopResult?.constraints?.unstable ||
        loopResult?.constraints?.requireRootCauseAnalysis ||
        hasRiskAreas ||
        staleScan,
    );

    if (exceptionBudget) {
        if (!options.verboseLocked) verbose = true;
        if (!options.fullWorksetLocked) fullWorkset = true;
        if (!options.deepLocked && (hasFailedTest || hasRiskAreas || staleScan)) {
            deep = true;
        }
        maxChars = deep ? CHECKLIST_LIMITS.deep : CHECKLIST_LIMITS.default;
        workset = buildWorksetContext(task.id, { deep, digest: !deep && !fullWorkset });
        riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
        likelyTestFiles = getLikelyTestFiles(workset);
    }

    const upgradesApplied = [];
    if (!base.deep && deep) upgradesApplied.push("deep");
    if (!base.fullWorkset && fullWorkset) upgradesApplied.push("full-workset");
    if (!base.manifest && manifest) upgradesApplied.push("manifest");
    if (!base.verbose && verbose) upgradesApplied.push("verbose");
    const reasonCodes = [];
    const evidence = [];
    if (hasFailedTest && loopResult?.mostRecentTest) {
        reasonCodes.push("RECENT_TEST_FAIL");
        const exitCode = Number(loopResult.mostRecentTest.exitCode);
        const command = loopResult.mostRecentTest.command ? String(loopResult.mostRecentTest.command) : "";
        evidence.push(command ? `last_test_exit=${exitCode} command="${command}"` : `last_test_exit=${exitCode}`);
    }
    if (loopResult?.constraints?.unstable) reasonCodes.push("FAILURE_STREAK");
    if (loopResult?.constraints?.requireRootCauseAnalysis) reasonCodes.push("REQUIRE_RCA");
    if (hasRiskAreas) {
        reasonCodes.push("HIGH_RISK_AREAS");
        evidence.push("risk_areas_present=true");
    }
    if (staleScan) {
        reasonCodes.push("STALE_SCAN");
        evidence.push("stale_scan_hint=true");
    }
    const budgetDecision = budget === "off"
        ? null
        : {
              mode: budget,
              decision: budget === "full" ? "FULL" : exceptionBudget ? "EXCEPTION" : "DEFAULT",
              upgradesApplied,
              reasonCodes,
              evidence,
          };
    const budgetFailureStreak = loopResult?.patterns?.failureStreak ?? null;
    const budgetSignalCount = reasonCodes.length;

    if (workset.includes("Run repo-context-kit scan")) {
        warnings.push("Generated indexes may be missing or stale. Run repo-context-kit scan for richer workset context.");
    }

    const testChecklist = likelyTestFiles.length > 0
        ? likelyTestFiles.map((filePath) => `- [ ] Review or update likely test file: \`${filePath}\`.`)
        : [
            "- [ ] Identify the nearest relevant test area from the task scope.",
            "- [ ] Add or update focused tests if behavior changes.",
            "- [ ] Run the project test command documented by the task or package when ready.",
        ];
    const parts = [
        "# Task Test Checklist",
        [
            "## Task",
            "",
            `- id: ${task.id}`,
            `- title: ${task.title}`,
            `- status: ${task.status || "unknown"}`,
            `- priority: ${task.priority || "-"}`,
            `- owner: ${task.owner || "-"}`,
            `- dependencies: ${task.dependencies || "-"}`,
        ].join("\n"),
        [
            "## Task Goal Summary",
            "",
            goal,
        ].join("\n"),
        exceptionBudget ? renderLoopSignals(task.id, task.title) : null,
        [
            "## Acceptance Criteria Checklist",
            "",
            ...toCheckboxItems(acceptanceCriteria, "Confirm acceptance criteria with the task owner because none were found."),
        ].join("\n"),
        [
            "## Implementation Verification Checklist",
            "",
            "- [ ] Confirm the change implements only this task.",
            "- [ ] Confirm generated `.aidw/index/*` files were not edited manually.",
            "- [ ] Confirm unrelated files were not changed.",
            "- [ ] Confirm existing project style and structure were preserved.",
            "- [ ] Confirm edge cases from the task detail were considered.",
        ].join("\n"),
        [
            "## Test Checklist",
            "",
            ...testChecklist,
            "- [ ] Record the exact tests run and their results.",
        ].join("\n"),
        [
            "## Regression Risk Checklist",
            "",
            "- [ ] Review related file candidates from the workset before changing shared behavior.",
            "- [ ] Check relevant entry points for command/API/user-flow impact.",
            riskAreas ? "- [ ] Review the risk areas listed below." : "- [ ] Identify risk areas manually if scan context is unavailable.",
            "",
            riskAreas || "_No indexed risk areas were available._",
        ].join("\n"),
        [
            "## Manual Verification Checklist",
            "",
            "- [ ] Exercise the changed workflow manually if it affects CLI output, generated prompts, or user-facing behavior.",
            "- [ ] Confirm warnings are clear when expected context is missing.",
            "- [ ] Confirm output remains bounded and does not dump full generated indexes.",
        ].join("\n"),
        [
            "## Workset Reference",
            "",
            "Use this bounded workset for related files, symbols, entry points, read order, and warnings.",
            "",
            workset.trim(),
        ].join("\n"),
    ];

    return renderBoundedPrompt(
        parts,
        renderChecklistFooter(
            { taskId: task.id, deep, maxChars, warnings },
            { ...options, deep, fullWorkset, manifest, verbose, budget, budgetDecision, budgetFailureStreak, budgetSignalCount },
        ),
        maxChars,
    );
}

function buildTaskPrompt(taskId, options = {}) {
    const budget = options.budget || "off";
    const base = {
        deep: Boolean(options.deep),
        fullWorkset: Boolean(options.fullWorkset),
        fullDetail: Boolean(options.fullDetail),
        compact: Boolean(options.compact),
        manifest: Boolean(options.manifest),
        verbose: Boolean(options.verbose),
    };
    let deep = Boolean(options.deep);
    let fullWorkset = Boolean(options.fullWorkset);
    let fullDetail = Boolean(options.fullDetail);
    let compact = Boolean(options.compact);
    let manifest = Boolean(options.manifest);
    let verbose = Boolean(options.verbose);
    let maxChars = deep ? PROMPT_LIMITS.deep : PROMPT_LIMITS.default;
    const warnings = [];
    const registry = parseTaskRegistry();

    if (budget === "auto" && !options.compactLocked) {
        compact = true;
    }

    if (budget === "full") {
        if (!options.deepLocked) deep = true;
        if (!options.fullWorksetLocked) fullWorkset = true;
        if (!options.fullDetailLocked) fullDetail = true;
        if (!options.compactLocked) compact = false;
        if (!options.manifestLocked) manifest = true;
        if (!options.verboseLocked) verbose = true;
        maxChars = deep ? PROMPT_LIMITS.deep : PROMPT_LIMITS.default;
    }

    if (!taskId) {
        warnings.push("Missing task id.");
        return renderBoundedPrompt([
            "# Task Implementation Prompt",
            "Warning: missing task id.",
            "Usage: repo-context-kit task prompt <taskId> [--deep] [--compact] [--full-detail] [--full-workset] [--manifest] [--verbose] [--budget auto|off|full]",
        ], renderPromptFooter({ taskId: null, deep, maxChars, warnings }, options), maxChars);
    }

    if (!registry.exists) {
        warnings.push(`${TASK_REGISTRY_PATH} is missing. Create tasks with repo-context-kit task new or restore the task registry.`);
        return renderBoundedPrompt([
            "# Task Implementation Prompt",
            `Warning: ${TASK_REGISTRY_PATH} is missing.`,
            "A task prompt could not be generated because the task registry is required to resolve task IDs.",
        ], renderPromptFooter({ taskId, deep, maxChars, warnings }, options), maxChars);
    }

    const task = findTaskById(registry, taskId);

    if (!task) {
        warnings.push(`Task ${taskId} was not found in ${TASK_REGISTRY_PATH}.`);
        return renderBoundedPrompt([
            "# Task Implementation Prompt",
            `Warning: task not found: ${taskId}.`,
            `Check ${TASK_REGISTRY_PATH} for available task IDs.`,
        ], renderPromptFooter({ taskId, deep, maxChars, warnings }, options), maxChars);
    }

    const taskDetail = readTaskDetail(task, warnings);
    const loopResult = budget === "auto" || budget === "full"
        ? evaluateContextLoop({ taskId: task.id, requestedTitle: task.title })
        : null;
    const hasFailedTest = Boolean(loopResult?.mostRecentTest && Number(loopResult.mostRecentTest.exitCode) !== 0);
    let workset = buildWorksetContext(task.id, { deep, digest: !deep && !fullWorkset });
    const riskAreas = extractWorksetSection(workset, "Relevant Risk Areas");
    const hasRiskAreas = Boolean(riskAreas && !riskAreas.includes("_No indexed risk areas were available._"));
    const staleScan = workset.includes("Run repo-context-kit scan");
    const exceptionBudget = budget === "auto" && Boolean(
        hasFailedTest ||
        loopResult?.constraints?.unstable ||
        loopResult?.constraints?.requireRootCauseAnalysis ||
        hasRiskAreas ||
        staleScan,
    );

    if (exceptionBudget) {
        if (!options.verboseLocked) verbose = true;
        if (!options.fullDetailLocked) fullDetail = true;
        if (!options.fullWorksetLocked) fullWorkset = true;
        if (!options.deepLocked && (hasFailedTest || hasRiskAreas || staleScan)) {
            deep = true;
        }
        maxChars = deep ? PROMPT_LIMITS.deep : PROMPT_LIMITS.default;
        workset = buildWorksetContext(task.id, { deep, digest: !deep && !fullWorkset });
    }

    const taskDetailForPrompt = fullDetail ? taskDetail : summarizeTaskDetailForPrompt(taskDetail);
    const dependencySummaries = getDependencySummaries(task, registry);
    const upgradesApplied = [];
    if (!base.compact && compact) upgradesApplied.push("compact");
    if (!base.deep && deep) upgradesApplied.push("deep");
    if (!base.fullWorkset && fullWorkset) upgradesApplied.push("full-workset");
    if (!base.fullDetail && fullDetail) upgradesApplied.push("full-detail");
    if (!base.manifest && manifest) upgradesApplied.push("manifest");
    if (!base.verbose && verbose) upgradesApplied.push("verbose");
    const reasonCodes = [];
    const evidence = [];
    if (hasFailedTest && loopResult?.mostRecentTest) {
        reasonCodes.push("RECENT_TEST_FAIL");
        const exitCode = Number(loopResult.mostRecentTest.exitCode);
        const command = loopResult.mostRecentTest.command ? String(loopResult.mostRecentTest.command) : "";
        evidence.push(command ? `last_test_exit=${exitCode} command="${command}"` : `last_test_exit=${exitCode}`);
    }
    if (loopResult?.constraints?.unstable) reasonCodes.push("FAILURE_STREAK");
    if (loopResult?.constraints?.requireRootCauseAnalysis) reasonCodes.push("REQUIRE_RCA");
    if (hasRiskAreas) {
        reasonCodes.push("HIGH_RISK_AREAS");
        evidence.push("risk_areas_present=true");
    }
    if (staleScan) {
        reasonCodes.push("STALE_SCAN");
        evidence.push("stale_scan_hint=true");
    }
    const budgetDecision = budget === "off"
        ? null
        : {
              mode: budget,
              decision: budget === "full" ? "FULL" : exceptionBudget ? "EXCEPTION" : "DEFAULT",
              upgradesApplied,
              reasonCodes,
              evidence,
          };
    const effectiveOptions = {
        ...options,
        deep,
        fullWorkset,
        fullDetail,
        compact,
        manifest,
        verbose,
        budget,
        budgetDecision,
        budgetFailureStreak: loopResult?.patterns?.failureStreak ?? null,
        budgetSignalCount: reasonCodes.length,
    };
    const parts = [
        "# Task Implementation Prompt",
        compact
            ? [
                  "## Rules",
                  "",
                  "- Only implement this task; follow scope and acceptance criteria.",
                  "- Keep changes minimal and preserve backward compatibility.",
                  "- Do not edit generated `.aidw/index/*` files.",
                  "- If context is insufficient, ask for specific inputs.",
                  "- Run the documented test command when ready.",
              ].join("\n")
            : [
                  "## Role",
                  "",
                  "You are an AI coding tool in this repository. Implement only this task, follow scope/AC, and keep changes minimal and safe.",
              ].join("\n"),
        compact
            ? [
                  "## Task",
                  "",
                  `- id: ${task.id}`,
                  `- title: ${task.title}`,
                  `- priority: ${task.priority || "-"}`,
                  `- dependencies: ${task.dependencies || "-"}`,
                  "",
                  "### Dependency Summary",
                  "",
                  formatList(dependencySummaries),
                  "",
                  "### Task Detail",
                  "",
                  taskDetailForPrompt || "_Task detail file is unavailable._",
              ].join("\n")
            : [
                  "## Project Context",
                  "",
                  "Use the bounded workset below for context. Do not edit generated `.aidw/index/*` files manually.",
              ].join("\n"),
        compact
            ? [
                  "## Workset",
                  "",
                  workset.trim(),
              ].join("\n")
            : [
                  "## Task",
                  "",
                  `- id: ${task.id}`,
                  `- title: ${task.title}`,
                  `- status: ${task.status || "unknown"}`,
                  `- priority: ${task.priority || "-"}`,
                  `- owner: ${task.owner || "-"}`,
                  `- dependencies: ${task.dependencies || "-"}`,
                  "",
                  "### Dependency Summary",
                  "",
                  formatList(dependencySummaries),
                  "",
                  "### Task Detail",
                  "",
                  taskDetailForPrompt || "_Task detail file is unavailable. Use registry metadata and ask for more specific context if needed._",
              ].join("\n"),
        compact
            ? null
            : [
                  "## Relevant Workset",
                  "",
                  workset.trim(),
              ].join("\n"),
        compact
            ? null
            : [
                  "## Implementation Rules",
                  "",
                  "- Only implement this task.",
                  "- Keep changes minimal; preserve backward compatibility.",
                  "- Do not edit generated `.aidw/index/*` files manually.",
                  "- If context is insufficient, ask for specific missing inputs.",
              ].join("\n"),
        exceptionBudget ? renderLoopSignals(task.id, task.title) : null,
        [
            "## Required Final Response Format",
            "",
            "- Summary",
            "- Files changed",
            "- Key decisions",
            "- Tests run",
            "- Anything not implemented",
        ].join("\n"),
    ].filter(Boolean);

    if (workset.includes("Run repo-context-kit scan")) {
        warnings.push("Generated indexes may be missing or stale. Run repo-context-kit scan for richer workset context.");
    }

    return renderBoundedPrompt(
        parts,
        renderPromptFooter({ taskId: task.id, deep, maxChars, warnings }, effectiveOptions),
        maxChars,
    );
}

export async function runTask(args = []) {
    const subcommand = args[0];
    const formatTaskTitle = (value) => (value ? value : "");
    const fullWorkset = args.includes("--full-workset");
    const fullDetail = args.includes("--full-detail");
    const compact = args.includes("--compact");
    const manifest = args.includes("--manifest");
    const verbose = args.includes("--verbose");
    const budget = resolveBudgetMode(args);
    const deepLocked = args.includes("--deep");
    const fullWorksetLocked = args.includes("--full-workset");
    const fullDetailLocked = args.includes("--full-detail");
    const compactLocked = args.includes("--compact");
    const manifestLocked = args.includes("--manifest");
    const verboseLocked = args.includes("--verbose");

    if (subcommand === "pr") {
        const taskId = args.slice(1).find((arg) => !arg.startsWith("--"));
        const registry = parseTaskRegistry();
        if (!taskId || !registry.exists || !findTaskById(registry, taskId)) {
            process.exitCode = 1;
        }
        const output = buildTaskPrDescription(taskId, {
            deep: deepLocked,
            fullWorkset,
            manifest,
            verbose,
            budget,
            deepLocked,
            fullWorksetLocked,
            manifestLocked,
            verboseLocked,
        });

        console.log(output.trimEnd());

        return {
            output,
        };
    }

    if (subcommand === "checklist") {
        const taskId = args.slice(1).find((arg) => !arg.startsWith("--"));
        const registry = parseTaskRegistry();
        if (!taskId || !registry.exists || !findTaskById(registry, taskId)) {
            process.exitCode = 1;
        }
        const output = buildTaskChecklist(taskId, {
            deep: deepLocked,
            fullWorkset,
            manifest,
            verbose,
            budget,
            deepLocked,
            fullWorksetLocked,
            manifestLocked,
            verboseLocked,
        });

        console.log(output.trimEnd());

        return {
            output,
        };
    }

    if (subcommand === "prompt") {
        const taskId = args.slice(1).find((arg) => !arg.startsWith("--"));
        const registry = parseTaskRegistry();
        if (!taskId || !registry.exists || !findTaskById(registry, taskId)) {
            process.exitCode = 1;
        }
        const output = buildTaskPrompt(taskId, {
            deep: deepLocked,
            fullWorkset,
            fullDetail,
            compact,
            manifest,
            verbose,
            budget,
            deepLocked,
            fullWorksetLocked,
            fullDetailLocked,
            compactLocked,
            manifestLocked,
            verboseLocked,
        });

        console.log(output.trimEnd());

        return {
            output,
        };
    }

    if (subcommand === "generate") {
        const missing = [];
        if (!exists(CONTEXT_SYSTEM_OVERVIEW_PATH)) {
            missing.push(CONTEXT_SYSTEM_OVERVIEW_PATH);
        }
        if (!exists(CONTEXT_PROJECT_MD_PATH)) {
            missing.push(CONTEXT_PROJECT_MD_PATH);
        }

        if (missing.length > 0) {
            console.error("✖ Task generation scaffold requires project docs.");
            console.error("Missing:");
            for (const filePath of missing) {
                console.error(`- ${filePath}`);
            }
            console.error("");
            console.error("Next:");
            console.error("- Run: repo-context-kit scan");
            process.exitCode = 1;
            return {
                created: null,
                output: null,
            };
        }

        const output = [
            "# Task Generation Scaffold",
            "",
            "This command does not auto-edit code.",
            "",
            "Inputs (default):",
            `- ${CONTEXT_SYSTEM_OVERVIEW_PATH}`,
            `- ${CONTEXT_PROJECT_MD_PATH}`,
            "- Your application document (PRD/spec/ADR) provided to your AI tool",
            "",
            "Outputs:",
            "- task/T-*.md (one file per task)",
            "- task/task.md (registry updated)",
            "",
            "Suggested next steps:",
            '- Create tasks: repo-context-kit task new \"<task title>\"',
            "- Fill each task with Goal / Scope / Acceptance Criteria / Test Command",
            "- Then run: repo-context-kit task run",
        ].join("\n");

        console.log(output.trimEnd());
        return {
            output,
        };
    }

    if (subcommand === "run") {
        const registry = parseTaskRegistry();
        if (!registry.exists) {
            console.error("✖ Task run scaffold requires the task registry.");
            console.error("");
            console.error("Next:");
            console.error('- Create a task: repo-context-kit task new "Describe the change"');
            process.exitCode = 1;
            return {
                created: null,
                output: null,
            };
        }

        const runnable = registry.tasks.filter((task) =>
            ["todo", "in_progress"].includes(task.status || "todo"),
        );

        const lines = [
            "# Task Run Scaffold",
            "",
            "This command does not auto-edit code or run tests.",
            "",
            "Execution plan:",
            "- Generate tasks from docs (if needed): repo-context-kit task generate",
            "- Execute tasks sequentially",
            "- For each task: implement → run tests → commit + push",
            "- After all tasks: create one final PR",
            "",
            "Tasks (todo / in_progress):",
            ...(runnable.length === 0
                ? ["- (none)"]
                : runnable.map((task) => `- ${task.id}: ${formatTaskTitle(task.title)}`)),
        ];

        const output = `${lines.join("\n")}\n`;
        console.log(output.trimEnd());
        return {
            output,
        };
    }

    if (subcommand !== "new") {
        console.error("Unknown task command.");
        console.log("Usage:");
        console.log('  repo-context-kit task new "Task title" [--force]');
        console.log("  repo-context-kit task generate");
        console.log("  repo-context-kit task run");
        console.log("  repo-context-kit task checklist <taskId> [--deep]");
        console.log("  repo-context-kit task pr <taskId> [--deep]");
        console.log("  repo-context-kit task prompt <taskId> [--deep] [--compact] [--full-detail] [--full-workset]");
        process.exitCode = 1;
        return {
            created: null,
            output: null,
        };
    }

    const force = args.includes("--force");
    const rawTitle = args.filter((arg) => arg !== "--force").slice(1).join(" ").trim();
    const slug = slugify(rawTitle || "new-task");
    const taskNumber = getNextTaskNumber();
    const taskId = `T-${taskNumber}`;
    const title = rawTitle ? normalizeTitle(rawTitle) : toTitleCase(slug);
    const filePath = path.posix.join(TASK_DIR, `${taskId}-${slug}.md`);

    const loop = evaluateContextLoop({ requestedTitle: title });
    if (loop.constraints.blockNewTask && !force) {
        console.error("✖ Task creation blocked by Context Loop constraints");
        console.error(loop.constraints.blockReason || "Task creation is blocked.");
        if (loop.mutations.suggestedFixTaskTitle) {
            console.error("");
            console.error("Suggested next step:");
            console.error(`- Create a fix task: repo-context-kit task new "${loop.mutations.suggestedFixTaskTitle}"`);
        }
        console.error("");
        console.error('Override: repo-context-kit task new "Title" --force');
        process.exitCode = 1;
        return {
            created: null,
            output: null,
        };
    }

    ensureTaskRegistry();
    writeText(filePath, buildTaskTemplate(taskId, title, detectDefaultTestCommand(), loop.mutations));
    appendTaskToRegistry({
        id: taskId,
        title,
        file: filePath,
    });

    console.log("\u2714 Task created");
    console.log("");
    console.log("Created:");
    console.log(`* ${filePath}`);

    return {
        created: filePath,
    };
}
