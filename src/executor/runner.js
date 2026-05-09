import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildWorksetContext } from "../../bin/context.js";
import { appendLoopEvent, listRecentLoopEvents } from "../loop/store.js";
import { parseTaskRegistry } from "../scan/task-registry.js";
import { loadExecutorState, resetExecutorState, updateExecutorState } from "./state.js";
import { withRepoRoot } from "../runtime/root-context.js";

const TASK_ID_PATTERN = /^T-\d{3}$/i;

function normalizeTaskId(taskId) {
    const normalized = String(taskId ?? "").trim().toUpperCase();
    return TASK_ID_PATTERN.test(normalized) ? normalized : null;
}

function createPauseId() {
    return `P-${crypto.randomBytes(8).toString("hex")}`;
}

function extractMarkdownSection(content, heading) {
    const escapedHeading = String(heading ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
        `(?:^|\\n)##\\s+${escapedHeading}\\s*\\n(?<body>[\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = String(content ?? "").match(regex);
    return match?.groups?.body?.trim() ?? "";
}

function summarizeTaskDetail(taskDetail) {
    const goal = extractMarkdownSection(taskDetail, "Goal");
    const scope = extractMarkdownSection(taskDetail, "Scope");
    const acceptanceCriteria = extractMarkdownSection(taskDetail, "Acceptance Criteria");
    const parts = [];
    if (goal) parts.push(`## Goal\n\n${goal}`);
    if (scope) parts.push(`## Scope\n\n${scope}`);
    if (acceptanceCriteria) parts.push(`## Acceptance Criteria\n\n${acceptanceCriteria}`);
    if (!parts.length) {
        const trimmed = String(taskDetail ?? "").trim();
        return trimmed.length > 1200 ? `${trimmed.slice(0, 1185).trimEnd()}\n[truncated]` : trimmed;
    }
    const joined = parts.join("\n\n");
    return joined.length > 2400 ? `${joined.slice(0, 2385).trimEnd()}\n[truncated]` : joined;
}

function summarizeWorkset(workset) {
    const candidates = extractMarkdownSection(workset, "Related File Candidates");
    const riskAreas = extractMarkdownSection(workset, "Relevant Risk Areas");
    const entryPoints = extractMarkdownSection(workset, "Entry Points");
    const warnings = extractMarkdownSection(workset, "Warnings");
    const parts = [];
    if (entryPoints) parts.push(`## Entry Points\n\n${entryPoints}`);
    if (candidates) parts.push(`## Related File Candidates\n\n${candidates}`);
    if (riskAreas) parts.push(`## Relevant Risk Areas\n\n${riskAreas}`);
    if (warnings) parts.push(`## Warnings\n\n${warnings}`);
    if (!parts.length) {
        const trimmed = String(workset ?? "").trim();
        return trimmed.length > 2400 ? `${trimmed.slice(0, 2385).trimEnd()}\n[truncated]` : trimmed;
    }
    const joined = parts.join("\n\n");
    return joined.length > 3600 ? `${joined.slice(0, 3585).trimEnd()}\n[truncated]` : joined;
}

export function createPause(type, taskId, message, cwd = process.cwd()) {
    const pauseId = createPauseId();
    const nextAction = String(type ?? "").trim();
    const next = updateExecutorState(
        {
            activeTaskId: taskId,
            pauseId,
            pauseType: nextAction,
            message: message ?? null,
        },
        cwd,
    );
    appendLoopEvent(
        { type: "executor_pause_created", taskId, pauseId, pauseType: nextAction, phase: next.state.phase },
        cwd,
    );
    return { ...next, pauseId };
}

export function loadTask(taskId, cwd = process.cwd()) {
    return withRepoRoot(cwd, () => {
        const normalizedTaskId = normalizeTaskId(taskId);
        if (!normalizedTaskId) {
            return { ok: false, error: "Invalid task id. Expected format: T-###", state: null, task: null, worksetSummary: null, taskSummary: null };
        }
        const registry = parseTaskRegistry(cwd);
        if (!registry.exists) {
            return { ok: false, error: "task/task.md is missing. Create tasks with repo-context-kit task new or restore the task registry.", state: null, task: null, worksetSummary: null, taskSummary: null };
        }
        const task = registry.tasks.find((entry) => String(entry.id ?? "").trim().toUpperCase() === normalizedTaskId) ?? null;
        if (!task) {
            return { ok: false, error: `Task not found: ${normalizedTaskId}. Check task/task.md for available task IDs.`, state: null, task: null, worksetSummary: null, taskSummary: null };
        }

        const taskDetailPath = task.file ? String(task.file) : null;
        let taskDetail = "";
        if (taskDetailPath) {
            try {
                taskDetail = fs.readFileSync(path.resolve(cwd, taskDetailPath), "utf-8");
            } catch {
                taskDetail = "";
            }
        }
        const workset = buildWorksetContext(task.id, { deep: false, digest: true });
        const worksetSummary = summarizeWorkset(workset);
        const taskSummary = summarizeTaskDetail(taskDetail);

        const statePatch = updateExecutorState(
            {
                activeTaskId: task.id,
                phase: "waiting_for_scope_confirmation",
                pauseId: null,
                pauseType: null,
                message: "Confirm scope before continuing.",
                blockedReason: null,
            },
            cwd,
        );
        appendLoopEvent({ type: "executor_task_loaded", taskId: task.id, phase: statePatch.state.phase }, cwd);
        const pause = createPause("confirm_scope", task.id, "Confirm scope before continuing.", cwd);
        const nextState = updateExecutorState(
            {
                phase: "waiting_for_scope_confirmation",
                pauseId: pause.pauseId,
                pauseType: "confirm_scope",
                message: "Confirm scope before continuing.",
            },
            cwd,
        );
        return { ok: true, error: null, state: nextState.state, task, worksetSummary, taskSummary };
    });
}

export function loadNextTask(cwd = process.cwd()) {
    return withRepoRoot(cwd, () => {
        const registry = parseTaskRegistry(cwd);
        if (!registry.exists) {
            return { ok: false, error: "task/task.md is missing. Create tasks with repo-context-kit task new or restore the task registry.", state: null, task: null, worksetSummary: null, taskSummary: null };
        }
        const nextTask = registry.tasks.find((task) => String(task.status ?? "").trim().toLowerCase() === "todo") ?? null;
        if (!nextTask) {
            return { ok: false, error: "No todo tasks found in task/task.md.", state: null, task: null, worksetSummary: null, taskSummary: null };
        }
        return loadTask(nextTask.id, cwd);
    });
}

export function advanceAfterConfirm(state, cwd = process.cwd()) {
    const taskId = state.activeTaskId;
    if (!taskId) {
        return { ok: false, error: "No active task. Run: repo-context-kit execute run <taskId>", state: null, hints: [] };
    }

    if (state.phase === "waiting_for_scope_confirmation") {
        const next = updateExecutorState(
            {
                phase: "waiting_for_apply_confirmation",
                pauseId: null,
                pauseType: null,
                message: "Confirm apply before continuing.",
            },
            cwd,
        );
        appendLoopEvent({ type: "executor_phase_advanced", taskId, from: "waiting_for_scope_confirmation", to: next.state.phase }, cwd);
        const pause = createPause("confirm_apply", taskId, "Confirm apply before continuing.", cwd);
        const saved = updateExecutorState(
            { phase: "waiting_for_apply_confirmation", pauseId: pause.pauseId, pauseType: "confirm_apply" },
            cwd,
        );
        return { ok: true, error: null, state: saved.state, hints: [] };
    }

    if (state.phase === "waiting_for_apply_confirmation") {
        const next = updateExecutorState(
            {
                phase: "waiting_for_test_confirmation",
                pauseId: null,
                pauseType: null,
                message: "Confirm tests before continuing.",
            },
            cwd,
        );
        appendLoopEvent({ type: "executor_phase_advanced", taskId, from: "waiting_for_apply_confirmation", to: next.state.phase }, cwd);
        const pause = createPause("confirm_test", taskId, "Confirm tests before continuing.", cwd);
        const saved = updateExecutorState(
            { phase: "waiting_for_test_confirmation", pauseId: pause.pauseId, pauseType: "confirm_test" },
            cwd,
        );
        return { ok: true, error: null, state: saved.state, hints: [] };
    }

    if (state.phase === "waiting_for_test_confirmation") {
        const next = updateExecutorState(
            {
                phase: "testing",
                pauseId: null,
                pauseType: null,
                message: "Run tests via gate, then sync the result.",
            },
            cwd,
        );
        appendLoopEvent({ type: "executor_phase_advanced", taskId, from: "waiting_for_test_confirmation", to: next.state.phase }, cwd);
        const hints = [
            `repo-context-kit gate confirm task ${taskId} --json`,
            `repo-context-kit gate confirm tests ${taskId}`,
            `repo-context-kit gate run-test ${taskId} --token <token>`,
            "repo-context-kit execute sync",
        ];
        return { ok: true, error: null, state: next.state, hints };
    }

    return { ok: false, error: `Cannot advance from phase: ${state.phase}`, state: null, hints: [] };
}

export function confirmPause(pauseId, cwd = process.cwd()) {
    const state = loadExecutorState(cwd);
    const expected = String(state.pauseId ?? "").trim();
    const provided = String(pauseId ?? "").trim();
    if (!state.activeTaskId) {
        return { ok: false, error: "No active task. Run: repo-context-kit execute run <taskId>", state: null, hints: [] };
    }
    if (!expected || expected !== provided) {
        return { ok: false, error: "Invalid pauseId for current executor state.", state: null, hints: [] };
    }
    if (!String(state.phase ?? "").startsWith("waiting_for_")) {
        return { ok: false, error: `Cannot confirm in current phase: ${state.phase}`, state: null, hints: [] };
    }
    appendLoopEvent(
        { type: "executor_pause_confirmed", taskId: state.activeTaskId, pauseId: state.pauseId, pauseType: state.pauseType, phase: state.phase },
        cwd,
    );
    const cleared = updateExecutorState({ pauseId: null, pauseType: null }, cwd);
    return advanceAfterConfirm(cleared.state, cwd);
}

export function markCompleted(taskId, cwd = process.cwd()) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
        return { ok: false, error: "Invalid task id. Expected format: T-###", state: null };
    }
    const prev = loadExecutorState(cwd);
    const completedTasks = [...new Set([...(prev.completedTasks ?? []), normalizedTaskId])];
    const next = updateExecutorState({ activeTaskId: normalizedTaskId, phase: "completed", completedTasks, blockedReason: null }, cwd);
    appendLoopEvent({ type: "executor_task_completed", taskId: normalizedTaskId, phase: next.state.phase }, cwd);
    return { ok: true, error: null, state: next.state };
}

