import { withRepoRoot } from "../runtime/root-context.js";
import { getPackageJson } from "../scan/package-utils.js";
import { exists, isDirectory } from "../scan/fs-utils.js";
import { computeRiskSeveritySummary, sortRisksStable } from "../runtime/risk-utils.js";
import { planBootstrapRuntime } from "./plan.js";

function parseMajor(versionSpec) {
    const raw = String(versionSpec ?? "").trim();
    if (!raw) return null;
    const match = raw.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    const major = Number.parseInt(match[1], 10);
    return Number.isFinite(major) ? major : null;
}

function normalizeDeps(pkg) {
    return {
        ...(pkg?.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {}),
        ...(pkg?.devDependencies && typeof pkg.devDependencies === "object" ? pkg.devDependencies : {}),
    };
}

function buildDoctorRisk({
    id,
    code,
    severity,
    category,
    message,
    evidence,
    safe_actions,
    manual_review_actions,
}) {
    const safe = Array.isArray(safe_actions)
        ? safe_actions.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12)
        : [];
    const manual = Array.isArray(manual_review_actions)
        ? manual_review_actions.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12)
        : [];
    const suggestedAction = safe[0] ?? manual[0] ?? "";

    return {
        id,
        code: code ?? null,
        severity,
        source: "bootstrap.doctor",
        category,
        message,
        evidence: evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {},
        suggestedAction,
        safe_actions: safe,
        manual_review_actions: manual,
    };
}

function detectNextShape() {
    const hasAppDir = isDirectory("app") || isDirectory("src/app");
    const hasPagesDir = isDirectory("pages") || isDirectory("src/pages");
    const appLayoutCandidates = [
        "app/layout.tsx",
        "app/layout.jsx",
        "app/layout.ts",
        "app/layout.js",
        "src/app/layout.tsx",
        "src/app/layout.jsx",
        "src/app/layout.ts",
        "src/app/layout.js",
    ];
    const pagesAppCandidates = [
        "pages/_app.tsx",
        "pages/_app.jsx",
        "pages/_app.ts",
        "pages/_app.js",
        "src/pages/_app.tsx",
        "src/pages/_app.jsx",
        "src/pages/_app.ts",
        "src/pages/_app.js",
    ];
    const hasLayout = appLayoutCandidates.some((p) => exists(p));
    const hasPagesApp = pagesAppCandidates.some((p) => exists(p));
    const hasNextEnv = exists("next-env.d.ts");
    const usesTypeScript = exists("tsconfig.json");

    const isApp = hasAppDir || hasLayout;
    const isPages = hasPagesDir || hasPagesApp;

    const shape =
        isApp && isPages ? "hybrid" : isApp ? "app-router" : isPages ? "pages-router" : "unknown";

    return {
        shape,
        signals: {
            hasAppDir,
            hasPagesDir,
            hasLayout,
            hasPagesApp,
            usesTypeScript,
            hasNextEnv,
        },
    };
}

function preferredAppDir() {
    if (isDirectory("src/app")) return "src/app";
    return "app";
}

