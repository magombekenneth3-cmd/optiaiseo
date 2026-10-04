export interface IdentifiedGap {
    id: string;
    type: "seo" | "readability";
    severity: "critical" | "warning" | "opportunity";
    category: string;
    title: string;
    explanation: string;
    originalSnippet: string;
    suggestedReplacement: string;
    impact: string;
}

export interface GapAnalysisResponse {
    seoScore: number;
    readabilityScore: number;
    overallSummary: string;
    gaps: IdentifiedGap[];
}

import { parse } from "node-html-parser";

/** Replace the target gap node content strictly using DOM AST mutation. Zero string slicing fallbacks. */
export function applyGapFix(content: string, gap: IdentifiedGap): string {
    if (!gap.originalSnippet) return content;
    try {
        const root = parse(content);
        let replaced = false;
        root.querySelectorAll("*").forEach((node) => {
            if (!replaced && node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) {
                const text = node.text;
                if (text.includes(gap.originalSnippet)) {
                    node.set_content(text.replace(gap.originalSnippet, gap.suggestedReplacement));
                    replaced = true;
                }
            }
        });
        if (replaced) return root.toString();
        throw new Error(`AST_PARSE_FAILED: Target snippet '${gap.originalSnippet.slice(0, 30)}...' not found in DOM AST nodes.`);
    } catch (err) {
        if ((err as Error)?.message?.includes("AST_PARSE_FAILED")) throw err;
        throw new Error(`AST_PARSE_FAILED: Failed to parse DOM AST: ${(err as Error)?.message}`);
    }
}
