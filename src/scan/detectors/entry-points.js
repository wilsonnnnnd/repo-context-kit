import { PROJECT_TYPES } from "../constants.js";
import { exists, listDirSafe } from "../fs-utils.js";

const WEB_AND_BACKEND_ENTRIES = [
    ["app/page.tsx", "primary app page entry"],
    ["app/page.jsx", "primary app page entry"],
    ["app/page.ts", "primary app page entry"],
    ["app/page.js", "primary app page entry"],
    ["src/app/page.tsx", "primary app page entry under src"],
    ["src/app/page.jsx", "primary app page entry under src"],
    ["src/app/page.ts", "primary app page entry under src"],
    ["src/app/page.js", "primary app page entry under src"],
    ["pages/index.tsx", "primary pages-router entry"],
    ["pages/index.jsx", "primary pages-router entry"],
    ["pages/index.ts", "primary pages-router entry"],
    ["pages/index.js", "primary pages-router entry"],
    ["src/pages/index.tsx", "primary pages-router entry under src"],
    ["src/pages/index.jsx", "primary pages-router entry under src"],
    ["src/pages/index.ts", "primary pages-router entry under src"],
    ["src/pages/index.js", "primary pages-router entry under src"],
    ["app/layout.tsx", "shared app layout wrapper"],
    ["app/layout.jsx", "shared app layout wrapper"],
    ["src/app/layout.tsx", "shared app layout wrapper under src"],
    ["src/app/layout.jsx", "shared app layout wrapper under src"],
    ["server/index.ts", "server entrypoint"],
    ["server/index.js", "server entrypoint"],
    ["server.ts", "server entrypoint"],
    ["server.js", "server entrypoint"],
    ["src/server/index.ts", "server entrypoint under src"],
    ["src/server/index.js", "server entrypoint under src"],
    ["src/server.ts", "server entrypoint under src"],
    ["src/server.js", "server entrypoint under src"],
    ["api/index.ts", "API entrypoint"],
    ["api/index.js", "API entrypoint"],
    ["src/api/index.ts", "API entrypoint under src"],
    ["src/api/index.js", "API entrypoint under src"],
];

export function detectEntryPoints(projectType) {
    const entries = [];

    if (projectType === PROJECT_TYPES.CLI_TOOL) {
        if (!exists("bin")) {
            return entries;
        }

        for (const file of listDirSafe("bin")) {
            entries.push({
                label: `bin/${file}`,
                description: "CLI command entry or command helper",
            });
        }

        return entries;
    }

    for (const [relativePath, description] of WEB_AND_BACKEND_ENTRIES) {
        if (exists(relativePath)) {
            entries.push({ label: relativePath, description });
        }
    }

    return entries;
}
