import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function ensureDir(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        return true;
    } catch {
        return false;
    }
}

function readJsonSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

function writeJsonSafe(filePath, value) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(value, null, 4) + "\n", "utf-8");
        try {
            fs.chmodSync(filePath, 0o600);
        } catch {}
        return true;
    } catch {
        return false;
    }
}

function getConfigDir() {
    const override = String(process.env.REPO_CONTEXT_KIT_CONFIG_DIR ?? "").trim();
    if (override) return override;

    const appData = String(process.env.APPDATA ?? "").trim();
    if (appData) return path.join(appData, "repo-context-kit");

    const home = os.homedir();
    return path.join(home, ".config", "repo-context-kit");
}

function getConfigPath() {
    return path.join(getConfigDir(), "config.json");
}

function normalizeToken(value) {
    const token = String(value ?? "").trim();
    return token ? token : null;
}

export function getGitHubTokenFromUserConfig() {
    const config = readJsonSafe(getConfigPath());
    const token =
        config && config.github && typeof config.github.token === "string"
            ? normalizeToken(config.github.token)
            : null;
    return token;
}

export function setGitHubTokenInUserConfig(token) {
    const normalized = normalizeToken(token);
    if (!normalized) return { ok: false };

    const dir = getConfigDir();
    if (!ensureDir(dir)) return { ok: false };

    const existing = readJsonSafe(getConfigPath());
    const next = existing && typeof existing === "object" && existing ? existing : {};
    next.version = 1;
    next.github = next.github && typeof next.github === "object" && next.github ? next.github : {};
    next.github.token = normalized;

    return { ok: writeJsonSafe(getConfigPath(), next) };
}

export function unsetGitHubTokenInUserConfig() {
    const dir = getConfigDir();
    if (!dir) return { ok: false };

    const existing = readJsonSafe(getConfigPath());
    if (!existing || typeof existing !== "object") {
        return { ok: true, changed: false };
    }

    if (!existing.github || typeof existing.github !== "object") {
        return { ok: true, changed: false };
    }

    if (!("token" in existing.github)) {
        return { ok: true, changed: false };
    }

    const next = { ...existing, github: { ...existing.github } };
    delete next.github.token;

    return { ok: writeJsonSafe(getConfigPath(), next), changed: true };
}

