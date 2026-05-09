function normalizeLines(text) {
    return String(text ?? "").replace(/\r\n/g, "\n").split("\n");
}

function normalizeHeading(text) {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .replace(/[:：]+$/, "")
        .replace(/\s+/g, " ");
}

function parseMarkdownSections(content) {
    const lines = normalizeLines(content);
    const sections = [];
    let current = { heading: "", level: 0, lines: [] };
    for (const line of lines) {
        const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (match) {
            sections.push(current);
            current = { heading: String(match[2]).trim(), level: match[1].length, lines: [] };
            continue;
        }
        current.lines.push(line);
    }
    sections.push(current);
    return sections;
}

function extractListItems(lines, { maxItems = 24, maxItemChars = 240 } = {}) {
    const items = [];
    for (const line of lines) {
        const trimmed = String(line ?? "").trim();
        if (!trimmed) continue;
        const bullet =
            trimmed.match(/^(?:[-*+])\s+\[.\]\s+(?<t>.+)$/) ||
            trimmed.match(/^(?:[-*+])\s+(?<t>.+)$/) ||
            trimmed.match(/^(?:\d+)[.)]\s+(?<t>.+)$/);
        if (bullet?.groups?.t) {
            const value = String(bullet.groups.t).trim();
            if (!value) continue;
            items.push(value.length > maxItemChars ? `${value.slice(0, Math.max(0, maxItemChars - 1))}…` : value);
        }
        if (items.length >= maxItems) break;
    }
    return items;
}

function extractParagraph(lines, { maxChars = 240 } = {}) {
    const text = lines.map((line) => String(line ?? "").trim()).filter(Boolean).join(" ");
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function matchSectionKey(heading) {
    const h = normalizeHeading(heading);
    if (!h) return null;
    if (/^(goal|goals|objective|objectives|目标|目标说明)$/.test(h)) return "goals";
    if (/^(requirements?|需求|需求说明)$/.test(h)) return "requirements";
    if (/^(scope|范围|scope & boundaries)$/.test(h)) return "scope";
    if (/^(acceptance criteria|acceptance|验收标准|验收)$/.test(h)) return "acceptanceCriteria";
    if (/^(constraints?|约束|限制)$/.test(h)) return "constraints";
    if (/^(tasks?|work items|workitems|suggested tasks|todo|milestones|任务|任务列表)$/.test(h)) return "suggestedTasks";
    return null;
}

function unique(values, maxItems = 24) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
        if (out.length >= maxItems) break;
    }
    return out;
}

function detectConflictingRequirements(requirements) {
    const positives = new Set();
    const negatives = new Set();
    for (const item of requirements) {
        const raw = String(item ?? "").trim().toLowerCase();
        if (!raw) continue;
        const normalized = raw.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
        const isNeg = /\b(not|never|no)\b/.test(normalized);
        const base = normalized
            .replace(/\b(not|never|no)\b/g, "")
            .replace(/\b(do|please|should|must|to)\b/g, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!base) continue;
        if (isNeg) negatives.add(base);
        else positives.add(base);
    }
    for (const base of positives) {
        if (negatives.has(base)) return true;
    }
    return false;
}

export function extractPlanningData(doc) {
    const content = String(doc?.content ?? "");
    const sections = parseMarkdownSections(content);
    const buckets = {
        goals: [],
        requirements: [],
        scope: [],
        acceptanceCriteria: [],
        constraints: [],
        suggestedTasks: [],
    };
    const keyHits = new Map();

    for (const section of sections) {
        const key = matchSectionKey(section.heading);
        if (!key) continue;
        keyHits.set(key, (keyHits.get(key) ?? 0) + 1);
        const listItems = extractListItems(section.lines, { maxItems: 28, maxItemChars: 240 });
        if (listItems.length > 0) {
            buckets[key].push(...listItems);
            continue;
        }
        const paragraph = extractParagraph(section.lines, { maxChars: 240 });
        if (paragraph) {
            buckets[key].push(paragraph);
        }
    }

    const titleFallback = String(doc?.metadata?.title ?? "").trim();
    if (buckets.goals.length === 0 && titleFallback) {
        buckets.goals.push(titleFallback);
    }

    const goals = unique(buckets.goals, 6);
    const requirements = unique(buckets.requirements, 24);
    const scope = unique(buckets.scope, 16);
    const acceptanceCriteria = unique(buckets.acceptanceCriteria, 16);
    const constraints = unique(buckets.constraints, 16);
    const suggestedTasks = unique(buckets.suggestedTasks, 12);

    return {
        goals,
        requirements,
        scope,
        acceptanceCriteria,
        constraints,
        suggestedTasks,
        analysis: {
            sectionHits: Object.fromEntries([...keyHits.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
            conflictingRequirements: detectConflictingRequirements(requirements),
        },
    };
}

export function buildPlanningSource(doc, planning) {
    const extracted = [];
    for (const key of ["goals", "requirements", "scope", "acceptanceCriteria", "constraints", "suggestedTasks"]) {
        const value = planning?.[key];
        if (Array.isArray(value) && value.length > 0) extracted.push(key);
    }
    return {
        type: "design-doc",
        path: String(doc?.path ?? "").trim() || "-",
        extractedSections: extracted,
    };
}
