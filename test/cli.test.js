import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main as runCliMain } from "../bin/cli.js";
import { runInit } from "../bin/init.js";
import { runScan } from "../bin/scan.js";
import { PROJECT_TYPES } from "../src/scan/constants.js";
import { detectProjectType } from "../src/scan/detectors/project-type.js";

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
            assert.match(combinedOutput, /\.aidw\//);
            assert.doesNotMatch(combinedOutput, /ai\//);
        });
    });
});
