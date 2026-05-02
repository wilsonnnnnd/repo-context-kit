function normalizeList(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
}

function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }
    return Math.max(0, Math.min(1, number));
}

function computeConfidence({ signalCount, failureStreak, warningsCount }) {
    const signals = Number.isFinite(Number(signalCount)) ? Number(signalCount) : 0;
    const streak = Number.isFinite(Number(failureStreak)) ? Number(failureStreak) : 0;
    const warnings = Number.isFinite(Number(warningsCount)) ? Number(warningsCount) : 0;

    const score = clamp01(
        0.15 * Math.min(6, signals) +
            0.2 * Math.min(3, streak) +
            0.1 * Math.min(5, warnings),
    );

    const level = score >= 0.7 ? "HIGH" : score >= 0.4 ? "MEDIUM" : "LOW";
    return { score, level };
}

export function formatBudgetDecisionMarkdown(decision, options = {}) {
    if (!decision || !decision.mode || !decision.decision) {
        return "";
    }

    const warningsCount = Number.isFinite(Number(options.warningsCount))
        ? Number(options.warningsCount)
        : null;

    const upgrades = normalizeList(decision.upgradesApplied);
    const reasonCodes = normalizeList(decision.reasonCodes);
    const evidence = normalizeList(decision.evidence);
    const failureStreak = Number.isFinite(Number(options.failureStreak))
        ? Number(options.failureStreak)
        : null;
    const signalCount = Number.isFinite(Number(options.signalCount))
        ? Number(options.signalCount)
        : reasonCodes.length;

    if (warningsCount != null) {
        evidence.push(`warnings_count=${warningsCount}`);
        if (warningsCount > 0 && !reasonCodes.includes("WARNINGS_PRESENT")) {
            reasonCodes.push("WARNINGS_PRESENT");
        }
    }

    const confidence = computeConfidence({
        signalCount,
        failureStreak: failureStreak ?? 0,
        warningsCount: warningsCount ?? 0,
    });

    const upgradesText = upgrades.length ? upgrades.join(", ") : "none";
    const reasonsText = reasonCodes.length ? reasonCodes.join(", ") : "none";
    const evidenceLines = evidence.length
        ? evidence.map((line) => `  - ${line}`).join("\n")
        : "  - none";

    return [
        "## Budget Decision",
        "",
        `- mode: ${decision.mode}`,
        `- decision: ${decision.decision}`,
        `- confidence: ${confidence.level} (${confidence.score.toFixed(2)})`,
        `- upgrades_applied: ${upgradesText}`,
        `- reason_codes: ${reasonsText}`,
        "- evidence:",
        evidenceLines,
        "- override:",
        "  - use --budget off to disable auto budget",
        "  - use --budget full for explicit full output",
    ].join("\n");
}

export function buildBudgetDecisionEvent(decision, options = {}) {
    if (!decision || !decision.mode || !decision.decision) {
        return null;
    }

    const warningsCount = Number.isFinite(Number(options.warningsCount))
        ? Number(options.warningsCount)
        : null;

    const reasonCodes = normalizeList(decision.reasonCodes);
    const evidence = normalizeList(decision.evidence);
    const upgradesApplied = normalizeList(decision.upgradesApplied);
    const failureStreak = Number.isFinite(Number(options.failureStreak))
        ? Number(options.failureStreak)
        : null;
    const signalCount = Number.isFinite(Number(options.signalCount))
        ? Number(options.signalCount)
        : reasonCodes.length;

    if (warningsCount != null) {
        evidence.push(`warnings_count=${warningsCount}`);
        if (warningsCount > 0 && !reasonCodes.includes("WARNINGS_PRESENT")) {
            reasonCodes.push("WARNINGS_PRESENT");
        }
    }

    const confidence = computeConfidence({
        signalCount,
        failureStreak: failureStreak ?? 0,
        warningsCount: warningsCount ?? 0,
    });

    const payload = {
        type: "budget_decision",
        mode: decision.mode,
        decision: decision.decision,
        confidence: Number(confidence.score.toFixed(2)),
        confidenceLevel: confidence.level,
        reasonCodes,
        evidence,
    };

    if (upgradesApplied.length) {
        payload.upgradesApplied = upgradesApplied;
    }

    if (options.taskId) {
        payload.taskId = String(options.taskId).trim().toUpperCase();
    }

    if (options.command) {
        payload.command = String(options.command);
    }

    return payload;
}
