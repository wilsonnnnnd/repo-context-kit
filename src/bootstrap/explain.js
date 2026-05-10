import { serializeJson } from "../runtime/serialize.js";
import { stablePathCompare, stableStringCompare } from "../runtime/stable-sort.js";
import { readBootstrapPlanPayload, getBootstrapPlanFromPayload } from "./plan-io.js";
import { readPdglV1Status } from "../runtime/rdl/pdgl.js";

function uniqueStrings(values) {
    return [...new Set(values.map((x) => String(x ?? "").trim()).filter(Boolean))].sort(stableStringCompare);
}

function renderHint(hint) {
    const tool = String(hint?.tool ?? "").trim();
    const command = String(hint?.command ?? "").trim();
    const args = Array.isArray(hint?.args) ? hint.args.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    const rationale = String(hint?.rationale ?? "").trim();
    const safety = hint?.safety?.reviewOnly ? "reviewOnly (not executed)" : "reviewOnly (not executed)";
    const line = `- ${[tool, command, ...args].filter(Boolean).join(" ").trim()}`;
    return [
        line,
        rationale ? `  rationale: ${rationale}` : null,
        `  safety: ${safety}`,
    ].filter(Boolean);
}

export function explainBootstrapPlan({ planSource } = {}) {
    const payload = readBootstrapPlanPayload(planSource);
    const plan = getBootstrapPlanFromPayload(payload);
    const contract = payload?.contract ?? null;
    const repoRoot = contract?.repoRoot ?? null;
    const planningSource = contract?.planningSource ?? null;
    const scaffoldMeta = payload?.scaffoldMeta ?? contract?.bootstrap?.scaffoldMeta ?? null;
    const matchedRecipeIds = payload?.matchedRecipeIds ?? contract?.bootstrap?.matchedRecipeIds ?? [];
    const scaffoldHints = payload?.scaffoldHints ?? contract?.bootstrap?.scaffoldHints ?? [];
    const risks = payload?.risks ?? contract?.risks ?? [];

    const detectedKeywords = Array.isArray(scaffoldMeta?.detectedKeywords)
        ? uniqueStrings(scaffoldMeta.detectedKeywords)
        : [];
    const matched = Array.isArray(matchedRecipeIds) ? uniqueStrings(matchedRecipeIds) : [];
    const hints = Array.isArray(scaffoldHints) ? scaffoldHints : [];

    const ops = Array.isArray(plan.ops) ? plan.ops : [];
    const plannedOps = ops
        .map((o) => ({ op: String(o?.op ?? "").trim(), path: String(o?.path ?? "").trim(), order: Number(o?.order ?? 0) }))
        .filter((o) => o.op && o.path)
        .sort((a, b) => (a.order || 0) - (b.order || 0) || stablePathCompare(a.path, b.path));

    const explain = {
        planningSource,
        projectDesignReadiness: repoRoot ? readPdglV1Status({ repoRoot }) : null,
        detectedKeywords,
        matchedRecipeIds: matched,
        scaffoldHints: hints,
        plannedOps,
        risks,
        pauseToken: plan.pauseToken ?? null,
        digest: plan.digest ?? null,
        safetyBoundary: {
            scaffoldHintsAreExecutableOps: false,
            applyDoesNotExecuteHints: true,
            applyAllowsOnlyOps: ["mkdir", "writeFile", "copyTemplate", "snapshot"],
        },
    };

    const lines = [
        "Bootstrap Plan Explain",
        "",
        planningSource ? `- planningSource: ${serializeJson(planningSource, { indent: 0 }).trim()}` : "- planningSource: -",
        repoRoot ? `- projectDesignReadiness: ${Number.isFinite(Number(explain.projectDesignReadiness?.score)) ? `${Number(explain.projectDesignReadiness.score)}%` : "-"}` : "- projectDesignReadiness: -",
        `- digest: ${plan.digest ?? "-"}`,
        `- pauseToken: ${plan.pauseToken ?? "-"}`,
        "",
        "Project design guidance:",
        ...(explain.projectDesignReadiness
            ? [
                `- readiness: ${Number.isFinite(Number(explain.projectDesignReadiness.score)) ? `${Number(explain.projectDesignReadiness.score)}%` : "-"}`,
                explain.projectDesignReadiness.missingChecks?.length
                    ? `- missing_checks: ${explain.projectDesignReadiness.missingChecks.slice(0, 12).join(", ")}`
                    : "- missing_checks: (none)",
                ...(Array.isArray(explain.projectDesignReadiness.suggestedImprovements) && explain.projectDesignReadiness.suggestedImprovements.length
                    ? ["Suggested improvements:", ...explain.projectDesignReadiness.suggestedImprovements.slice(0, 8).map((x) => `- ${x}`)]
                    : []),
            ].filter(Boolean)
            : ["- (not available)"]),
        "",
        "Detected keywords:",
        ...(detectedKeywords.length ? detectedKeywords.map((k) => `- ${k}`) : ["- (none)"]),
        "",
        "Matched recipes:",
        ...(matched.length ? matched.map((id) => `- ${id}`) : ["- (none)"]),
        "",
        "Hints:",
        ...(hints.length ? hints.flatMap(renderHint) : ["- (none)"]),
        "",
        "Planned ops:",
        ...(plannedOps.length
            ? plannedOps.slice(0, 120).map((o) => `- ${o.op} ${o.path}`)
            : ["- (none)"]),
        plannedOps.length > 120 ? `- … (${plannedOps.length - 120} more)` : null,
        "",
        "Risks:",
        ...(Array.isArray(risks) && risks.length ? risks.map((r) => `- ${String(r?.severity ?? "").toLowerCase()}: ${String(r?.id ?? "-")} ${String(r?.message ?? "").trim()}`) : ["- (none)"]),
        "",
        "Safety boundary:",
        "- scaffoldHints are review-only metadata (not executable).",
        "- repo-context-kit does not run npx/npm/uv/pip/shell.",
    ].filter(Boolean);

    return {
        ok: true,
        explain,
        output: lines.join("\n").trimEnd(),
    };
}
