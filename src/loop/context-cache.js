import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = ".aidw";
const CACHE_FILE = "context-cache.md";
const CACHE_PROTOCOL = "context-cache/v1";

const INPUT_FILES = [
    "AGENTS.md",
    ".aidw/project.md",
    ".aidw/rules.md",
    ".aidw/task-entry.md",
    ".aidw/confirmation-protocol.md",
    ".aidw/workflow.md",
    ".aidw/safety.md",
    ".aidw/system-overview.md",
    ".aidw/index/summary.json",
    ".aidw/context-loop.jsonl",
];

function getCachePath(cwd = process.cwd()) {
    return path.resolve(cwd, CACHE_DIR, CACHE_FILE);
}

function getInputSnapshot(cwd = process.cwd()) {
    const snapshot = {};
    for (const rel of INPUT_FILES) {
        const full = path.resolve(cwd, rel);
        try {
            const stat = fs.statSync(full);
            snapshot[rel] = stat.mtimeMs;
        } catch {
            snapshot[rel] = 0;
        }
    }
    return snapshot;
}

function parseHeader(raw) {
    const firstLine = raw.split("\n")[0] ?? "";
    const match = firstLine.match(/^<!--\s*context-cache:\s*(\{.*\})\s*-->$/u);
    if (!match) {
        return null;
    }
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

function isSnapshotFresh(saved, current) {
    if (!saved || typeof saved !== "object") {
        return false;
    }
    for (const rel of INPUT_FILES) {
        if (Number(saved[rel] ?? 0) !== Number(current[rel] ?? 0)) {
            return false;
        }
    }
    return true;
}

export function getCachedBriefDigest(cwd = process.cwd()) {
    const cachePath = getCachePath(cwd);
    if (!fs.existsSync(cachePath)) {
        return null;
    }
    let raw;
    try {
        raw = fs.readFileSync(cachePath, "utf-8");
    } catch {
        return null;
    }
    const header = parseHeader(raw);
    if (!header || header.protocol !== CACHE_PROTOCOL) {
        return null;
    }
    const currentSnapshot = getInputSnapshot(cwd);
    if (!isSnapshotFresh(header.inputs, currentSnapshot)) {
        return null;
    }
    return raw.trimEnd() + "\n";
}

export function writeBriefDigestCache(content, cwd = process.cwd()) {
    const dir = path.resolve(cwd, CACHE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const cachePath = getCachePath(cwd);
    const header = {
        protocol: CACHE_PROTOCOL,
        generatedAt: new Date().toISOString(),
        inputs: getInputSnapshot(cwd),
    };
    const body = String(content ?? "").trimEnd();
    const output = `<!-- context-cache: ${JSON.stringify(header)} -->\n${body}\n`;
    fs.writeFileSync(cachePath, output, "utf-8");
    return cachePath;
}

