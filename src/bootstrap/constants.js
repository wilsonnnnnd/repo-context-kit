export const BOOTSTRAP_VERSION = "bootstrap/v1";

export const BOOTSTRAP_WRITE_MODES = ["create-only", "overwrite-managed"];

export const BOOTSTRAP_ALLOWED_PATH_PREFIXES = [
    ".aidw/",
    ".claude/",
    ".github/",
    ".trae/",
    "task/",
];

export const BOOTSTRAP_ALLOWED_FILES = new Set([
    "AGENTS.md",
    "PROJECT.md",
    "skill.md",
    "README.md",
    "task/task.md",
]);

export const BOOTSTRAP_ALLOWED_OPS = new Set([
    "mkdir",
    "writeFile",
    "copyTemplate",
    "snapshot",
]);

export const BOOTSTRAP_LIMITS = {
    maxOps: 240,
    maxFiles: 180,
    maxTotalBytes: 600 * 1024,
    maxContentPreviewBytes: 800,
};
