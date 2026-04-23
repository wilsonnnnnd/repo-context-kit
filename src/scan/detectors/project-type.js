import {
    BACKEND_PATHS,
    NEXT_CONFIG_PATHS,
    PROJECT_TYPES,
    WEB_PATHS,
} from "../constants.js";
import { anyExists, exists } from "../fs-utils.js";

export function detectProjectType() {
    const hasWeb = anyExists(WEB_PATHS) || anyExists(NEXT_CONFIG_PATHS);
    const hasBackend =
        anyExists(BACKEND_PATHS) || exists("prisma/schema.prisma");
    const hasCli = exists("bin") && exists("package.json");
    const hasTemplate = exists("template");

    if (hasWeb && hasBackend) {
        return PROJECT_TYPES.FULLSTACK_APP;
    }

    if (hasCli && !hasWeb && !hasBackend) {
        return PROJECT_TYPES.CLI_TOOL;
    }

    if (hasWeb) {
        return PROJECT_TYPES.WEB_APP;
    }

    if (hasBackend) {
        return PROJECT_TYPES.BACKEND_APP;
    }

    if (hasCli) {
        return PROJECT_TYPES.CLI_TOOL;
    }

    if (hasTemplate) {
        return PROJECT_TYPES.TEMPLATE_REPO;
    }

    return PROJECT_TYPES.GENERIC;
}
