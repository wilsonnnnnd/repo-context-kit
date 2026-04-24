import fs from "fs";
import path from "path";
import {
    CONTEXT_INDEX_DIR,
    CONTEXT_INDEX_FILES_PATH,
    CONTEXT_INDEX_SYMBOLS_PATH,
} from "../constants.js";
import {
    ensureDir,
    exists,
    readText,
    resolveFromProject,
    statSafe,
    writeText,
} from "../fs-utils.js";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const SKIPPED_DIRS = new Set([
    ".git",
    ".aidw",
    "node_modules",
    ".changeset",
    ".next",
    "dist",
    "build",
    "coverage",
]);

function toProjectPath(fullPath) {
    return path.relative(process.cwd(), fullPath).replaceAll(path.sep, "/");
}

function listFiles(dir = process.cwd(), results = []) {
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRS.has(entry.name)) {
                listFiles(path.join(dir, entry.name), results);
            }
            continue;
        }

        if (entry.isFile()) {
            results.push(toProjectPath(path.join(dir, entry.name)));
        }
    }

    return results;
}

function isConfigFile(filePath) {
    const basename = path.basename(filePath);

    return (
        basename === "package.json" ||
        basename.startsWith("tsconfig") ||
        basename.startsWith("vite.config") ||
        basename.startsWith("next.config") ||
        basename.startsWith("eslint.config") ||
        basename.startsWith("tailwind.config") ||
        basename.startsWith("jest.config") ||
        basename.startsWith("vitest.config") ||
        basename.startsWith("rollup.config") ||
        basename.startsWith("webpack.config") ||
        basename === ".eslintrc" ||
        basename === ".prettierrc"
    );
}

function classifyFile(filePath) {
    if (filePath.startsWith("bin/")) {
        return "entry";
    }

    if (isConfigFile(filePath)) {
        return "config";
    }

    if (filePath.startsWith("src/")) {
        return "source";
    }

    if (filePath.startsWith("test/") || filePath.startsWith("tests/")) {
        return "test";
    }

    return "other";
}

function describeFile(filePath, type) {
    if (filePath === "bin/cli.js") {
        return "CLI entry point that parses commands and flags.";
    }

    if (filePath === "bin/init.js") {
        return "Initializes the ai-dev-workflow project context.";
    }

    if (filePath === "bin/scan.js") {
        return "CLI wrapper for the project scan command.";
    }

    if (filePath === "package.json") {
        return "Package metadata, scripts, and CLI binary configuration.";
    }

    if (filePath.endsWith("context.js")) {
        return "Validates the .aidw project context structure.";
    }

    if (filePath.includes("/detectors/")) {
        return "Detects project signals used by scan output.";
    }

    if (filePath.includes("/writers/")) {
        return "Writes generated project context files.";
    }

    if (type === "test") {
        return "Automated test coverage for CLI behavior.";
    }

    if (type === "source") {
        return "Source module used by project scanning.";
    }

    if (type === "config") {
        return "Project configuration file.";
    }

    return "Project file relevant to repository structure.";
}

function getUpdatedAt(filePath) {
    const stat = statSafe(filePath);

    return (stat?.mtime ?? new Date(0)).toISOString();
}

function isImportantFile(filePath) {
    const type = classifyFile(filePath);
    const extension = path.extname(filePath);

    return (
        type !== "other" ||
        filePath === "README.md" ||
        filePath === "AGENTS.md" ||
        SOURCE_EXTENSIONS.has(extension)
    );
}

export function buildFileIndex() {
    return listFiles()
        .filter(isImportantFile)
        .sort()
        .map((filePath) => {
            const type = classifyFile(filePath);

            return {
                path: filePath,
                type,
                description: describeFile(filePath, type).slice(0, 120),
                updatedAt: getUpdatedAt(filePath),
            };
        });
}

function isComponentName(name) {
    return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function describeSymbol(symbol) {
    if (symbol.name === "validateContext") {
        return "Validates .aidw structure and meta.json version.";
    }

    if (symbol.name.startsWith("run")) {
        return "Runs a CLI command workflow.";
    }

    if (symbol.name.startsWith("detect")) {
        return "Detects project structure or package signals.";
    }

    if (symbol.name.startsWith("build")) {
        return "Builds structured scan data.";
    }

    if (symbol.type === "class") {
        return "Defines a reusable class.";
    }

    if (symbol.type === "component") {
        return "Defines a React component.";
    }

    return "Provides project scanning behavior.";
}

function addSymbol(symbols, filePath, fileUpdatedAt, match, type, exported) {
    const name = match?.groups?.name;

    if (!name || symbols.some((symbol) => symbol.name === name && symbol.file === filePath)) {
        return;
    }

    symbols.push({
        name,
        type: type === "function" && isComponentName(name) ? "component" : type,
        file: filePath,
        description: describeSymbol({ name, type }).slice(0, 120),
        exported,
        updatedAt: fileUpdatedAt,
    });
}

function extractSymbolsFromFile(filePath) {
    const fullPath = resolveFromProject(filePath);
    let content;

    try {
        content = fs.readFileSync(fullPath, "utf-8");
    } catch {
        return [];
    }

    const symbols = [];
    const updatedAt = getUpdatedAt(filePath);
    const patterns = [
        {
            regex: /^(?<exported>export\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\s*\(/gm,
            type: "function",
        },
        {
            regex: /^(?<exported>export\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)\b/gm,
            type: "class",
        },
        {
            regex: /^(?<exported>export\s+)?const\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm,
            type: "function",
        },
        {
            regex: /^(?<exported>export\s+)?const\s+(?<name>[A-Z][A-Za-z0-9]*)\s*=\s*(?:React\.)?(?:memo|forwardRef)\b/gm,
            type: "component",
        },
    ];

    for (const pattern of patterns) {
        for (const match of content.matchAll(pattern.regex)) {
            addSymbol(
                symbols,
                filePath,
                updatedAt,
                match,
                pattern.type,
                Boolean(match.groups?.exported),
            );
        }
    }

    return symbols;
}

export function buildSymbolIndex() {
    return listFiles()
        .filter((filePath) => {
            const extension = path.extname(filePath);

            return (
                SOURCE_EXTENSIONS.has(extension) &&
                (filePath.startsWith("src/") || filePath.startsWith("bin/"))
            );
        })
        .sort()
        .flatMap(extractSymbolsFromFile)
        .sort((a, b) => `${a.file}:${a.name}`.localeCompare(`${b.file}:${b.name}`));
}

function writeJsonIfChanged(relativePath, data) {
    const nextContent = `${JSON.stringify(data, null, 4)}\n`;
    const currentContent = exists(relativePath) ? readText(relativePath) : null;

    if (currentContent === nextContent) {
        return false;
    }

    writeText(relativePath, nextContent);
    return true;
}

export function updateProjectIndex() {
    ensureDir(CONTEXT_INDEX_DIR);

    return {
        filesChanged: writeJsonIfChanged(CONTEXT_INDEX_FILES_PATH, buildFileIndex()),
        symbolsChanged: writeJsonIfChanged(CONTEXT_INDEX_SYMBOLS_PATH, buildSymbolIndex()),
    };
}
