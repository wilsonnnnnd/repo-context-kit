import fs from "node:fs";
import path from "node:path";

function readTextSafe(filePath) {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch {
        return null;
    }
}

function getGitDir(cwd) {
    const dotGitPath = path.resolve(cwd, ".git");

    try {
        const stat = fs.statSync(dotGitPath);
        if (stat.isDirectory()) {
            return dotGitPath;
        }
        if (stat.isFile()) {
            const content = readTextSafe(dotGitPath);
            if (!content) return null;
            const match = content.match(/^\s*gitdir:\s*(.+)\s*$/m);
            if (!match) return null;
            const gitDir = match[1].trim();
            return path.resolve(cwd, gitDir);
        }
        return null;
    } catch {
        return null;
    }
}

function parseGitHubRepoFromRemoteUrl(url) {
    const value = String(url ?? "").trim();
    if (!value) return null;

    const normalized = value.replace(/\.git$/i, "");

    const httpsMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

    const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

    const sshUrlMatch = normalized.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
    if (sshUrlMatch) return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };

    return null;
}

export function resolveGitHubRepoFromGitRemote(cwd = process.cwd()) {
    const gitDir = getGitDir(cwd);
    if (!gitDir) return null;

    const configPath = path.join(gitDir, "config");
    const config = readTextSafe(configPath);
    if (!config) return null;

    const originBlockMatch = config.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
    if (!originBlockMatch) return null;

    const originBlock = originBlockMatch[1];
    const urlMatch = originBlock.match(/^\s*url\s*=\s*(.+)\s*$/m);
    if (!urlMatch) return null;

    return parseGitHubRepoFromRemoteUrl(urlMatch[1]);
}

export function resolveCurrentGitBranch(cwd = process.cwd()) {
    const gitDir = getGitDir(cwd);
    if (!gitDir) return null;

    const headPath = path.join(gitDir, "HEAD");
    const head = readTextSafe(headPath);
    if (!head) return null;

    const match = head.match(/^\s*ref:\s*refs\/heads\/(.+)\s*$/m);
    if (!match) return null;

    const branch = match[1].trim();
    return branch ? branch : null;
}

