export interface RobotsRule {
    type: 'allow' | 'disallow';
    path: string;
}

export interface RobotsGroup {
    agents: string[];
    rules: RobotsRule[];
}

/**
 * Parse robots.txt into RFC 9309 User-agent groups.
 * Stacked `User-agent:` lines share a single rule group until the next group starts.
 */
export function parseRobotsGroups(robotsText: string): RobotsGroup[] {
    const lines = robotsText
        .split(/\r?\n/)
        .map((l) => l.split('#')[0].trim())
        .filter(Boolean);

    const groups: RobotsGroup[] = [];
    let currentGroup: RobotsGroup | null = null;
    let sawRuleInCurrentGroup = false;

    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const val = line.slice(colonIdx + 1).trim();

        if (key === 'user-agent') {
            if (!currentGroup || sawRuleInCurrentGroup) {
                currentGroup = { agents: [], rules: [] };
                groups.push(currentGroup);
                sawRuleInCurrentGroup = false;
            }
            if (val) currentGroup.agents.push(val.toLowerCase());
        } else if ((key === 'disallow' || key === 'allow') && currentGroup) {
            sawRuleInCurrentGroup = true;
            currentGroup.rules.push({ type: key, path: val });
        }
    }

    return groups;
}

function compileRobotsPattern(pattern: string): RegExp | null {
    // Empty Disallow/Allow matches nothing per RFC 9309 Section 2.2.2
    if (!pattern) return null;

    const hasEndAnchor = pattern.endsWith('$');
    const body = hasEndAnchor ? pattern.slice(0, -1) : pattern;
    const escaped = body
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');

    return new RegExp(`^${escaped}${hasEndAnchor ? '$' : ''}`);
}

/**
 * Evaluate whether `targetPath` (e.g. `/` or `/blog/post`) is allowed for `userAgent`
 * using RFC 9309 group specificity and longest-match Allow/Disallow precedence.
 */
export function isPathAllowedByRobots(
    robotsText: string,
    userAgent: string,
    targetPath = '/',
): boolean {
    if (!robotsText.trim()) return true;

    const groups = parseRobotsGroups(robotsText);
    const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    const targetToken = userAgent.toLowerCase().split('/')[0].trim();

    const specificGroups = targetToken && targetToken !== '*'
        ? groups.filter((g) => g.agents.some((a) => a.split('/')[0].trim() === targetToken))
        : [];
    const activeGroups = specificGroups.length > 0
        ? specificGroups
        : groups.filter((g) => g.agents.includes('*'));

    if (activeGroups.length === 0) return true;

    let bestMatch: { type: 'allow' | 'disallow'; length: number } | null = null;

    for (const group of activeGroups) {
        for (const rule of group.rules) {
            if (!rule.path) continue;
            const regex = compileRobotsPattern(rule.path);
            if (!regex || !regex.test(normalizedPath)) continue;

            const len = rule.path.length;
            if (
                !bestMatch ||
                len > bestMatch.length ||
                (len === bestMatch.length && rule.type === 'allow')
            ) {
                bestMatch = { type: rule.type, length: len };
            }
        }
    }

    return bestMatch ? bestMatch.type === 'allow' : true;
}

/**
 * Returns true if the given bot/user-agent is blocked at the root path (`/`).
 * Preserved signature for AiVisibilityModule and callers.
 */
export function parseRobotsForBot(robotsText: string, botPattern: string): boolean {
    return !isPathAllowedByRobots(robotsText, botPattern, '/');
}