function buildDependencyCompatibilityRisks(pkg) {
    const deps = normalizeDeps(pkg);
    const nextSpec = deps.next ?? null;
    const reactSpec = deps.react ?? null;
    const reactDomSpec = deps["react-dom"] ?? null;
    const typescriptSpec = deps.typescript ?? null;
    const tailwindSpec = deps.tailwindcss ?? null;
    const postcssSpec = deps.postcss ?? null;
    const autoprefixerSpec = deps.autoprefixer ?? null;
    const hasTailwindConfig =
        exists("tailwind.config.js") ||
        exists("tailwind.config.cjs") ||
        exists("tailwind.config.mjs") ||
        exists("tailwind.config.ts");
    const hasPostCssConfig = exists("postcss.config.js") || exists("postcss.config.cjs") || exists("postcss.config.mjs") || exists("postcss.config.ts");
    const hasShadcnConfig = exists("components.json");

    const detected = {
        next: nextSpec ? { spec: nextSpec, major: parseMajor(nextSpec) } : null,
        react: reactSpec ? { spec: reactSpec, major: parseMajor(reactSpec) } : null,
        reactDom: reactDomSpec ? { spec: reactDomSpec, major: parseMajor(reactDomSpec) } : null,
        typescript: typescriptSpec ? { spec: typescriptSpec, major: parseMajor(typescriptSpec) } : null,
        tailwindcss: tailwindSpec ? { spec: tailwindSpec, major: parseMajor(tailwindSpec) } : null,
        postcss: postcssSpec ? { spec: postcssSpec, major: parseMajor(postcssSpec) } : null,
        autoprefixer: autoprefixerSpec ? { spec: autoprefixerSpec, major: parseMajor(autoprefixerSpec) } : null,
        shadcn: hasShadcnConfig ? { config: "components.json" } : null,
        configSignals: {
            hasTailwindConfig,
            hasPostCssConfig,
        },
    };

    const risks = [];
    if (!pkg) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-package-json",
                code: "RCK_DEP_MISSING_PACKAGE_JSON",
                severity: "warning",
                category: "dependency",
                message: "package.json was not found. Dependency compatibility checks are limited.",
                evidence: {},
                safe_actions: [],
                manual_review_actions: ["Create package.json or run your scaffold tool to initialize the project."],
            }),
        );
        return { detected, risks };
    }

    const unknownRanges = {};
    for (const [name, item] of Object.entries(detected)) {
        if (!item || typeof item !== "object" || typeof item.spec !== "string") continue;
        if (item.major == null) {
            unknownRanges[name] = item.spec;
        }
    }
    if (Object.keys(unknownRanges).length) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-unknown-range",
                code: "RCK_DEP_UNKNOWN_RANGE",
                severity: "warning",
                category: "dependency",
                message: "Some dependency version ranges could not be parsed. Compatibility checks are conservative.",
                evidence: { unknownRanges },
                manual_review_actions: ["Pin exact versions or confirm peer requirements before running install."],
            }),
        );
    }

    if (nextSpec && !reactSpec) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-react",
                code: "RCK_DEP_MISSING_REACT",
                severity: "blocker",
                category: "dependency",
                message: "Next.js is present but React is missing from dependencies.",
                evidence: { next: nextSpec },
                manual_review_actions: ["Install React and React DOM: npm install react react-dom"],
            }),
        );
    }

    if (reactSpec && !reactDomSpec) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-react-dom",
                code: "RCK_DEP_MISSING_REACT_DOM",
                severity: "warning",
                category: "dependency",
                message: "React is present but react-dom is missing from dependencies.",
                evidence: { react: reactSpec },
                manual_review_actions: ["Install React DOM: npm install react-dom"],
            }),
        );
    }

    if (nextSpec && reactSpec) {
        const nextMajor = parseMajor(nextSpec);
        const reactMajor = parseMajor(reactSpec);
        if (nextMajor != null && reactMajor != null) {
            if (nextMajor >= 15 && reactMajor < 18) {
                risks.push(
                    buildDoctorRisk({
                        id: "bootstrap-doctor-peer-mismatch-next-react",
                        code: "RCK_DEP_PEER_MISMATCH",
                        severity: "warning",
                        category: "dependency",
                        message: "Next.js and React major versions look mismatched. Confirm peer dependency compatibility before installing.",
                        evidence: { next: nextSpec, react: reactSpec },
                        manual_review_actions: ["Check Next.js/React peer requirements and adjust versions before running install."],
                    }),
                );
            }
        }
    }

    if ((tailwindSpec || hasTailwindConfig) && !tailwindSpec) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-tailwind",
                code: "RCK_DEP_MISSING_TAILWIND",
                severity: "warning",
                category: "dependency",
                message: "Tailwind config signals are present but tailwindcss dependency is missing.",
                evidence: { hasTailwindConfig },
                manual_review_actions: ["Install Tailwind toolchain: npm install -D tailwindcss postcss autoprefixer"],
            }),
        );
    }

    if (tailwindSpec) {
        const major = parseMajor(tailwindSpec);
        if (major != null && major >= 4) {
            risks.push(
                buildDoctorRisk({
                    id: "bootstrap-doctor-tailwind-v4",
                    code: "RCK_DEP_UNSUPPORTED_COMBO",
                    severity: "warning",
                    category: "dependency",
                    message: "tailwindcss@4 detected. Some scaffold recipes and PostCSS setups may not be compatible without manual adjustments.",
                    evidence: { tailwindcss: tailwindSpec },
                    manual_review_actions: [
                        "If you hit build errors, consider switching to tailwindcss@3 and ensure postcss/autoprefixer are installed.",
                        "Alternative: use a fallback CSS scaffold instead of Tailwind.",
                    ],
                }),
            );
        }
    }

    if (tailwindSpec && !hasTailwindConfig) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-tailwind-config",
                code: "RCK_TAILWIND_CONFIG_MISSING",
                severity: "warning",
                category: "config",
                message: "tailwindcss is present but no tailwind config file was found.",
                evidence: { tailwindcss: tailwindSpec },
                safe_actions: ["Create tailwind.config.{js,cjs,mjs,ts}"],
            }),
        );
    }

    if (tailwindSpec && (!postcssSpec || !autoprefixerSpec)) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-postcss-tooling",
                code: "RCK_DEP_MISSING_POSTCSS",
                severity: "warning",
                category: "dependency",
                message: "Tailwind is present but PostCSS tooling dependencies are missing.",
                evidence: { tailwindcss: tailwindSpec, postcss: postcssSpec ?? null, autoprefixer: autoprefixerSpec ?? null },
                manual_review_actions: ["Install PostCSS tooling: npm install -D postcss autoprefixer"],
            }),
        );
    }

    if (hasShadcnConfig && !tailwindSpec) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-shadcn-without-tailwind",
                code: "RCK_DEP_INCOMPLETE_STACK",
                severity: "warning",
                category: "dependency",
                message: "Shadcn UI config (components.json) detected, but Tailwind is not present. Confirm intended styling stack.",
                evidence: { componentsJson: true },
                manual_review_actions: ["If using shadcn/ui, ensure Tailwind is configured and installed."],
            }),
        );
    }

    return { detected, risks };
}

