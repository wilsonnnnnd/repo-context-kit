import { PROJECT_TYPES } from "../constants.js";

export function buildOverview(projectType, techStack) {
    const overview = [];

    if (projectType === PROJECT_TYPES.CLI_TOOL) {
        overview.push("This is a Node.js CLI tooling project.");
    } else if (projectType === PROJECT_TYPES.FULLSTACK_APP) {
        overview.push(
            "This is a fullstack application with both web and backend/service layers.",
        );
    } else if (projectType === PROJECT_TYPES.BACKEND_APP) {
        overview.push("This is a backend application with server and service layers.");
    } else if (techStack.includes("Next.js")) {
        overview.push("This is a Next.js application.");
    } else if (techStack.includes("React")) {
        overview.push("This is a React application.");
    } else {
        overview.push("This is a JavaScript/TypeScript application.");
    }

    if (techStack.includes("TypeScript")) {
        overview.push("The project uses TypeScript.");
    } else if (techStack.includes("JavaScript")) {
        overview.push("The project uses JavaScript.");
    }

    if (techStack.includes("npm package")) {
        overview.push("The repository is packaged for npm distribution.");
    }

    return overview;
}
