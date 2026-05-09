import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    CONTEXT_INDEX_DIR,
    CONTEXT_TASKS_DIR,
    MANAGED_CONTEXT_FILE_PATHS,
} from "../scan/constants.js";
import { loadDesignDoc } from "../docs/doc-loader.js";
import { extractPlanningData, buildPlanningSource } from "../docs/doc-extractor.js";
import { serializeJson } from "../runtime/serialize.js";
import { CURRENT_RUNTIME_VERSION } from "../runtime/runtime-version.js";
import { buildRuntimeContract } from "../runtime/runtime-contract.js";
import { collectRuntimeRisks } from "../runtime/risks.js";
import {
    BOOTSTRAP_LIMITS,
    BOOTSTRAP_VERSION,
    BOOTSTRAP_WRITE_MODES,
} from "./constants.js";
import { assertBootstrapPathAllowed, resolveWithinRepoRoot } from "./paths.js";
import { listTemplateFiles, readTemplateFileBytes } from "./template.js";
import { buildScaffoldHintsSystem } from "./srhs.js";

function sha256Hex(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function computeBytesPreview(buffer, maxBytes) {
    if (!Buffer.isBuffer(buffer)) return { bytes: 0, preview: "" };
    const bytes = buffer.byteLength;
    const slice = buffer.subarray(0, Math.min(bytes, maxBytes));
    const preview = slice.toString("utf-8").replace(/\uFFFD/g, "").slice(0, maxBytes);
    return { bytes, preview };
}

function detectStackFromPlanning(planning) {
    const haystack = [
        ...(Array.isArray(planning?.goals) ? planning.goals : []),
        ...(Array.isArray(planning?.requirements) ? planning.requirements : []),
        ...(Array.isArray(planning?.constraints) ? planning.constraints : []),
        ...(Array.isArray(planning?.scope) ? planning.scope : []),
    ]
        .join(" ")
        .toLowerCase();
    const stack = {
        language: null,
        runtime: null,
        packageManager: null,
        framework: null,
        tooling: [],
    };
    if (/(python|fastapi)/.test(haystack)) {
        stack.language = "python";
        stack.runtime = "python";
    }
    if (/(node\.js|nodejs|javascript|typescript|npm|pnpm|yarn)/.test(haystack)) {
        stack.language = stack.language ?? "javascript";
        stack.runtime = stack.runtime ?? "node";
    }
    if (/(next\.js|nextjs)/.test(haystack)) {
        stack.framework = "nextjs";
    } else if (/\breact\b/.test(haystack)) {
        stack.framework = "react";
    } else if (/\bfastapi\b/.test(haystack)) {
        stack.framework = "fastapi";
    }
    if (/\bpnpm\b/.test(haystack)) stack.packageManager = "pnpm";
    else if (/\byarn\b/.test(haystack)) stack.packageManager = "yarn";
    else if (/\bnpm\b/.test(haystack)) stack.packageManager = "npm";
    return stack;
}

function buildReadmeContent(planning) {
    const title = (Array.isArray(planning?.goals) && planning.goals[0]) ? String(planning.goals[0]).trim() : "New Project";
    const goals = Array.isArray(planning?.goals) ? planning.goals : [];
    const scope = Array.isArray(planning?.scope) ? planning.scope : [];
    const ac = Array.isArray(planning?.acceptanceCriteria) ? planning.acceptanceCriteria : [];
    const constraints = Array.isArray(planning?.constraints) ? planning.constraints : [];
    const lines = [
        `# ${title || "New Project"}`,
        "",
        "## Purpose",
        "",
        "This repository was bootstrapped with repo-context-kit bootstrap runtime.",
        "It contains runtime scaffold files and a minimal project description.",
        "",
    ];
    if (goals.length) {
        lines.push("## Goals", "", ...goals.slice(0, 6).map((g) => `- ${g}`), "");
    }
    if (scope.length) {
        lines.push("## Scope", "", ...scope.slice(0, 12).map((s) => `- ${s}`), "");
    }
    if (ac.length) {
        lines.push("## Acceptance Criteria", "", ...ac.slice(0, 16).map((x) => `- ${x}`), "");
    }
    if (constraints.length) {
        lines.push("## Constraints", "", ...constraints.slice(0, 16).map((x) => `- ${x}`), "");
    }
    lines.push(
        "## Next",
        "",
        "- Review the bootstrap plan and apply it with explicit confirmation.",
        "- Then run `repo-context-kit scan` to generate indexes once you add source/config files.",
        "",
    );
    return `${lines.join("\n").trimEnd()}\n`;
}

function buildBootstrapRisk({ id, severity, category, message, evidence, suggestedAction }) {
    return {
        id,
        severity,
        source: "runtime",
        category,
        message,
        evidence: evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {},
        suggestedAction: suggestedAction ?? "",
    };
}

function makeOpBase(op) {
    const out = { ...op };
    Object.keys(out).sort().forEach((key) => {
        const value = out[key];
        delete out[key];
        out[key] = value;
    });
    return out;
}

function buildPlanDigest(plan) {
    const normalized = serializeJson(plan, { indent: 0 }).trim();
    return sha256Hex(normalized);
}

function buildPauseToken(digest) {
    return sha256Hex(`${BOOTSTRAP_VERSION}:${String(digest ?? "")}`).slice(0, 32);
}

function renderPlanText(plan) {
    const ops = Array.isArray(plan?.ops) ? plan.ops : [];
    const counts = {
        ops: ops.length,
        mkdir: ops.filter((o) => o?.op === "mkdir").length,
        writeFile: ops.filter((o) => o?.op === "writeFile").length,
        copyTemplate: ops.filter((o) => o?.op === "copyTemplate").length,
    };
    const listed = ops.filter((o) => o && typeof o.path === "string").slice(0, 80);
    const lines = [
        "Bootstrap Plan",
        "",
        `- version: ${BOOTSTRAP_VERSION}`,
        `- writeMode: ${plan.writeMode}`,
        `- digest: ${plan.digest}`,
        `- pauseToken: ${plan.pauseToken}`,
        "",
        "## Ops",
        "",
        `- total: ${counts.ops} (mkdir=${counts.mkdir} writeFile=${counts.writeFile} copyTemplate=${counts.copyTemplate})`,
        "",
        "## Preview",
        "",
        ...listed.map((o) => `- ${o.op} ${o.path}`),
        listed.length < ops.length ? `- … (${ops.length - listed.length} more)` : null,
    ].filter(Boolean);
    return lines.join("\n").trimEnd();
}

export function planBootstrapRuntime({ repoRoot, fromDoc, writeMode = "create-only" } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    const wm = BOOTSTRAP_WRITE_MODES.includes(writeMode) ? writeMode : "create-only";
    const doc = loadDesignDoc(fromDoc, { repoRoot: root });
    const planning = extractPlanningData(doc);
    const planningSource = buildPlanningSource(doc, planning);
    const stack = detectStackFromPlanning(planning);
    const srhs = buildScaffoldHintsSystem({ planning, docContent: doc.content });
    const scaffoldMeta = srhs.scaffoldMeta;
    const matchedRecipeIds = srhs.matchedRecipeIds;
    const scaffoldHints = srhs.scaffoldHints;

    const bootstrapRisks = [];
    if (!Array.isArray(planning.goals) || planning.goals.length === 0) {
        bootstrapRisks.push(
            buildBootstrapRisk({
                id: "bootstrap-missing-goals",
                severity: "blocker",
                category: "scope",
                message: "No goals were extracted from the doc.",
                evidence: { fromDoc: doc.path },
                suggestedAction: "Add a Goals section with at least one bullet.",
            }),
        );
    }
    if (!Array.isArray(planning.acceptanceCriteria) || planning.acceptanceCriteria.length === 0) {
        bootstrapRisks.push(
            buildBootstrapRisk({
                id: "bootstrap-missing-acceptance-criteria",
                severity: "warning",
                category: "scope",
                message: "No acceptance criteria were extracted from the doc.",
                evidence: { fromDoc: doc.path },
                suggestedAction: "Add an Acceptance Criteria section with bullet points.",
            }),
        );
    }
    if (planning?.analysis?.conflictingRequirements) {
        bootstrapRisks.push(
            buildBootstrapRisk({
                id: "bootstrap-conflicting-requirements",
                severity: "blocker",
                category: "stability",
                message: "Conflicting requirements were detected in the doc.",
                evidence: { fromDoc: doc.path },
                suggestedAction: "Remove or resolve conflicting requirements before scaffolding.",
            }),
        );
    }
    if (stack.framework === "nextjs" && /(fastapi)/.test(doc.content.toLowerCase())) {
        bootstrapRisks.push(
            buildBootstrapRisk({
                id: "bootstrap-conflicting-stack",
                severity: "warning",
                category: "stability",
                message: "Both Next.js and FastAPI signals were detected. Confirm the intended runtime split before scaffolding.",
                evidence: { signals: ["nextjs", "fastapi"] },
                suggestedAction: "Clarify whether this is a single-runtime project or multiple services.",
            }),
        );
    }

    const templateFiles = listTemplateFiles();
    const fileOps = [];
    let totalBytes = 0;
    for (const templatePath of templateFiles) {
        const destRel = assertBootstrapPathAllowed(templatePath);
        const { fullPath } = resolveWithinRepoRoot(root, destRel);
        const exists = fs.existsSync(fullPath);
        const managedOverwrite = wm === "overwrite-managed" && MANAGED_CONTEXT_FILE_PATHS.has(destRel);
        if (exists && !managedOverwrite) {
            continue;
        }
        const bytes = readTemplateFileBytes(templatePath);
        totalBytes += bytes.byteLength;
        const contentDigest = sha256Hex(bytes);
        const preview = computeBytesPreview(bytes, BOOTSTRAP_LIMITS.maxContentPreviewBytes);
        fileOps.push(
            makeOpBase({
                op: "copyTemplate",
                path: destRel,
                preconditions: exists ? { mustExist: true } : { mustNotExist: true },
                content: {
                    encoding: "utf-8",
                    sha256: contentDigest,
                    bytes: preview.bytes,
                    preview: preview.preview,
                },
                reason: {
                    ruleId: "template-copy",
                    message: "Copy repo-context-kit runtime scaffold template file.",
                    evidence: { templatePath },
                },
            }),
        );
    }

    const readmeRel = assertBootstrapPathAllowed("README.md");
    const readmeText = buildReadmeContent(planning);
    const readmeBytes = Buffer.from(readmeText, "utf-8");
    totalBytes += readmeBytes.byteLength;
    fileOps.push(
        makeOpBase({
            op: "writeFile",
            path: readmeRel,
            preconditions: { mustNotExist: true },
            content: {
                encoding: "utf-8",
                sha256: sha256Hex(readmeBytes),
                bytes: readmeBytes.byteLength,
                preview: computeBytesPreview(readmeBytes, BOOTSTRAP_LIMITS.maxContentPreviewBytes).preview,
                text: readmeText,
            },
            reason: {
                ruleId: "bootstrap-readme",
                message: "Write a minimal project README derived from extracted doc sections.",
                evidence: { fromDoc: doc.path, extractedSections: planningSource.extractedSections },
            },
        }),
    );

    fileOps.push(
        makeOpBase({
            op: "snapshot",
            path: assertBootstrapPathAllowed(".aidw/runtime/snapshots/snapshots.jsonl"),
            preconditions: {},
            reason: {
                ruleId: "bootstrap-snapshot",
                message: "Record an apply snapshot after scaffold is written.",
                evidence: {},
            },
        }),
    );

    const dirs = new Set();
    dirs.add(assertBootstrapPathAllowed(CONTEXT_INDEX_DIR));
    dirs.add(assertBootstrapPathAllowed(CONTEXT_TASKS_DIR));
    for (const op of fileOps) {
        const parent = path.posix.dirname(op.path);
        if (parent && parent !== "." && parent !== "/") {
            dirs.add(assertBootstrapPathAllowed(parent));
        }
    }
    const mkdirOps = [...dirs]
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .map((dirPath) =>
            makeOpBase({
                op: "mkdir",
                path: dirPath,
                preconditions: {},
                reason: {
                    ruleId: "bootstrap-mkdir",
                    message: "Ensure required directory exists for runtime scaffold.",
                    evidence: {},
                },
            }),
        );

    const ops = [...mkdirOps, ...fileOps].slice(0, BOOTSTRAP_LIMITS.maxOps);
    if (ops.length >= BOOTSTRAP_LIMITS.maxOps) {
        bootstrapRisks.push(
            buildBootstrapRisk({
                id: "bootstrap-ops-capped",
                severity: "blocker",
                category: "safety",
                message: "Bootstrap plan exceeded operation limits.",
                evidence: { maxOps: BOOTSTRAP_LIMITS.maxOps },
                suggestedAction: "Reduce scaffold scope or update limits before applying.",
            }),
        );
    }
    if (templateFiles.length > BOOTSTRAP_LIMITS.maxFiles || totalBytes > BOOTSTRAP_LIMITS.maxTotalBytes) {
        bootstrapRisks.push(
            buildBootstrapRisk({
                id: "bootstrap-oversized-scaffold",
                severity: "blocker",
                category: "safety",
                message: "Bootstrap scaffold exceeds size limits.",
                evidence: { totalBytes, maxTotalBytes: BOOTSTRAP_LIMITS.maxTotalBytes, templateFiles: templateFiles.length, maxFiles: BOOTSTRAP_LIMITS.maxFiles },
                suggestedAction: "Reduce scaffold size before applying.",
            }),
        );
    }

    const orderedOps = ops.map((op, index) => ({ ...op, order: index + 1 }));
    const plan = {
        bootstrapVersion: BOOTSTRAP_VERSION,
        writeMode: wm,
        limits: BOOTSTRAP_LIMITS,
        ops: orderedOps,
    };
    const digest = buildPlanDigest(plan);
    const pauseToken = buildPauseToken(digest);
    const finalized = { ...plan, digest, pauseToken };

    const nextActions = [
        "Review the bootstrap plan.",
        "Apply with explicit confirmation: repo-context-kit bootstrap apply --from-plan <path> --confirm <token> --enable-write",
    ];

    const runtimePlanning = {
        sourceType: "design-doc",
        path: doc.path,
        sizeBytes: doc?.metadata?.sizeBytes ?? null,
        goalsCount: Array.isArray(planning.goals) ? planning.goals.length : 0,
        requirementsCount: Array.isArray(planning.requirements) ? planning.requirements.length : 0,
        scopeCount: Array.isArray(planning.scope) ? planning.scope.length : 0,
        acceptanceCriteriaCount: Array.isArray(planning.acceptanceCriteria) ? planning.acceptanceCriteria.length : 0,
        conflictingRequirements: Boolean(planning?.analysis?.conflictingRequirements),
    };
    const autoRisks = collectRuntimeRisks({
        repoRoot: root,
        task: { id: "BOOTSTRAP", title: "Bootstrap Runtime", goal: "Bootstrap runtime scaffold for a new project." },
        scan: { status: "fresh", plan: [] },
        workset: { mode: "digest", files: orderedOps.map((o) => o.path), summary: "", text: renderPlanText(finalized) },
        lessons: [],
        loop: [],
        runtime: { writeEnabled: false, planning: runtimePlanning },
        executionState: { sessionId: null, pauseId: null, phase: "bootstrap_planned", status: "planned" },
    });
    const mergedRisks = [...bootstrapRisks, ...srhs.risks, ...autoRisks];

    const contract = buildRuntimeContract({
        repoRoot: root,
        planningSource,
        task: { id: "BOOTSTRAP", title: "Bootstrap Runtime", goal: "Bootstrap runtime scaffold for a new project." },
        scan: { status: "fresh", plan: [] },
        workset: { mode: "digest", files: orderedOps.map((o) => o.path), summary: "", text: renderPlanText(finalized) },
        prompt: "Bootstrap runtime plan generated. Review ops, confirm token, then apply scaffold with bounded write permissions.",
        lessons: [],
        loop: [],
        runtime: { writeEnabled: false },
        risks: mergedRisks,
        nextActions,
        executionState: { sessionId: null, pauseId: null, phase: "bootstrap_planned", status: "planned" },
    });
    contract.bootstrap = {
        bootstrapVersion: BOOTSTRAP_VERSION,
        projectType: "unknown",
        stack,
        scaffoldMeta,
        matchedRecipeIds,
        scaffoldHints,
        constraints: {
            allowOverwrite: wm === "overwrite-managed",
            maxFiles: BOOTSTRAP_LIMITS.maxFiles,
            maxTotalBytes: BOOTSTRAP_LIMITS.maxTotalBytes,
            allowedOps: [...new Set([...orderedOps.map((o) => o.op), "snapshot"])].sort(),
            allowedPaths: ["AGENTS.md", "skill.md", "README.md", "task/", ".aidw/", ".claude/", ".github/", ".trae/"],
        },
        structurePlan: {
            directories: [...new Set(orderedOps.filter((o) => o.op === "mkdir").map((o) => o.path))].sort(),
            files: [...new Set(orderedOps.filter((o) => o.op !== "mkdir").map((o) => o.path))].sort().map((p) => ({ path: p, purpose: "bootstrap-scaffold" })),
        },
        bootstrapTasks: [
            { id: "B-001", title: "Apply runtime scaffold", deps: [], outputs: ["AGENTS.md", ".aidw/", "README.md"] },
            { id: "B-002", title: "Run scan after adding project files", deps: ["B-001"], outputs: [".aidw/index/*"] },
        ],
        scaffoldPlan: { ops: orderedOps, digest, pauseToken },
        writeMode: wm,
        snapshot: { plannedSnapshotId: null, appliedSnapshotId: null },
        runtimeVersion: CURRENT_RUNTIME_VERSION,
    };

    return {
        ok: true,
        repoRoot: root,
        fromDoc: doc.path,
        planning,
        plan: finalized,
        digest,
        pauseToken,
        scaffoldMeta,
        matchedRecipeIds,
        scaffoldHints,
        contract,
        risks: contract.risks,
        nextActions: contract.nextActions,
        explain: {
            extractedSections: planningSource.extractedSections,
            sectionHits: planning?.analysis?.sectionHits ?? {},
        },
    };
}
