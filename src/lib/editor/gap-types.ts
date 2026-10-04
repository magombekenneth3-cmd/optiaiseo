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

/** Replace the first occurrence of a gap's snippet using DOM AST for HTML content or string replacement for plain text. */
export function applyGapFix(content: string, gap: IdentifiedGap): string {
    if (!gap.originalSnippet) return content;
    if (content.includes("<") && content.includes(">")) {
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
        } catch {
            // Fall back to exact string match if HTML parse fails
        }
    }
    const i = content.indexOf(gap.originalSnippet);
    if (i === -1) return content;
    return content.slice(0, i) + gap.suggestedReplacement + content.slice(i + gap.originalSnippet.length);
}
