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

/** Replace the first exact occurrence of a gap's snippet with its suggestion. */
export function applyGapFix(content: string, gap: IdentifiedGap): string {
    const i = content.indexOf(gap.originalSnippet);
    if (i === -1) return content;
    return content.slice(0, i) + gap.suggestedReplacement + content.slice(i + gap.originalSnippet.length);
}
