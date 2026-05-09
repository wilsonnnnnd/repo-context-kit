import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export function withRepoRoot(repoRoot, fn) {
    const root = String(repoRoot ?? "").trim();
    if (!root) {
        return fn();
    }
    return storage.run({ repoRoot: root }, fn);
}

export function getRepoRoot(fallback = process.cwd()) {
    const store = storage.getStore();
    const value = store?.repoRoot;
    return value ? String(value) : fallback;
}