function buildNextShapeRisks({ shape, signals }, pkg) {
    const deps = normalizeDeps(pkg);
    const nextSpec = deps.next ?? null;
    const risks = [];

    if (!nextSpec && shape === "unknown") {
        return { risks, shape };
    }

    if (shape === "unknown") {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-next-unknown-shape",
                code: "RCK_NEXT_UNKNOWN_SHAPE",
                severity: "warning",
                category: "project-shape",
                message: "Next.js detected but project shape (app/pages router) could not be determined from files.",
                evidence: { next: nextSpec, signals },
                manual_review_actions: ["Confirm whether this is an app router or pages router project and ensure the expected directories exist."],
            }),
        );
        return { risks, shape };
    }

    if (shape === "app-router") {
        if (!signals.hasLayout) {
            const appDir = preferredAppDir();
            const usesTs = Boolean(signals.usesTypeScript);
            const suggested = `${appDir}/layout.${usesTs ? "tsx" : "js"}`;
            risks.push(
                buildDoctorRisk({
                    id: "bootstrap-doctor-next-missing-layout",
                    code: "RCK_NEXT_MISSING_LAYOUT",
                    severity: "blocker",
                    category: "project-shape",
                    message: "Next.js app router requires a root layout component.",
                    evidence: { next: nextSpec, expected: suggested },
                    safe_actions: [`Create ${suggested}`],
                    manual_review_actions: ["If you intended pages router, move routing files under pages/ instead of app/."],
                }),
            );
        }
    }

    if (signals.usesTypeScript && !signals.hasNextEnv) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-next-missing-next-env",
                code: "RCK_NEXT_MISSING_NEXT_ENV",
                severity: "warning",
                category: "project-shape",
                message: "TypeScript detected but next-env.d.ts is missing.",
                evidence: { expected: "next-env.d.ts" },
                safe_actions: ["Create next-env.d.ts (as generated by Next.js)"],
            }),
        );
    }

    return { risks, shape };
}

function buildScriptRisks(pkg) {
    const risks = [];
    if (!pkg || !pkg.scripts || typeof pkg.scripts !== "object") {
        return risks;
    }
    const deps = normalizeDeps(pkg);
    const nextSpec = deps.next ?? null;
    if (!nextSpec) return risks;

    const scripts = pkg.scripts;
    const missing = [];
    if (!scripts.dev) missing.push("dev");
    if (!scripts.build) missing.push("build");
    if (!scripts.start) missing.push("start");

    if (missing.length) {
        const safe_actions = [];
        if (missing.includes("dev")) safe_actions.push('Add "dev": "next dev" to package.json scripts');
        if (missing.includes("build")) safe_actions.push('Add "build": "next build" to package.json scripts');
        if (missing.includes("start")) safe_actions.push('Add "start": "next start" to package.json scripts');
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-scripts",
                code: "RCK_CONFIG_MISSING_SCRIPT",
                severity: "warning",
                category: "config",
                message: `package.json is missing important Next.js scripts: ${missing.join(", ")}`,
                evidence: { missing },
                safe_actions,
            }),
        );
    }
    return risks;
}

function buildConfigRisks(pkg) {
    const risks = [];
    const deps = normalizeDeps(pkg);
    const typescriptSpec = deps.typescript ?? null;
    if (typescriptSpec && !exists("tsconfig.json")) {
        risks.push(
            buildDoctorRisk({
                id: "bootstrap-doctor-missing-tsconfig",
                code: "RCK_CONFIG_MISSING_TSCONFIG",
                severity: "warning",
                category: "config",
                message: "TypeScript dependency is present but tsconfig.json is missing.",
                evidence: { typescript: typescriptSpec },
                safe_actions: ["Create tsconfig.json"],
            }),
        );
    }
    return risks;
}

