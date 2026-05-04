function normalizeApiBaseUrl(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "https://api.github.com";
    return trimmed.replace(/\/+$/g, "");
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export async function createPullRequest({
    token,
    owner,
    repo,
    title,
    head,
    base = "main",
    body = "",
    apiBaseUrl = process.env.REPO_CONTEXT_KIT_GITHUB_API_BASE_URL,
} = {}) {
    const authToken = String(token ?? "").trim();
    if (!authToken) {
        return { ok: false, error: "Missing GitHub token." };
    }

    const repoOwner = String(owner ?? "").trim();
    const repoName = String(repo ?? "").trim();
    if (!repoOwner || !repoName) {
        return { ok: false, error: "Missing repository owner/name." };
    }

    const prTitle = String(title ?? "").trim();
    const prHead = String(head ?? "").trim();
    const prBase = String(base ?? "").trim() || "main";
    if (!prTitle || !prHead) {
        return { ok: false, error: "Missing PR title or head branch." };
    }

    const baseUrl = normalizeApiBaseUrl(apiBaseUrl);
    const url = `${baseUrl}/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/pulls`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${authToken}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "repo-context-kit",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
                title: prTitle,
                head: prHead,
                base: prBase,
                body: String(body ?? ""),
            }),
        });

        const text = await response.text();
        const json = safeJson(text);

        if (!response.ok) {
            const message =
                (json && typeof json.message === "string" && json.message) ||
                `GitHub API returned HTTP ${response.status}.`;
            return { ok: false, error: message, status: response.status };
        }

        const htmlUrl = json && typeof json.html_url === "string" ? json.html_url : null;
        const number = json && typeof json.number === "number" ? json.number : null;
        if (!htmlUrl) {
            return { ok: false, error: "GitHub API response missing html_url." };
        }

        return {
            ok: true,
            url: htmlUrl,
            number,
        };
    } catch {
        return { ok: false, error: "Failed to reach GitHub API." };
    }
}

