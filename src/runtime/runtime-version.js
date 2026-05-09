export const CURRENT_RUNTIME_VERSION = "1";

function parseRuntimeVersion(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
        return { major: Number(raw), minor: 0, raw };
    }
    const dot = raw.match(/^(?<major>\d+)\.(?<minor>\d+)$/);
    if (dot?.groups) {
        return { major: Number(dot.groups.major), minor: Number(dot.groups.minor), raw };
    }
    const ym = raw.match(/^(?<year>\d{4})-(?<month>\d{2})$/);
    if (ym?.groups) {
        return { major: Number(ym.groups.year), minor: Number(ym.groups.month), raw };
    }
    return null;
}

export function isCompatibleRuntimeVersion(expected, actual) {
    const a = parseRuntimeVersion(expected);
    const b = parseRuntimeVersion(actual);
    if (!a || !b) return false;
    if (a.major !== b.major) return false;
    return b.minor >= a.minor;
}

