import { SCAFFOLD_RECIPES_V1, SCAFFOLD_RECIPES_VERSION } from "./scaffold-recipes.js";
import { stableStringCompare } from "../runtime/stable-sort.js";

const DEFAULT_LIMITS = {
    maxKeywords: 24,
    maxHints: 3,
    maxMatchedRecipes: 3,
    maxCommandChars: 80,
    maxArgCount: 12,
    maxArgChars: 40,
    maxCreatesPaths: 12,
    maxRationaleChars: 240,
};

const KEYWORD_ALIASES = new Map([
    ["nextjs", "next.js"],
    ["next", "next.js"],
    ["reactjs", "react"],
    ["nodejs", "node"],
    ["node.js", "node"],
    ["cli-tool", "node cli"],
    ["fast api", "fastapi"],
]);

const KNOWN_KEYWORDS = new Set([
    "react",
    "next.js",
    "vite",
    "python",
    "fastapi",
    "node",
    "node cli",
    "cli",
    "library",
    "typescript",
]);

const PROHIBITED_TOKENS = [
    "npm install",
    "pnpm install",
    "yarn add",
    "curl ",
    "wget ",
    "bash",
    "sh ",
    "powershell",
    "cmd.exe",
];

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function normalizeToken(raw) {
    const text = String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/[`"'“”‘’]/g, "")
        .replace(/[^\w.+-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!text) return null;
    const alias = KEYWORD_ALIASES.get(text);
    return alias ?? text;
}

function uniqueSorted(values) {
    return [...new Set(values.map((x) => String(x ?? "").trim()).filter(Boolean))].sort(stableStringCompare);
}

function clampText(value, maxChars) {
    const text = String(value ?? "").trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function extractScaffoldKeywords({ planning, docContent, limits = DEFAULT_LIMITS } = {}) {
    const tokens = [];
    const pushFromArray = (arr) => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
            const parts = String(item ?? "").split(/\s+/g);
            for (const part of parts) {
                const normalized = normalizeToken(part);
                if (!normalized) continue;
                tokens.push(normalized);
            }
        }
    };
    pushFromArray(planning?.goals);
    pushFromArray(planning?.requirements);
    pushFromArray(planning?.constraints);
    pushFromArray(planning?.scope);
    pushFromArray(planning?.acceptanceCriteria);

    const extra = String(docContent ?? "")
        .toLowerCase()
        .replace(/[`"'“”‘’]/g, "")
        .slice(0, 12_000);
    for (const candidate of ["next.js", "nextjs", "react", "vite", "fastapi", "python", "node", "typescript", "library", "cli"]) {
        if (extra.includes(candidate)) {
            const normalized = normalizeToken(candidate);
            if (normalized) tokens.push(normalized);
        }
    }

    const normalized = tokens
        .map(normalizeToken)
        .filter(Boolean)
        .map((x) => (KNOWN_KEYWORDS.has(x) ? x : null))
        .filter(Boolean);
    return uniqueSorted(normalized).slice(0, limits.maxKeywords);
}

function matchesRecipe(recipe, keywords) {
    const set = new Set(keywords);
    const all = Array.isArray(recipe?.match?.all) ? recipe.match.all : [];
    const any = Array.isArray(recipe?.match?.any) ? recipe.match.any : [];
    const none = Array.isArray(recipe?.match?.none) ? recipe.match.none : [];
    if (all.some((k) => !set.has(k))) return false;
    if (any.length > 0 && !any.some((k) => set.has(k))) return false;
    if (none.some((k) => set.has(k))) return false;
    return true;
}

function renderHint(recipe, detectedKeywords, limits) {
    const id = String(recipe?.id ?? "").trim();
    const tool = String(recipe?.tool ?? "").trim();
    const command = String(recipe?.command ?? "").trim();
    const args = Array.isArray(recipe?.argsTemplate)
        ? recipe.argsTemplate.map((x) => clampText(String(x ?? "").trim(), limits.maxArgChars)).filter(Boolean)
        : [];
    const createsPaths = Array.isArray(recipe?.creates?.paths)
        ? uniqueSorted(recipe.creates.paths).slice(0, limits.maxCreatesPaths)
        : [];
    const rationale = clampText(
        `${String(recipe?.rationaleTemplate ?? "").trim()} Keywords: ${detectedKeywords.join(", ")}`.trim(),
        limits.maxRationaleChars,
    );
    const hint = {
        id,
        tool,
        command,
        args: args.slice(0, limits.maxArgCount),
        rationale,
        creates: {
            paths: createsPaths,
            ...(recipe?.creates?.notes ? { notes: clampText(recipe.creates.notes, 240) } : {}),
        },
        safety: { executes: false, reviewOnly: true },
    };
    hint.command = clampText(hint.command, limits.maxCommandChars);
    return hint;
}

function detectRecipeConflicts(matchedRecipeIds) {
    const ids = new Set(matchedRecipeIds);
    const conflicts = [];
    const groups = [
        ["next-app", "python-fastapi", "python-library"],
        ["vite-react", "python-fastapi", "python-library"],
    ];
    for (const group of groups) {
        const present = group.filter((id) => ids.has(id));
        if (present.length > 1) {
            conflicts.push(present.sort(stableStringCompare));
        }
    }
    return conflicts;
}

function validateHintsSafety(scaffoldHints) {
    const issues = [];
    for (const hint of scaffoldHints) {
        const cmd = `${String(hint?.tool ?? "")} ${String(hint?.command ?? "")} ${(Array.isArray(hint?.args) ? hint.args.join(" ") : "")}`
            .trim()
            .toLowerCase();
        for (const token of PROHIBITED_TOKENS) {
            if (cmd.includes(token)) {
                issues.push({ id: hint?.id ?? "-", token });
            }
        }
    }
    return issues;
}

function buildRisk({ id, severity, message, evidence, suggestedAction }) {
    return {
        id,
        severity,
        source: "runtime",
        category: "safety",
        message,
        evidence: isPlainObject(evidence) ? evidence : {},
        suggestedAction: String(suggestedAction ?? "").trim(),
    };
}

export function buildScaffoldHintsSystem({ planning, docContent, limits = DEFAULT_LIMITS } = {}) {
    const effectiveLimits = { ...DEFAULT_LIMITS, ...(isPlainObject(limits) ? limits : {}) };
    const detectedKeywords = extractScaffoldKeywords({ planning, docContent, limits: effectiveLimits });
    const matched = SCAFFOLD_RECIPES_V1.filter((r) => matchesRecipe(r, detectedKeywords));
    const matchedRecipes = matched
        .slice(0, effectiveLimits.maxMatchedRecipes)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || stableStringCompare(a.id, b.id));
    const matchedRecipeIds = matchedRecipes.map((r) => r.id);

    const scaffoldHints = matchedRecipes
        .map((r) => renderHint(r, detectedKeywords, effectiveLimits))
        .filter((h) => h.command)
        .slice(0, effectiveLimits.maxHints)
        .sort((a, b) => stableStringCompare(a.id, b.id) || stableStringCompare(a.command, b.command));

    const risks = [];
    if (detectedKeywords.length === 0) {
        risks.push(
            buildRisk({
                id: "bootstrap-unknown-stack",
                severity: "warning",
                message: "No known stack keywords were detected for scaffold hints.",
                evidence: { detectedKeywords: [] },
                suggestedAction: "Add explicit stack keywords (e.g., next.js, react, vite, python, fastapi) to the doc Requirements/Constraints.",
            }),
        );
    }
    if (matchedRecipeIds.length === 0 && detectedKeywords.length > 0) {
        risks.push(
            buildRisk({
                id: "bootstrap-unknown-stack",
                severity: "warning",
                message: "No scaffold recipes matched the detected stack keywords.",
                evidence: { detectedKeywords },
                suggestedAction: "Clarify stack keywords or add a supported stack (next.js/react, vite/react, python/fastapi, python/library, node cli).",
            }),
        );
    }
    const conflicts = detectRecipeConflicts(matchedRecipeIds);
    if (conflicts.length > 0) {
        risks.push(
            buildRisk({
                id: "bootstrap-conflicting-recipes",
                severity: "warning",
                message: "Multiple conflicting scaffold recipes matched. Confirm the intended project shape before scaffolding.",
                evidence: { matchedRecipeIds, conflicts },
                suggestedAction: "Remove conflicting stack keywords or split the project into multiple repos/services.",
            }),
        );
    }
    if (scaffoldHints.length > effectiveLimits.maxHints) {
        risks.push(
            buildRisk({
                id: "bootstrap-oversized-hints",
                severity: "warning",
                message: "Scaffold hints exceeded limits and were truncated.",
                evidence: { maxHints: effectiveLimits.maxHints, hintsCount: scaffoldHints.length },
                suggestedAction: "Reduce or clarify stack keywords to focus on one scaffold recipe.",
            }),
        );
    }
    const unsafe = validateHintsSafety(scaffoldHints);
    if (unsafe.length > 0) {
        risks.push(
            buildRisk({
                id: "bootstrap-unsafe-command",
                severity: "warning",
                message: "A scaffold hint contains a potentially unsafe command token. Hints are review-only and must not be executed automatically.",
                evidence: { issues: unsafe },
                suggestedAction: "Manually review scaffold commands before executing them in a terminal.",
            }),
        );
    }

    const scaffoldMeta = {
        version: SCAFFOLD_RECIPES_VERSION,
        detectedKeywords,
        matchedRecipeIds,
        limits: {
            maxHints: effectiveLimits.maxHints,
            maxKeywords: effectiveLimits.maxKeywords,
        },
    };

    return {
        scaffoldMeta,
        matchedRecipeIds,
        scaffoldHints,
        risks,
    };
}