function computeDoctorStatus(summary) {
    const blocker = Number(summary?.blocker ?? 0);
    const warning = Number(summary?.warning ?? 0);
    if (blocker > 0) return "error";
    if (warning > 0) return "warning";
    return "ok";
}

export function buildBootstrapDoctorJsonV1(report) {
    const risks = Array.isArray(report?.risks)
        ? report.risks
              .filter((r) => r && typeof r === "object")
              .map((risk) => ({
                  code: String(risk.code ?? "").trim() || "RCK_UNSPECIFIED",
                  severity: String(risk.severity ?? "").trim(),
                  category: String(risk.category ?? "").trim(),
                  message: String(risk.message ?? "").trim(),
                  evidence: risk.evidence && typeof risk.evidence === "object" && !Array.isArray(risk.evidence) ? risk.evidence : {},
                  safe_actions: Array.isArray(risk.safe_actions) ? risk.safe_actions : [],
                  manual_review_actions: Array.isArray(risk.manual_review_actions) ? risk.manual_review_actions : [],
              }))
        : [];
    const suggestedActions = report?.actions && typeof report.actions === "object"
        ? {
              safe_actions: Array.isArray(report.actions.safe_actions) ? report.actions.safe_actions : [],
              manual_review_actions: Array.isArray(report.actions.manual_review_actions) ? report.actions.manual_review_actions : [],
          }
        : { safe_actions: [], manual_review_actions: [] };
    const summary = report?.riskSummary && typeof report.riskSummary === "object" ? report.riskSummary : {};
    return {
        schema: "repo-context-kit/bootstrap-doctor/v1",
        status: computeDoctorStatus(summary),
        projectShape: report?.projectShape ?? { shape: "unknown", signals: {}, missingRequiredFiles: [] },
        dependencyCompatibility: report?.dependencyCompatibility ?? { detected: {}, risks: [] },
        dryRunPlan: report?.dryRunPlan ?? { enabled: false },
        risks,
        suggestedActions,
        boundaries: {
            writes: false,
            installs: false,
            lockfileChanges: false,
            network: false,
        },
    };
}

function collectTieredActions(risks) {
    const safe = new Set();
    const manual = new Set();
    for (const risk of Array.isArray(risks) ? risks : []) {
        for (const action of Array.isArray(risk?.safe_actions) ? risk.safe_actions : []) {
            const text = String(action ?? "").trim();
            if (text) safe.add(text);
        }
        for (const action of Array.isArray(risk?.manual_review_actions) ? risk.manual_review_actions : []) {
            const text = String(action ?? "").trim();
            if (text) manual.add(text);
        }
    }
    return {
        safe_actions: [...safe].sort(),
        manual_review_actions: [...manual].sort(),
    };
}

