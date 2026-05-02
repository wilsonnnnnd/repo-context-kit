import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main as runCliMain } from "../bin/cli.js";
import { runInit } from "../bin/init.js";
import { runScan } from "../bin/scan.js";
import { runTask } from "../bin/task.js";
import { PROJECT_TYPES } from "../src/scan/constants.js";
import { detectProjectType } from "../src/scan/detectors/project-type.js";
import { parseTaskRegistry } from "../src/scan/task-registry.js";

const originalCwd = process.cwd();

function writeFile(relativePath, content = "") {
    const fullPath = path.resolve(process.cwd(), relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
}

function writeContextProject(content) {
    writeFile(".aidw/project.md", content);
    writeFile(".aidw/meta.json", JSON.stringify({ version: 1 }, null, 4) + "\n");
    writeFile(
        ".aidw/scan/last.json",
        JSON.stringify({ status: "not-run" }, null, 4) + "\n",
    );
}

async function assertIncompleteScan(options = {}) {
    process.exitCode = 0;

    const { output, result } = await withCapturedConsole(() => runScan(options));

    assert.equal(process.exitCode, 1);
    assert.equal(result.incomplete, true);
    assert.equal(
        output.join("\n"),
        "\u2716 Project context is incomplete\nRun: repo-context-kit scan --auto",
    );

    process.exitCode = 0;
}

async function withTempProject(callback) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-context-kit-"));

    try {
        process.chdir(tempDir);
        return await callback(tempDir);
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function withMutedConsole(callback) {
    const log = console.log;

    try {
        console.log = () => {};
        return await callback();
    } finally {
        console.log = log;
    }
}

async function withCapturedConsole(callback) {
    const log = console.log;
    const output = [];

    try {
        console.log = (...args) => {
            output.push(args.join(" "));
        };
        const result = await callback();

        return {
            output,
            result,
        };
    } finally {
        console.log = log;
    }
}

test("CLI behavior", async (t) => {
    await t.test("detects Next.js projects", async () => {
        await withTempProject(() => {
            writeFile("package.json", JSON.stringify({ name: "next-app" }));
            writeFile("next.config.mjs", "export default {};\n");

            assert.equal(detectProjectType(), PROJECT_TYPES.WEB_APP);
        });
    });

    await t.test("detects Node CLI projects", async () => {
        await withTempProject(() => {
            writeFile(
                "package.json",
                JSON.stringify({
                    name: "cli-app",
                    bin: {
                        "cli-app": "bin/cli.js",
                    },
                }),
            );
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            assert.equal(detectProjectType(), PROJECT_TYPES.CLI_TOOL);
        });
    });

    await t.test("does not classify weak backend signals alone as backend", async () => {
        await withTempProject(() => {
            writeFile("package.json", JSON.stringify({ name: "weak-signals" }));
            fs.mkdirSync("services", { recursive: true });
            fs.mkdirSync("config", { recursive: true });

            assert.equal(detectProjectType(), PROJECT_TYPES.GENERIC);
        });
    });

    await t.test("detects Python projects from requirements.txt", async () => {
        await withTempProject(() => {
            writeFile("requirements.txt", "pytest==8.0.0\n");

            assert.equal(detectProjectType(), PROJECT_TYPES.BACKEND_APP);
        });
    });

    await t.test("detects FastAPI projects from dependency or source signals", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("requirements.txt", "fastapi==0.110.0\nuvicorn==0.27.0\n");
            writeFile("app/main.py", "from fastapi import FastAPI\n\napp = FastAPI()\n");

            const result = await withMutedConsole(() => runScan());
            const projectContext = fs.readFileSync(".aidw/project.md", "utf-8");

            assert.equal(result.project.type, PROJECT_TYPES.BACKEND_APP);
            assert.deepEqual(result.project.entryPoints, ["app/main.py"]);
            assert.match(projectContext, /Python FastAPI backend web project/);
            assert.match(projectContext, /- FastAPI/);
        });

        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("requirements.txt", "pytest==8.0.0\n");
            writeFile("src/main.py", "from fastapi import FastAPI\n\napp = FastAPI()\n");

            const result = await withMutedConsole(() => runScan());

            assert.equal(result.project.type, PROJECT_TYPES.BACKEND_APP);
            assert.deepEqual(result.project.entryPoints, ["src/main.py"]);
        });
    });

    await t.test("scan detects FastAPI entrypoints, reusable areas, and risk areas", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("requirements.txt", "fastapi==0.110.0\nuvicorn==0.27.0\n");
            writeFile("app/main.py", "from fastapi import FastAPI\n\napp = FastAPI()\n");
            writeFile("app/routers/users.py", "from fastapi import APIRouter\n");
            writeFile("app/services/user_service.py", "def list_users():\n    return []\n");
            writeFile("app/schemas/user.py", "class UserSchema:\n    pass\n");
            writeFile("app/db/session.py", "DATABASE_URL = 'sqlite:///app.db'\n");
            writeFile("app/auth/jwt.py", "JWT_ALGORITHM = 'HS256'\n");
            writeFile("app/ai/prompts.py", "SYSTEM_PROMPT = 'help'\n");
            writeFile("app/core/settings.py", "API_KEY = ''\n");
            writeFile("tests/test_main.py", "def test_main():\n    assert True\n");

            await withMutedConsole(() => runScan());

            const projectContext = fs.readFileSync(".aidw/project.md", "utf-8");
            const entrypointIndex = JSON.parse(
                fs.readFileSync(".aidw/index/entrypoints.json", "utf-8"),
            );
            const fileGroups = JSON.parse(
                fs.readFileSync(".aidw/index/file-groups.json", "utf-8"),
            );

            assert.ok(
                entrypointIndex.some(
                    (entrypoint) =>
                        entrypoint.path === "app/main.py" &&
                        entrypoint.name === "FastAPI app" &&
                        entrypoint.source === "heuristic",
                ),
            );
            assert.match(projectContext, /app\/routers\/ contains FastAPI route modules/);
            assert.match(projectContext, /app\/services\/ contains reusable business logic/);
            assert.match(projectContext, /app\/schemas\/ contains request, response/);
            assert.match(projectContext, /tests\/ contains Python automated tests/);
            assert.match(projectContext, /auth, JWT, and OAuth code/);
            assert.match(projectContext, /database, migration, and Alembic changes/);
            assert.match(projectContext, /AI\/LLM prompts and client code/);
            assert.match(projectContext, /environment, config, and settings files/);
            assert.ok(fileGroups.some((group) => group.path === "app/routers"));
            assert.ok(fileGroups.some((group) => group.path === "app/services"));
            assert.ok(fileGroups.some((group) => group.path === "app/schemas"));
            assert.ok(fileGroups.some((group) => group.path === "tests"));
        });
    });

    await t.test("init does not overwrite existing files", async () => {
        await withTempProject(async () => {
            writeFile("AGENTS.md", "custom instructions\n");

            const results = await withMutedConsole(() => runInit());

            assert.equal(
                fs.readFileSync("AGENTS.md", "utf-8"),
                "custom instructions\n",
            );
            assert.ok(results.skipped.includes("AGENTS.md"));
            assert.ok(results.created.includes(".aidw/project.md"));
        });
    });

    await t.test("init without force skips existing context files", async () => {
        await withTempProject(async () => {
            writeFile(".aidw/project.md", "custom project context\n");

            const results = await withMutedConsole(() => runInit());

            assert.equal(
                fs.readFileSync(".aidw/project.md", "utf-8"),
                "custom project context\n",
            );
            assert.ok(results.skipped.includes(".aidw/project.md"));
        });
    });

    await t.test("init creates hidden context directory and prints project context", async () => {
        await withTempProject(async () => {
            const { output, result } = await withCapturedConsole(() => runInit());

            assert.ok(fs.existsSync(".aidw"));
            assert.ok(fs.existsSync(".aidw/project.md"));
            assert.ok(fs.existsSync(".aidw/workflow.md"));
            assert.ok(fs.existsSync(".aidw/safety.md"));
            assert.ok(fs.existsSync("task/task.md"));
            assert.ok(fs.existsSync(".trae/rules/project_rules.md"));
            assert.equal(fs.existsSync("ai"), false);
            assert.ok(result.created.includes(".aidw/project.md"));
            assert.equal(
                output.join("\n"),
                "\u2714 Init completed\nCreated:\n* .aidw/\n  (repo-context-kit project context)\n\nNext:\n* Run repo-context-kit scan",
            );
        });
    });

    await t.test("init force overwrites managed context files", async () => {
        await withTempProject(async () => {
            writeFile(".aidw/project.md", "custom project context\n");
            writeFile(".aidw/meta.json", "{\"custom\":true}\n");
            writeFile(".aidw/scan/last.json", "{\"custom\":true}\n");

            const { output, result } = await withCapturedConsole(() =>
                runInit({ force: true }),
            );

            assert.notEqual(
                fs.readFileSync(".aidw/project.md", "utf-8"),
                "custom project context\n",
            );
            assert.deepEqual(
                JSON.parse(fs.readFileSync(".aidw/meta.json", "utf-8")),
                {
                    version: 1,
                },
            );
            assert.deepEqual(
                JSON.parse(fs.readFileSync(".aidw/scan/last.json", "utf-8")),
                {
                    status: "not-run",
                },
            );
            assert.ok(result.updated.includes(".aidw/project.md"));
            assert.ok(result.updated.includes(".aidw/meta.json"));
            assert.ok(result.updated.includes(".aidw/scan/last.json"));
            assert.match(output.join("\n"), /Updated:/);
            assert.match(output.join("\n"), /\* \.aidw\/project\.md/);
            assert.match(output.join("\n"), /\* \.aidw\/meta\.json/);
            assert.match(output.join("\n"), /\* \.aidw\/scan\/last\.json/);
        });
    });

    await t.test("init force preserves unknown context files", async () => {
        await withTempProject(async () => {
            writeFile(".aidw/custom-note.md", "keep me\n");

            await withMutedConsole(() => runInit({ force: true }));

            assert.equal(
                fs.readFileSync(".aidw/custom-note.md", "utf-8"),
                "keep me\n",
            );
        });
    });

    await t.test("scan reports not initialized when context directory is missing", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;

            const { output, result } = await withCapturedConsole(() => runScan());

            assert.equal(process.exitCode, 1);
            assert.equal(result.initialized, false);
            assert.equal(
                output.join("\n"),
                "\u2716 Project not initialized\nMissing: .aidw/\nRun: repo-context-kit init",
            );

            process.exitCode = 0;
        });
    });

    await t.test("empty context directory is incomplete", async () => {
        await withTempProject(async () => {
            fs.mkdirSync(".aidw", { recursive: true });

            await assertIncompleteScan();
        });
    });

    await t.test("deleted project context file is incomplete", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            fs.unlinkSync(".aidw/project.md");

            await assertIncompleteScan();
        });
    });

    await t.test("invalid meta json is incomplete", async () => {
        await withTempProject(async () => {
            writeContextProject("# Project Context\n");
            writeFile(".aidw/meta.json", "{not-json}\n");

            await assertIncompleteScan({ mode: "check" });
        });
    });

    await t.test("missing meta version is incomplete", async () => {
        await withTempProject(async () => {
            writeContextProject("# Project Context\n");
            writeFile(".aidw/meta.json", "{}\n");

            await assertIncompleteScan({ mode: "auto" });
        });
    });

    await t.test("missing scan last file is incomplete", async () => {
        await withTempProject(async () => {
            writeContextProject("# Project Context\n");
            fs.unlinkSync(".aidw/scan/last.json");

            await assertIncompleteScan();
        });
    });

    await t.test("incomplete context is reported for every scan mode", async () => {
        for (const mode of ["normal", "check", "auto"]) {
            await withTempProject(async () => {
                fs.mkdirSync(".aidw", { recursive: true });

                await assertIncompleteScan({ mode });
            });
        }
    });

    await t.test("scan updates generated section and preserves manual content", async () => {
        await withTempProject(async () => {
            writeContextProject(
                `# Project Context

<!-- AUTO-GENERATED:START -->
old generated content
<!-- AUTO-GENERATED:END -->

## Manual Notes

- keep this note
`,
            );
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            const result = await withMutedConsole(() => runScan());
            const updated = fs.readFileSync(".aidw/project.md", "utf-8");

            assert.equal(result.changed, true);
            assert.ok(result.updatedFiles.includes(".aidw/project.md"));
            assert.equal(result.project.type, PROJECT_TYPES.CLI_TOOL);
            assert.deepEqual(result.project.entryPoints, ["bin/cli.js"]);
            assert.match(updated, /## AI Development Notes/);
            assert.doesNotMatch(updated, /old generated content/);
            assert.match(updated, /- keep this note/);
        });
    });

    await t.test("scan check reports stale content without writing", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            writeContextProject(
                `# Project Context

<!-- AUTO-GENERATED START -->
old generated content
<!-- AUTO-GENERATED END -->

## Manual Notes

- keep this note
`,
            );
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            const before = fs.readFileSync(".aidw/project.md", "utf-8");
            const result = await withMutedConsole(() => runScan({ mode: "check" }));
            const after = fs.readFileSync(".aidw/project.md", "utf-8");

            assert.equal(after, before);
            assert.equal(result.changed, true);
            assert.deepEqual(result.updatedFiles, []);
            assert.equal(process.exitCode, 1);
            process.exitCode = 0;
        });
    });

    await t.test("scan check reports missing markers", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            writeContextProject("# Project Context\n\nmanual only\n");
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            const { output, result } = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(result.changed, true);
            assert.equal(process.exitCode, 1);
            assert.match(output.join("\n"), /Project context cannot be checked/);
            assert.match(
                output.join("\n"),
                /Reason:\n\* AUTO-GENERATED markers not found in \.aidw\/project\.md/,
            );
            process.exitCode = 0;
        });
    });

    await t.test("scan auto updates changed generated content", async () => {
        await withTempProject(async () => {
            writeContextProject(
                `# Project Context

<!-- AUTO-GENERATED START -->
old generated content
<!-- AUTO-GENERATED END -->

## Manual Notes

- keep this note
`,
            );
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            const update = await withMutedConsole(() => runScan({ mode: "auto" }));
            const updated = fs.readFileSync(".aidw/project.md", "utf-8");

            assert.equal(update.changed, true);
            assert.match(updated, /## AI Development Notes/);
            assert.match(updated, /- keep this note/);
        });
    });

    await t.test("default scan prints structured output", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            const { output, result } = await withCapturedConsole(() => runScan());

            assert.equal(result.changed, true);
            assert.ok(result.updatedFiles.includes(".aidw/project.md"));
            assert.match(output.join("\n"), /Project scan completed/);
            assert.match(output.join("\n"), /Changes:\n\* Updated \.aidw\/project\.md/);
            assert.match(output.join("\n"), /Summary:\n\* Project type: cli-tool/);
            assert.match(output.join("\n"), /\* Entry points: bin\/cli\.js/);
        });
    });

    await t.test("scan creates project index files", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile(
                "package.json",
                JSON.stringify({
                    name: "scan-target",
                    bin: {
                        "scan-target": "bin/cli.js",
                    },
                }),
            );
            writeFile("bin/cli.js", "#!/usr/bin/env node\nexport function main() {}\n");
            writeFile(
                "src/scan/context.js",
                "export function validateContext() { return { ok: true }; }\n",
            );

            const result = await withMutedConsole(() => runScan());
            const fileIndex = JSON.parse(
                fs.readFileSync(".aidw/index/files.json", "utf-8"),
            );
            const symbolIndex = JSON.parse(
                fs.readFileSync(".aidw/index/symbols.json", "utf-8"),
            );
            const entrypointIndex = JSON.parse(
                fs.readFileSync(".aidw/index/entrypoints.json", "utf-8"),
            );
            const fileGroups = JSON.parse(
                fs.readFileSync(".aidw/index/file-groups.json", "utf-8"),
            );
            const summary = JSON.parse(
                fs.readFileSync(".aidw/index/summary.json", "utf-8"),
            );
            const taskMap = JSON.parse(
                fs.readFileSync(".aidw/context/tasks.json", "utf-8"),
            );

            assert.equal(result.changed, true);
            assert.ok(fs.existsSync(".aidw/AI.md"));
            assert.ok(fs.existsSync(".aidw/index/files.json"));
            assert.ok(fs.existsSync(".aidw/index/symbols.json"));
            assert.ok(fs.existsSync(".aidw/index/file-groups.json"));
            assert.ok(fs.existsSync(".aidw/index/summary.json"));
            assert.ok(fs.existsSync(".aidw/index/entrypoints.json"));
            assert.ok(fs.existsSync(".aidw/context/tasks.json"));
            assert.ok(
                fileIndex.some(
                    (entry) =>
                        entry.path === "bin/cli.js" &&
                        typeof entry.confidence === "number" &&
                        entry.source === "heuristic",
                ),
            );
            assert.ok(
                symbolIndex.some(
                    (symbol) =>
                        symbol.name === "validateContext" &&
                        symbol.file === "src/scan/context.js" &&
                        symbol.exported === true &&
                        typeof symbol.confidence === "number" &&
                        symbol.source === "regex",
                ),
            );
            assert.ok(
                entrypointIndex.some(
                    (entrypoint) =>
                        entrypoint.path === "bin/cli.js" &&
                        entrypoint.command === "scan-target" &&
                        entrypoint.source === "package.json",
                ),
            );
            assert.ok(
                taskMap.every((task) =>
                    task.files.every((filePath) => fs.existsSync(filePath)),
                ),
            );
            assert.ok(
                fileGroups.some(
                    (group) =>
                        group.path === "src/scan" &&
                        group.keyFiles.every((filePath) => fs.existsSync(filePath)),
                ),
            );
            assert.equal(typeof summary.generatedAt, "string");
            assert.equal(summary.totalFilesScanned >= summary.indexedFiles, true);
            assert.equal(summary.indexedFiles, fileIndex.length);
            assert.equal(summary.indexedSymbols, symbolIndex.length);
            assert.equal(summary.fileGroups, fileGroups.length);
            assert.doesNotMatch(JSON.stringify(fileIndex), /ai\//);
            assert.doesNotMatch(JSON.stringify(symbolIndex), /ai\//);
        });
    });

    await t.test("init AGENTS references workflow, safety, overview, and current task", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());

            const agents = fs.readFileSync("AGENTS.md", "utf-8");

            assert.match(agents, /\.aidw\/workflow\.md/);
            assert.match(agents, /\.aidw\/safety\.md/);
            assert.match(agents, /\.aidw\/system-overview\.md/);
            assert.match(agents, /current task file/);
        });
    });

    await t.test("task new creates first task file with npm test command", async () => {
        await withTempProject(async () => {
            writeFile("package.json", JSON.stringify({ name: "task-target" }));

            const { output, result } = await withCapturedConsole(() =>
                runTask(["new", "Add receipt evidence API"]),
            );
            const taskContent = fs.readFileSync(result.created, "utf-8");

            assert.equal(result.created, "task/T-001-add-receipt-evidence-api.md");
            assert.match(output.join("\n"), /Task created/);
            assert.ok(fs.existsSync("task/task.md"));
            assert.match(taskContent, /# T-001 Add Receipt Evidence API/);
            assert.match(taskContent, /## Acceptance Criteria/);
            assert.match(taskContent, /## Test Command/);
            assert.match(taskContent, /npm test/);
            assert.match(taskContent, /## Definition of Done/);
            assert.match(
                fs.readFileSync("task/task.md", "utf-8"),
                /\| T-001 \| Add Receipt Evidence API \| todo \| medium \| - \| - \| \[T-001\]\(\.\/T-001-add-receipt-evidence-api\.md\) \|/,
            );
        });
    });

    await t.test("task new increments numbering and uses default title", async () => {
        await withTempProject(async () => {
            const first = await withMutedConsole(() => runTask(["new"]));
            const second = await withMutedConsole(() => runTask(["new", "Second task"]));

            assert.equal(first.created, "task/T-001-new-task.md");
            assert.equal(second.created, "task/T-002-second-task.md");
            assert.ok(fs.existsSync(first.created));
            assert.ok(fs.existsSync(second.created));
            assert.match(
                fs.readFileSync("task/task.md", "utf-8"),
                /\| T-002 \| Second Task \| todo \| medium \| - \| - \| \[T-002\]\(\.\/T-002-second-task\.md\) \|/,
            );
        });
    });

    await t.test("task new increments from existing registry entries", async () => {
        await withTempProject(async () => {
            writeFile(
                "task/task.md",
                `# Task Registry

## Tasks

| ID | Title | Status | Priority | Owner | Dependencies | File |
|----|------|--------|----------|-------|--------------|------|
| T-009 | Existing | todo | medium | - | - | [T-009](./T-009-existing.md) |
`,
            );

            const result = await withMutedConsole(() =>
                runTask(["new", "Next task"]),
            );

            assert.equal(result.created, "task/T-010-next-task.md");
        });
    });

    await t.test("task registry parser extracts table fields", async () => {
        await withTempProject(() => {
            writeFile(
                "task/task.md",
                `# Task Registry

## Tasks

| ID | Title | Status | Priority | Owner | Dependencies | File |
|----|------|--------|----------|-------|--------------|------|
| T-001 | Add receipt API | in_progress | high | Wilson | T-000 | [T-001](./T-001-add-receipt-api.md) |
`,
            );

            const registry = parseTaskRegistry();

            assert.equal(registry.exists, true);
            assert.deepEqual(registry.tasks, [
                {
                    id: "T-001",
                    title: "Add receipt API",
                    status: "in_progress",
                    priority: "high",
                    owner: "Wilson",
                    dependencies: "T-000",
                    file: "task/T-001-add-receipt-api.md",
                },
            ]);
        });
    });

    await t.test("task new defaults to pytest for Python-only project", async () => {
        await withTempProject(async () => {
            writeFile("requirements.txt", "pytest==8.0.0\n");

            const result = await withMutedConsole(() =>
                runTask(["new", "Add Python thing"]),
            );
            const taskContent = fs.readFileSync(result.created, "utf-8");

            assert.match(taskContent, /```bash\npytest\n```/);
        });
    });

    await t.test("CLI help includes task new command", async () => {
        const { output } = await withCapturedConsole(() => runCliMain(["--help"]));

        assert.match(output.join("\n"), /task new \[title\]/);
    });

    await t.test("scan creates AI system overview with sources and indexes", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");
            writeFile("task/01-feature.md", "# Feature task\n");
            writeFile("task/02-fix.md", "# Fix task\n");

            const { output, result } = await withCapturedConsole(() => runScan());
            const overview = fs.readFileSync(".aidw/system-overview.md", "utf-8");

            assert.ok(fs.existsSync(".aidw/system-overview.md"));
            assert.ok(result.updatedFiles.includes(".aidw/system-overview.md"));
            assert.match(
                output.join("\n"),
                /\* Updated \.aidw\/system-overview\.md/,
            );
            assert.match(overview, /# AI System Overview/);
            assert.match(overview, /## Context Sources/);
            assert.match(overview, /`\.aidw\/project\.md` - status: present/);
            assert.match(overview, /`\.aidw\/index\/summary\.json` - status: present/);
            assert.match(overview, /## Rule Sources/);
            assert.match(overview, /`AGENTS\.md` - status: present/);
            assert.match(overview, /`\.aidw\/rules\.md` - status: present/);
            assert.match(overview, /`\.aidw\/workflow\.md` - status: present/);
            assert.match(overview, /`\.aidw\/safety\.md` - status: present/);
            assert.match(overview, /## Task Health/);
            assert.match(overview, /Task count: 2/);
            assert.match(overview, /Tasks with acceptance criteria: 0/);
            assert.match(overview, /## Task Registry/);
            assert.match(overview, /Registry file: task\/task\.md \(present\)/);
            assert.match(overview, /Total tasks: 0/);
            assert.match(overview, /todo: 0/);
            assert.match(overview, /tasks with acceptance criteria: 0 \/ 2/);
            assert.match(overview, /## Generated Indexes/);
            assert.match(overview, /`\.aidw\/index\/entrypoints\.json` - status: present/);
            assert.match(overview, /## AI Tool Adapters/);
            assert.match(overview, /`\.github\/copilot-instructions\.md` - status: present/);
            assert.match(overview, /`\.trae\/rules\/project_rules\.md` - status: present/);
            assert.match(overview, /Markdown task files \(2 detected\)/);
            assert.match(overview, /`task\/01-feature\.md`/);
            assert.match(overview, /`task\/02-fix\.md`/);
        });
    });

    await t.test("scan writes task file metadata into task index", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile(
                "task/T-001-add-receipt-evidence-api.md",
                `# T-001 Add Receipt Evidence API

## Acceptance Criteria

- Works

## Test Command

\`\`\`bash
npm test
\`\`\`

## Definition of Done

- Done
`,
            );

            await withMutedConsole(() => runScan());

            const taskMap = JSON.parse(
                fs.readFileSync(".aidw/context/tasks.json", "utf-8"),
            );
            const task = taskMap.find(
                (entry) => entry.path === "task/T-001-add-receipt-evidence-api.md",
            );

            assert.equal(task.id, "T-001");
            assert.equal(task.title, "Add Receipt Evidence API");
            assert.deepEqual(task.files, ["task/T-001-add-receipt-evidence-api.md"]);
            assert.equal(task.hasAcceptanceCriteria, true);
            assert.equal(task.hasTestCommand, true);
            assert.equal(task.hasDefinitionOfDone, true);
            assert.equal(task.source, "task-file");
        });
    });

    await t.test("scan merges task registry fields with task file metadata", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile(
                "task/task.md",
                `# Task Registry

## Tasks

| ID | Title | Status | Priority | Owner | Dependencies | File |
|----|------|--------|----------|-------|--------------|------|
| T-001 | Add Receipt API | in_progress | high | Wilson | T-000 | [T-001](./T-001-add-receipt-api.md) |
`,
            );
            writeFile(
                "task/T-001-add-receipt-api.md",
                `# T-001 Add Receipt API

## Acceptance Criteria

- Works

## Test Command

\`\`\`bash
npm test
\`\`\`

## Definition of Done

- Done
`,
            );

            await withMutedConsole(() => runScan());

            const taskMap = JSON.parse(
                fs.readFileSync(".aidw/context/tasks.json", "utf-8"),
            );
            const task = taskMap.find((entry) => entry.id === "T-001");

            assert.equal(task.title, "Add Receipt API");
            assert.equal(task.status, "in_progress");
            assert.equal(task.priority, "high");
            assert.equal(task.owner, "Wilson");
            assert.equal(task.dependencies, "T-000");
            assert.equal(task.file, "task/T-001-add-receipt-api.md");
            assert.equal(task.hasAcceptanceCriteria, true);
            assert.equal(task.hasTestCommand, true);
            assert.equal(task.hasDefinitionOfDone, true);
        });
    });

    await t.test("system overview marks optional files as missing", async () => {
        await withTempProject(async () => {
            writeContextProject(`# Project Context

<!-- AUTO-GENERATED START -->
seed
<!-- AUTO-GENERATED END -->
`);
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));

            await withMutedConsole(() => runScan());

            const overview = fs.readFileSync(".aidw/system-overview.md", "utf-8");

            assert.match(overview, /`AGENTS\.md` - status: missing/);
            assert.match(overview, /`\.aidw\/workflow\.md` - status: missing/);
            assert.match(overview, /`\.aidw\/safety\.md` - status: missing/);
            assert.match(overview, /`\.github\/copilot-instructions\.md` - status: missing/);
            assert.match(overview, /`\.trae\/rules\/project_rules\.md` - status: missing/);
            assert.match(overview, /`skill\.md` - status: missing/);
            assert.match(overview, /`\.aidw\/task-entry\.md` - status: missing/);
            assert.match(overview, /`task\/\*\.md` - status: missing/);
        });
    });

    await t.test("system overview lists up to ten task markdown files", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));

            for (let index = 1; index <= 11; index += 1) {
                writeFile(
                    `task/${String(index).padStart(2, "0")}-task.md`,
                    `# Task ${index}\n`,
                );
            }

            await withMutedConsole(() => runScan());

            const overview = fs.readFileSync(".aidw/system-overview.md", "utf-8");

            assert.match(overview, /Markdown task files \(11 detected\)/);
            assert.match(overview, /`task\/01-task\.md`/);
            assert.match(overview, /`task\/10-task\.md`/);
            assert.doesNotMatch(overview, /`task\/11-task\.md`/);
        });
    });

    await t.test("scan check fails when system overview is missing or outdated", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));

            await withMutedConsole(() => runScan());
            fs.unlinkSync(".aidw/system-overview.md");

            const missing = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(process.exitCode, 1);
            assert.equal(missing.result.changed, true);
            assert.match(
                missing.output.join("\n"),
                /\.aidw\/system-overview\.md is missing or out of date/,
            );

            process.exitCode = 0;
            await withMutedConsole(() => runScan());
            writeFile(".aidw/system-overview.md", "stale\n");

            const stale = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(process.exitCode, 1);
            assert.equal(stale.result.changed, true);
            assert.match(
                stale.output.join("\n"),
                /\.aidw\/system-overview\.md is missing or out of date/,
            );
            process.exitCode = 0;
        });
    });

    await t.test("scan check fails when task metadata is stale", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));

            await withMutedConsole(() => runScan());
            writeFile(
                "task/T-001-new-task.md",
                `# T-001 New Task

## Acceptance Criteria

- Works

## Test Command

\`\`\`bash
npm test
\`\`\`

## Definition of Done

- Done
`,
            );

            const { output, result } = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(process.exitCode, 1);
            assert.equal(result.changed, true);
            assert.match(
                output.join("\n"),
                /\.aidw\/context\/tasks\.json is missing or out of date/,
            );
            process.exitCode = 0;
        });
    });

    await t.test("scan warns on task registry mismatch", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile(
                "task/T-001-unregistered.md",
                `# T-001 Unregistered

## Acceptance Criteria

- Works
`,
            );

            const { output, result } = await withCapturedConsole(() => runScan());

            assert.equal(process.exitCode ?? 0, 0);
            assert.ok(
                result.warnings.some((warning) =>
                    warning.includes("task/T-001-unregistered.md exists but is not listed"),
                ),
            );
            assert.match(output.join("\n"), /Warnings:/);
            assert.match(output.join("\n"), /task\/T-001-unregistered\.md exists but is not listed/);
        });
    });

    await t.test("scan check fails on task registry mismatch", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile(
                "task/T-001-unregistered.md",
                `# T-001 Unregistered

## Acceptance Criteria

- Works
`,
            );

            const { output, result } = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(process.exitCode, 1);
            assert.equal(result.changed, true);
            assert.match(output.join("\n"), /task registry and task files are inconsistent/);
            assert.match(output.join("\n"), /task\/T-001-unregistered\.md exists but is not listed/);
            process.exitCode = 0;
        });
    });

    await t.test("scan check fails when task registry is missing but task files exist", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            writeContextProject(`# Project Context

<!-- AUTO-GENERATED START -->
seed
<!-- AUTO-GENERATED END -->
`);
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile(
                "task/T-001-missing-registry.md",
                `# T-001 Missing Registry

## Acceptance Criteria

- Works
`,
            );

            const { output, result } = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(process.exitCode, 1);
            assert.equal(result.changed, true);
            assert.match(output.join("\n"), /task\/task\.md is missing but task files exist/);
            process.exitCode = 0;
        });
    });

    await t.test("scan does not rewrite unchanged index files", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\nexport function main() {}\n");

            await withMutedConsole(() => runScan());
            const filesBefore = fs.readFileSync(".aidw/index/files.json", "utf-8");
            const symbolsBefore = fs.readFileSync(".aidw/index/symbols.json", "utf-8");
            const entrypointsBefore = fs.readFileSync(
                ".aidw/index/entrypoints.json",
                "utf-8",
            );
            const fileGroupsBefore = fs.readFileSync(
                ".aidw/index/file-groups.json",
                "utf-8",
            );
            const summaryBefore = fs.readFileSync(".aidw/index/summary.json", "utf-8");
            const systemOverviewBefore = fs.readFileSync(
                ".aidw/system-overview.md",
                "utf-8",
            );
            const tasksBefore = fs.readFileSync(".aidw/context/tasks.json", "utf-8");

            await withMutedConsole(() => runScan());

            assert.equal(
                fs.readFileSync(".aidw/index/files.json", "utf-8"),
                filesBefore,
            );
            assert.equal(
                fs.readFileSync(".aidw/index/symbols.json", "utf-8"),
                symbolsBefore,
            );
            assert.equal(
                fs.readFileSync(".aidw/index/entrypoints.json", "utf-8"),
                entrypointsBefore,
            );
            assert.equal(
                fs.readFileSync(".aidw/index/file-groups.json", "utf-8"),
                fileGroupsBefore,
            );
            assert.equal(
                fs.readFileSync(".aidw/index/summary.json", "utf-8"),
                summaryBefore,
            );
            assert.equal(
                fs.readFileSync(".aidw/system-overview.md", "utf-8"),
                systemOverviewBefore,
            );
            assert.equal(fs.readFileSync(".aidw/context/tasks.json", "utf-8"), tasksBefore);
        });
    });

    await t.test("scan removes stale index records for deleted source files", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile(
                "package.json",
                JSON.stringify({
                    name: "scan-target",
                    bin: {
                        "scan-target": "bin/cli.js",
                    },
                }),
            );
            writeFile("bin/cli.js", "#!/usr/bin/env node\nexport function main() {}\n");
            writeFile(
                "src/scan/context.js",
                "export function validateContext() { return { ok: true }; }\n",
            );

            await withMutedConsole(() => runScan());
            fs.unlinkSync("src/scan/context.js");
            await withMutedConsole(() => runScan());

            const fileIndex = JSON.parse(
                fs.readFileSync(".aidw/index/files.json", "utf-8"),
            );
            const symbolIndex = JSON.parse(
                fs.readFileSync(".aidw/index/symbols.json", "utf-8"),
            );
            const taskMap = JSON.parse(
                fs.readFileSync(".aidw/context/tasks.json", "utf-8"),
            );
            const fileGroups = JSON.parse(
                fs.readFileSync(".aidw/index/file-groups.json", "utf-8"),
            );

            assert.equal(
                fileIndex.some((entry) => entry.path === "src/scan/context.js"),
                false,
            );
            assert.equal(
                symbolIndex.some((symbol) => symbol.file === "src/scan/context.js"),
                false,
            );
            assert.equal(
                taskMap.some((task) => task.files.includes("src/scan/context.js")),
                false,
            );
            assert.equal(
                fileGroups.some((group) =>
                    group.keyFiles.includes("src/scan/context.js"),
                ),
                false,
            );
            assert.equal(process.exitCode ?? 0, 0);
        });
    });

    await t.test("scan removes stale entrypoints for deleted files", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile(
                "package.json",
                JSON.stringify({
                    name: "scan-target",
                    bin: {
                        "scan-target": "bin/cli.js",
                    },
                }),
            );
            writeFile("bin/cli.js", "#!/usr/bin/env node\nexport function main() {}\n");

            await withMutedConsole(() => runScan());
            fs.unlinkSync("bin/cli.js");
            await withMutedConsole(() => runScan());

            const entrypointIndex = JSON.parse(
                fs.readFileSync(".aidw/index/entrypoints.json", "utf-8"),
            );

            assert.equal(
                entrypointIndex.some((entrypoint) => entrypoint.path === "bin/cli.js"),
                false,
            );
        });
    });

    await t.test("index size limits are enforced", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("node_modules/ignored-package/index.js", "export function ignored() {}\n");
            writeFile("dist/ignored.js", "export function ignoredDist() {}\n");
            writeFile("coverage/ignored.js", "export function ignoredCoverage() {}\n");

            for (let index = 0; index < 240; index += 1) {
                writeFile(
                    `src/generated/file-${index}.js`,
                    `export function generatedSymbol${index}() { return ${index}; }\n`,
                );
            }
            for (let index = 0; index < 560; index += 1) {
                writeFile(
                    `bin/tool-${index}.js`,
                    `export function toolSymbol${index}() { return ${index}; }\n`,
                );
            }

            await withMutedConsole(() => runScan());

            const fileIndex = JSON.parse(
                fs.readFileSync(".aidw/index/files.json", "utf-8"),
            );
            const symbolIndex = JSON.parse(
                fs.readFileSync(".aidw/index/symbols.json", "utf-8"),
            );
            const taskMap = JSON.parse(
                fs.readFileSync(".aidw/context/tasks.json", "utf-8"),
            );
            const fileGroups = JSON.parse(
                fs.readFileSync(".aidw/index/file-groups.json", "utf-8"),
            );
            const summary = JSON.parse(
                fs.readFileSync(".aidw/index/summary.json", "utf-8"),
            );

            assert.ok(fileIndex.length <= 200);
            assert.ok(symbolIndex.length <= 500);
            assert.ok(fileGroups.length <= 80);
            assert.ok(taskMap.length <= 50);
            assert.equal(summary.indexedFiles, fileIndex.length);
            assert.equal(summary.indexedSymbols, symbolIndex.length);
            assert.equal(summary.fileGroups, fileGroups.length);
            assert.equal(summary.truncated, true);
            assert.ok(summary.totalFilesScanned > summary.indexedFiles);
            assert.ok(
                [...fileIndex, ...symbolIndex, ...taskMap].every((record) => {
                    const description = record.description ?? record.notes ?? "";

                    return description.length <= 120;
                }),
            );
            assert.equal(
                fileIndex.some((entry) => entry.path.startsWith("node_modules/")),
                false,
            );
            assert.equal(
                fileIndex.some((entry) => entry.path.startsWith("dist/")),
                false,
            );
            assert.equal(
                fileIndex.some((entry) => entry.path.startsWith("coverage/")),
                false,
            );
            assert.equal(
                fileIndex.some((entry) => entry.path.startsWith(".aidw/")),
                false,
            );
            assert.ok(
                fileGroups.every((group) =>
                    group.keyFiles.every((filePath) => fs.existsSync(filePath)),
                ),
            );
        });
    });

    await t.test("scan check returns up to date after scan", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            await withMutedConsole(() => runScan());
            await withMutedConsole(() => runScan());
            const { output, result } = await withCapturedConsole(() =>
                runScan({ mode: "check" }),
            );

            assert.equal(result.changed, false);
            assert.equal(process.exitCode, 0);
            assert.match(output.join("\n"), /Project context is up to date/);
            assert.match(
                output.join("\n"),
                /Checked:\n\* \.aidw\/project\.md AUTO-GENERATED section/,
            );
        });
    });

    await t.test("scan auto prints no changes when up to date", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            await withMutedConsole(() => runScan());
            await withMutedConsole(() => runScan());
            const { output, result } = await withCapturedConsole(() =>
                runScan({ mode: "auto" }),
            );

            assert.equal(result.changed, false);
            assert.deepEqual(result.updatedFiles, []);
            assert.match(output.join("\n"), /Project scan completed/);
            assert.match(output.join("\n"), /Changes:\n\* No changes/);
            assert.match(output.join("\n"), /Mode:\n\* auto/);
        });
    });

    await t.test("default scan prints no changes when up to date", async () => {
        await withTempProject(async () => {
            await withMutedConsole(() => runInit());
            writeFile("package.json", JSON.stringify({ name: "scan-target" }));
            writeFile("bin/cli.js", "#!/usr/bin/env node\n");

            await withMutedConsole(() => runScan());
            await withMutedConsole(() => runScan());
            const { output, result } = await withCapturedConsole(() => runScan());

            assert.equal(result.changed, false);
            assert.deepEqual(result.updatedFiles, []);
            assert.match(output.join("\n"), /Project scan completed/);
            assert.match(output.join("\n"), /Changes:\n\* No changes/);
        });
    });

    await t.test("fresh user flow works through CLI parser from a temporary project path", async () => {
        await withTempProject(async () => {
            process.exitCode = 0;

            const init = await withCapturedConsole(() => runCliMain(["init"]));
            const scan = await withCapturedConsole(() => runCliMain(["scan"]));
            const check = await withCapturedConsole(() =>
                runCliMain(["scan", "--check"]),
            );
            const combinedOutput = [
                init.output.join("\n"),
                scan.output.join("\n"),
                check.output.join("\n"),
            ].join("\n");

            assert.equal(process.exitCode, 0);
            assert.ok(fs.existsSync(".aidw"));
            assert.ok(fs.existsSync(".aidw/project.md"));
            assert.ok(fs.existsSync(".trae/rules/project_rules.md"));
            assert.match(combinedOutput, /\.aidw\//);
            assert.doesNotMatch(combinedOutput, /ai\//);
        });
    });
});

