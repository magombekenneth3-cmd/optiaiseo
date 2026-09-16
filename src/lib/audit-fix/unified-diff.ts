/** Applies a deliberately small, single-file unified diff with strict context checks. */
export function applyUnifiedDiff(source: string, patch: string): string {
    if (patch.length > 40_000) throw new Error("Patch exceeds the 40KB safety limit.");
    const lines = patch.replace(/\r\n/g, "\n").split("\n");
    const sourceLines = source.replace(/\r\n/g, "\n").split("\n");
    const output: string[] = [];
    let cursor = 0;
    let sawHunk = false;
    for (let i = 0; i < lines.length; i++) {
        const header = lines[i].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (!header) continue;
        sawHunk = true;
        const start = Number(header[1]) - 1;
        if (start < cursor || start > sourceLines.length) throw new Error("Patch hunks overlap or are out of range.");
        output.push(...sourceLines.slice(cursor, start));
        cursor = start;
        i++;
        for (; i < lines.length && !lines[i].startsWith("@@ "); i++) {
            const line = lines[i];
            if (line === "\\ No newline at end of file") continue;
            const kind = line[0]; const value = line.slice(1);
            if (!" +-".includes(kind)) throw new Error("Invalid unified diff line.");
            if (kind === " " || kind === "-") {
                if (sourceLines[cursor] !== value) throw new Error("Patch context does not match the pinned source file.");
                cursor++;
            }
            if (kind === " " || kind === "+") output.push(value);
        }
        i--;
    }
    if (!sawHunk) throw new Error("No unified diff hunk found.");
    output.push(...sourceLines.slice(cursor));
    const result = output.join("\n");
    if (result === source) throw new Error("Patch makes no change.");
    return result;
}
