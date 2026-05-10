export type AuditStatus = 'Pass' | 'Fail' | 'Warning' | 'Error' | 'Skipped' | 'Info';
export type RecommendationPriority = 'High' | 'Medium' | 'Low';

export interface AuditRecommendation {
    text: string;
    priority: RecommendationPriority;
}

// Used by computePriority() and rendered in the "Top 5 Fixes" card.
export interface AuditIssue {
    id: string
    title: string
    description: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    estimatedTrafficImpact: number // 1-10
    fixDifficulty: number          // 1-10  (1 = easy)
    confidence: number             // 0.0-1.0
    priorityScore?: number         // computed: 0-100
    category: string
    recommendation: string
}

/**
 * Computes a 0–100 priority score from impact × 0.5 + ease × 0.3 + confidence × 0.2.
 * Sort descending so the highest-priority fix is always first.
 */
export function computePriority(issue: AuditIssue): number {
    const impact = issue.estimatedTrafficImpact / 10
    const ease = 1 - (issue.fixDifficulty / 10)
    const conf = issue.confidence
    return Math.round((impact * 0.5 + ease * 0.3 + conf * 0.2) * 100)
}

/** Enrich a list of issues with priorityScore and return sorted descending. */
export function rankIssues(issues: AuditIssue[]): AuditIssue[] {
    return issues
        .map(i => ({ ...i, priorityScore: computePriority(i) }))
        .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
}

export interface ChecklistItem {
    id: string;
    label: string;
    status: AuditStatus;
    finding: string;
    recommendation?: AuditRecommendation;
    roiImpact?: number;        // 0-100
    aiVisibilityImpact?: number; // 0-100
    details?: Record<string, string | number | boolean>;
}

export interface AuditCategoryResult {
    id: string;
    label: string;
    items: ChecklistItem[];
    score: number;
    passed: number;
    failed: number;
    warnings: number;
}

export interface NormalizedRecommendation {
    categoryId: string;
    itemId: string;
    finding: string;
    recommendation: string;
    priority: RecommendationPriority;
    roiImpact: number;
    aiVisibilityImpact: number;
    /** Weighted business impact score: roiImpact×0.6 + aiVisibilityImpact×0.4 (0-100) */
    priorityScore: number;
}

export interface AeoScoreBreakdown {
    llmProbe:               number; // weight 0.30
    llmsTxtQuality:         number; // weight 0.20
    schemaCompleteness:     number; // weight 0.20
    citationReadiness:      number; // weight 0.15
    answerBoxStructure:     number; // weight 0.10
    conversationalHeadings: number; // weight 0.05
}

export interface FullAuditReport {
    url: string;
    timestamp: string;
    overallScore: number;
    /** Weighted AI-visibility score computed from 6 AEO checks (0–100) */
    aeoScore?: number;
    aeoBreakdown?: AeoScoreBreakdown;
    categories: AuditCategoryResult[];
    recommendations: NormalizedRecommendation[];
    /** Per-module timing telemetry (Phase 3.1) */
    moduleTelemetry?: ModulePerfEntry[];
}

export interface ModulePerfEntry {
    moduleId:  string;
    durationMs: number;
    score:      number;
    itemCount:  number;
    crashed:    boolean;
}

export interface AuditModuleContext {
    readonly url: string;
    readonly html: string;
    /** Modules append detected framework hints; engine resolves consensus after Promise.all */
    readonly frameworkHints: string[];
    readonly pageType?: string;
    /** Target keyword from site settings — used by KeywordOptimisationModule and ImageSeoModule */
    readonly targetKeyword?: string;
}

export interface AuditModule {
    id: string;
    label: string;
    requiresHtml?: boolean;
    run: (context: AuditModuleContext) => Promise<AuditCategoryResult>;
}

// Critical  → Fail/Error  (blocks indexing or ranking — fix immediately)
// Warning   → Warning     (hurts performance — fix this sprint)
// Notice    → Info/Pass   (good to fix — low urgency)
export type AuditSeverity = 'Critical' | 'Warning' | 'Notice';

/** Maps a ChecklistItem status to the universal severity label used in Aria voice output */
export function toSeverity(status: AuditStatus): AuditSeverity {
    if (status === 'Fail' || status === 'Error') return 'Critical';
    if (status === 'Warning') return 'Warning';
    return 'Notice';
}

export const AUDIT_CATEGORIES = {
    TECHNICAL: 'technical',
    CONTENT: 'content',
    AUTHORITY: 'authority',
    AI_VISIBILITY: 'ai-visibility',
    PERFORMANCE: 'performance',
} as const;