export function markFailed(taskId, reason, cwd = process.cwd()) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
        return { ok: false, error: "Invalid task id. Expected format: T-###", state: null };
    }
    const next = updateExecutorState({ activeTaskId: normalizedTaskId, phase: "failed", blockedReason: String(reason ?? "").trim() || "Task failed." }, cwd);
    appendLoopEvent({ type: "executor_task_failed", taskId: normalizedTaskId, phase: next.state.phase, reason: next.state.blockedReason }, cwd);
    return { ok: true, error: null, state: next.state };
}

export function reset(cwd = process.cwd()) {
    const next = resetExecutorState(cwd);
    appendLoopEvent({ type: "executor_reset" }, cwd);
    return { ok: true, error: null, state: next.state };
}

export function syncTestResult(cwd = process.cwd()) {
    const state = loadExecutorState(cwd);
    const taskId = state.activeTaskId;
    if (!taskId) {
        return { ok: false, error: "No active task. Run: repo-context-kit execute run <taskId>", state: null, status: "error" };
    }
    if (state.phase !== "testing") {
        return { ok: false, error: "Only testing phase can sync test result.", state: null, status: "error" };
    }
    const events = listRecentLoopEvents({ taskId, limit: 50 }, cwd);
    const testEvent = events.find((event) => String(event?.type ?? "") === "test") ?? null;

    if (!testEvent) {
        const next = updateExecutorState({ lastSyncedTestAt: new Date().toISOString() }, cwd);
        appendLoopEvent({ type: "executor_test_sync_pending", taskId }, cwd);
        return { ok: true, error: null, state: next.state, status: "pending" };
    }

    const exitCode = testEvent.exitCode != null ? Number(testEvent.exitCode) : null;
    const ok = testEvent.ok === true || exitCode === 0;
    const command = testEvent.command ? String(testEvent.command) : null;
    const lastSyncedTestAt = new Date().toISOString();
    appendLoopEvent({ type: "executor_test_synced", taskId, ok, exitCode, command }, cwd);

    if (ok) {
        const prev = loadExecutorState(cwd);
        const completedTasks = [...new Set([...(prev.completedTasks ?? []), taskId])];
        const next = updateExecutorState(
            {
                phase: "completed",
                completedTasks,
                blockedReason: null,
                lastSyncedTestAt,
                lastTestExitCode: exitCode,
                lastTestCommand: command,
            },
            cwd,
        );
        appendLoopEvent({ type: "executor_task_completed", taskId }, cwd);
        return { ok: true, error: null, state: next.state, status: "completed" };
    }

    const reasonParts = [];
    if (exitCode != null) reasonParts.push(`exitCode=${exitCode}`);
    if (command) reasonParts.push(`command="${command}"`);
    const blockedReason = reasonParts.length ? `Test failed: ${reasonParts.join(" ")}` : "Test failed.";
    const next = updateExecutorState(
        {
            phase: "failed",
            blockedReason,
            lastSyncedTestAt,
            lastTestExitCode: exitCode,
            lastTestCommand: command,
        },
        cwd,
    );
    appendLoopEvent({ type: "executor_task_failed", taskId, reason: blockedReason }, cwd);
    return { ok: true, error: null, state: next.state, status: "failed" };
}