function renderDoctorText(report) {
    const lines = ["Bootstrap Doctor", ""];
    lines.push("## Dependency Compatibility", "");
    const det = report.dependencyCompatibility.detected;
    const detectedLineParts = [];
    for (const key of ["next", "react", "reactDom", "tailwindcss", "postcss", "autoprefixer"]) {
        const item = det[key];
        if (item?.spec) {
            detectedLineParts.push(`${key}@${item.spec}`);
        }
    }
    lines.push(`Detected: ${detectedLineParts.join(", ") || "-"}`);
    if (det.shadcn) {
        lines.push("Detected: shadcn/ui (components.json)");
    }
    lines.push("");

    lines.push("## Project Shape", "");
    lines.push(`Detected: ${report.projectShape.shape}`);
    if (report.projectShape.shape !== "unknown") {
        const missing = report.projectShape.missingRequiredFiles;
        if (missing.length) {
            lines.push("Missing required files:");
            for (const file of missing) lines.push(`- ${file}`);
        }
    }
    lines.push("");

    lines.push("## Dry Run Plan", "");
    if (report.dryRunPlan?.enabled) {
        lines.push(`fromDoc: ${report.dryRunPlan.fromDoc}`);
        lines.push(`digest: ${report.dryRunPlan.digest}`);
        lines.push(`pauseToken: ${report.dryRunPlan.pauseToken}`);
        if (report.dryRunPlan.matchedRecipeIds.length) {
            lines.push(`matchedRecipes: ${report.dryRunPlan.matchedRecipeIds.join(", ")}`);
        }
        if (report.dryRunPlan.scaffoldHints.length) {
            lines.push("scaffoldHints:");
            for (const hint of report.dryRunPlan.scaffoldHints.slice(0, 3)) {
                const tool = String(hint?.tool ?? "").trim();
                const command = String(hint?.command ?? "").trim();
                const args = Array.isArray(hint?.args) ? hint.args.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
                if (command) {
                    lines.push(`- ${[tool, command, ...args].filter(Boolean).join(" ").trim()}`);
                }
            }
        }
    } else {
        lines.push("No design doc provided. (Pass --from-doc <path> to generate a dry-run bootstrap plan.)");
    }
    lines.push("");

    const summary = report.riskSummary;
    lines.push("## Risks", "");
    lines.push(`- blocker: ${summary.blocker}, warning: ${summary.warning}, info: ${summary.info}`);
    for (const risk of report.risks.slice(0, 20)) {
        const code = risk.code ? ` (${risk.code})` : "";
        lines.push(`- [${risk.severity}] ${risk.id}${code}: ${risk.message}`);
    }
    if (report.risks.length > 20) {
        lines.push(`- … (${report.risks.length - 20} more)`);
    }
    lines.push("");

    lines.push("## Suggested Actions", "");
    if (report.actions.safe_actions.length) {
        lines.push("safe_actions:");
        for (const action of report.actions.safe_actions) lines.push(`- ${action}`);
    }
    if (report.actions.manual_review_actions.length) {
        lines.push("manual_review_actions:");
        for (const action of report.actions.manual_review_actions) lines.push(`- ${action}`);
    }
    if (!report.actions.safe_actions.length && !report.actions.manual_review_actions.length) {
        lines.push("- (none)");
    }

    return lines.join("\n").trimEnd();
}

export function bootstrapDoctor({ repoRoot, fromDoc = null } = {}) {
    const root = String(repoRoot ?? "").trim() || process.cwd();
    return withRepoRoot(root, () => {
        const pkg = getPackageJson();
        const dependencyCompatibility = buildDependencyCompatibilityRisks(pkg);

        const nextShape = detectNextShape();
        const projectShapeRisks = buildNextShapeRisks(nextShape, pkg);
        const scriptRisks = buildScriptRisks(pkg);
        const configRisks = buildConfigRisks(pkg);

        const projectShape = {
            shape: projectShapeRisks.shape,
            signals: nextShape.signals,
            missingRequiredFiles: [],
        };
        for (const risk of projectShapeRisks.risks) {
            const expected = String(risk?.evidence?.expected ?? "").trim();
            if (risk.code === "RCK_NEXT_MISSING_LAYOUT" && expected) {
                projectShape.missingRequiredFiles.push(expected);
            }
            if (risk.code === "RCK_NEXT_MISSING_NEXT_ENV") {
                projectShape.missingRequiredFiles.push("next-env.d.ts");
            }
        }
        projectShape.missingRequiredFiles = [...new Set(projectShape.missingRequiredFiles)].sort();

        const risks = [
            ...dependencyCompatibility.risks,
            ...projectShapeRisks.risks,
            ...scriptRisks,
            ...configRisks,
        ];

        let dryRunPlan = { enabled: false, note: "No design doc provided." };
        if (fromDoc) {
            const planned = planBootstrapRuntime({ repoRoot: root, fromDoc, writeMode: "create-only" });
            dryRunPlan = {
                enabled: true,
                fromDoc: planned.fromDoc,
                digest: planned.digest,
                pauseToken: planned.pauseToken,
                matchedRecipeIds: Array.isArray(planned.matchedRecipeIds) ? planned.matchedRecipeIds.slice(0, 12) : [],
                scaffoldHints: Array.isArray(planned.scaffoldHints) ? planned.scaffoldHints.slice(0, 12) : [],
                planOps: Array.isArray(planned.plan?.ops) ? planned.plan.ops.length : 0,
                note: "Dry-run plan only. No files were written, no installs were performed.",
            };
        }

        const orderedRisks = sortRisksStable(risks, { secondaryKey: "code" });
        const actions = collectTieredActions(orderedRisks);
        const report = {
            ok: true,
            command: "bootstrap",
            action: "doctor",
            repoRoot: root,
            dependencyCompatibility,
            projectShape,
            dryRunPlan,
            risks: orderedRisks,
            riskSummary: computeRiskSeveritySummary(orderedRisks),
            actions,
        };

        return {
            report,
            json: buildBootstrapDoctorJsonV1(report),
            text: renderDoctorText(report),
        };
    });
}
