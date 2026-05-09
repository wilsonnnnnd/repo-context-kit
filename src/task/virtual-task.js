import { buildWorksetContext } from "../../bin/context.js";
import { buildTaskPrompt } from "../../bin/task.js";
import { withRepoRoot } from "../runtime/root-context.js";
import { exists } from "../scan/fs-utils.js";

function normalizeTitle(goal) {
    return String(goal ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 12)
        .map((word) =>
            /^[A-Z0-9]+$/.test(word)
                ? word
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
}

function detectDefaultTestCommand() {
    if (exists("package.json")) {
        return "npm test";
    }
    if (exists("pyproject.toml") || exists("requirements.txt") || exists("pytest.ini")) {
        return "pytest";
    }
    return "TODO: add test command";
}

function buildVirtualTaskDetailMarkdown(task) {
    const scope = Array.isArray(task.scope) ? task.scope : [];
    const constraints = Array.isArray(task.constraints) ? task.constraints : [];
    const requirements = Array.isArray(task.requirements) ? task.requirements : [];
    const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [];
    const scopeLines = scope.length ? scope.map((x) => `- ${x}`).join("\n") : "- ";
    const constraintLines = constraints.length ? constraints.map((x) => `- ${x}`).join("\n") : "- ";
    const requirementLines = requirements.length ? requirements.map((x) => `- ${x}`).join("\n") : "- ";
    const acceptanceLines = acceptanceCriteria.length ? acceptanceCriteria.map((x) => `- ${x}`).join("\n") : "- ";
    return `# ${task.id} ${task.title}

## Goal

${task.goal}

## Background

Explain why this task exists and any product/domain boundaries.

## Scope

Allowed to change:

- 

Do not change:

- 

Notes:

${scopeLines}

## Constraints

${constraintLines}

## Requirements

${requirementLines}

## Acceptance Criteria

${acceptanceLines}

## Test Command

\`\`\`bash
${task.testCommand}
\`\`\`

## Definition of Done

- ${task.definitionOfDone.join("\n- ")}
`;
}

function extractMarkdownSection(content, heading) {
    const escapedHeading = String(heading ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = String(content ?? "").match(regex);
    return match?.groups?.body?.trim() ?? "";
}

function extractFilePathsFromSection(section, max = 12) {
    const paths = [];
    const lines = String(section ?? "").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("- ")) continue;
        const candidate = trimmed.slice(2).trim();
        const match = candidate.match(/^(?<path>(?:bin|src|test|tests|app|template|site)\/[A-Za-z0-9._/-]+)/);
        if (match?.groups?.path) {
            paths.push(match.groups.path);
        }
        if (paths.length >= max) break;
    }
    return [...new Set(paths)];
}

export function createVirtualTask({ goal, deep = false, repoRoot, id = null, title = null, seed = null } = {}) {
    const normalizedGoal = String(goal ?? "").trim();
    if (!normalizedGoal) {
        throw new Error("goal is required");
    }
    return withRepoRoot(repoRoot, () => {
        const requirementsSeed = Array.isArray(seed?.requirements) ? seed.requirements : [];
        const acceptanceSeed = Array.isArray(seed?.acceptanceCriteria) ? seed.acceptanceCriteria : [];
        const scopeSeed = Array.isArray(seed?.scope) ? seed.scope : [];
        const constraintsSeed = Array.isArray(seed?.constraints) ? seed.constraints : [];
        const testCommandSeed = typeof seed?.testCommand === "string" ? seed.testCommand : "";
        const task = {
            id: String(id ?? "").trim() || "VIRTUAL",
            title: String(title ?? "").trim() || normalizeTitle(normalizedGoal) || "Virtual Task",
            goal: normalizedGoal,
            requirements: requirementsSeed.map((x) => String(x ?? "").trim()).filter(Boolean),
            acceptanceCriteria: acceptanceSeed.map((x) => String(x ?? "").trim()).filter(Boolean),
            scope: scopeSeed.map((x) => String(x ?? "").trim()).filter(Boolean),
            constraints: constraintsSeed.map((x) => String(x ?? "").trim()).filter(Boolean),
            testCommand: testCommandSeed.trim() || detectDefaultTestCommand(),
            definitionOfDone: [
                "Workset and prompt generated without writing files.",
                "No source code modifications were performed.",
                "No tests were executed automatically.",
            ],
        };
        const taskDetail = buildVirtualTaskDetailMarkdown(task);

        const workset = buildWorksetContext(task, {
            deep: Boolean(deep),
            digest: !deep,
            manifest: true,
            taskDetailOverride: taskDetail,
            budget: "off",
        });
        const prompt = buildTaskPrompt(task, {
            deep: Boolean(deep),
            compact: true,
            manifest: true,
            taskDetailOverride: taskDetail,
            budget: "off",
        });
        const summarySection = extractMarkdownSection(workset, "File Summary References");
        const candidatesSection = extractMarkdownSection(workset, "Related File Candidates");
        const relatedFiles = [...new Set([
            ...extractFilePathsFromSection(summarySection, deep ? 10 : 6),
            ...extractFilePathsFromSection(candidatesSection, deep ? 12 : 8),
        ])].slice(0, 12);

        return {
            task,
            workset,
            prompt,
            relatedFiles,
        };
    });
}
