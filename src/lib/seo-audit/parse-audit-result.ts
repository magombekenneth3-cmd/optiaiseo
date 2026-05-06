/**
 * parse-audit-result.ts
 *
 * Single canonical parser for audit issueList JSON.
 * Handles three historical storage shapes:
 *   V1-A  Array<AuditCategoryResult>  (categories with items[])
 *   V1-B  FullAuditReport object      (recommendations[] + categories[])
 *   V1-C  Flat array of NormalisedIssue
 *
 * All four read paths (dashboard, export, share, embed) call this instead
 * of maintaining their own ad-hoc normalisation logic.
 */

import type {
    FullAuditReport,
    AuditCategoryResult,
    NormalizedRecommendation,
    ChecklistItem,
} from "./types";

// ─── Internal sub-shapes ────────────────────────────────────────────────────

interface RawCategoryItem {
    status?: string;
    label?: string;
    id?: string;
    finding?: string;
    recommendation?: { text?: string; priority?: string } | null;
    roiImpact?: number;
    aiVisibilityImpact?: number;
    details?: Record<string, string | number | boolean>;
}

interface RawCategory {
    id?: string;
    label?: string;
    items?: RawCategoryItem[];
    score?: number;
    passed?: number;
    failed?: number;
    warnings?: number;
}

interface RawRecommendation {
    categoryId?: string;
    itemId?: string;
    finding?: string;
    recommendation?: string;
    priority?: string;
    roiImpact?: number;
    aiVisibilityImpact?: number;
    priorityScore?: number;
}

interface RawReport {
    url?: string;
    timestamp?: string;
    overallScore?: number;
    aeoScore?: number;
    categories?: RawCategory[];
    recommendations?: RawRecommendation[];
    schemaVersion?: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ParsedAuditResult {
    /** Normalised categories with full ChecklistItem[] */
    categories: AuditCategoryResult[];
    /** Flat priority-sorted recommendations */
    recommendations: NormalizedRecommendation[];
    overallScore: number;
    /** Present when the stored blob was a full FullAuditReport */
    aeoScore?: number;
    url?: string;
    timestamp?: string;
    schemaVersion: 1 | 2;
}

/**
 * Parses any issueList JSON shape into a consistent ParsedAuditResult.
 * Never throws — returns an empty result on malformed input.
 */
export function parseAuditResult(raw: unknown): ParsedAuditResult {
    if (!raw) return emptyResult();

    // ── Shape B: { categories[], recommendations[], overallScore } ────────────
    if (isObject(raw) && ("categories" in raw || "recommendations" in raw)) {
        return parseReportObject(raw as RawReport);
    }

    // ── Shape A: AuditCategoryResult[] ────────────────────────────────────────
    if (Array.isArray(raw) && raw.length > 0 && isObject(raw[0]) && "items" in raw[0]) {
        return parseCategoryArray(raw as RawCategory[]);
    }

    // ── Shape C: flat NormalisedIssue[] (legacy) ──────────────────────────────
    if (Array.isArray(raw)) {
        return parseFlatIssueArray(raw);
    }

    return emptyResult();
}

// ─── Shape parsers ───────────────────────────────────────────────────────────

function parseReportObject(report: RawReport): ParsedAuditResult {
    const categories = (report.categories ?? []).map(normCategory);

    const recommendations: NormalizedRecommendation[] = (report.recommendations ?? []).map(
        (rec): NormalizedRecommendation => ({
            categoryId:          rec.categoryId ?? "general",
            itemId:              rec.itemId ?? "",
            finding:             rec.finding ?? "",
            recommendation:      rec.recommendation ?? "",
            priority:            (rec.priority as "High" | "Medium" | "Low") ?? "Medium",
            roiImpact:           rec.roiImpact ?? 50,
            aiVisibilityImpact:  rec.aiVisibilityImpact ?? 50,
            priorityScore:       rec.priorityScore ?? Math.round((rec.roiImpact ?? 50) * 0.6 + (rec.aiVisibilityImpact ?? 50) * 0.4),
        })
    );

    return {
        categories,
        recommendations,
        overallScore:   report.overallScore ?? computeOverallScore(categories),
        aeoScore:       report.aeoScore,
        url:            report.url,
        timestamp:      report.timestamp,
        schemaVersion:  (report.schemaVersion as 1 | 2) ?? 2,
    };
}

function parseCategoryArray(cats: RawCategory[]): ParsedAuditResult {
    const categories = cats.map(normCategory);
    const recommendations = extractRecommendations(categories);
    return {
        categories,
        recommendations,
        overallScore:  computeOverallScore(categories),
        schemaVersion: 1,
    };
}

function parseFlatIssueArray(items: unknown[]): ParsedAuditResult {
    // Legacy: flat array — wrap into a single "general" category
    const checklistItems: ChecklistItem[] = items.map((item, i) => {
        const it = item as Record<string, unknown>;
        return {
            id:             String(it.id ?? it.itemId ?? i),
            label:          String(it.title ?? it.label ?? it.itemId ?? "Issue"),
            status:         (it.status as ChecklistItem["status"]) ?? (it.severity === "critical" ? "Fail" : "Warning"),
            finding:        String(it.description ?? it.finding ?? ""),
            recommendation: it.recommendation
                ? { text: String(it.recommendation), priority: "Medium" as const }
                : undefined,
            roiImpact:           Number(it.roiImpact) || 50,
            aiVisibilityImpact:  Number(it.aiVisibilityImpact) || 50,
        };
    });

    const cat: AuditCategoryResult = {
        id:       "general",
        label:    "Findings",
        items:    checklistItems,
        score:    0,
        passed:   checklistItems.filter(i => i.status === "Pass").length,
        failed:   checklistItems.filter(i => i.status === "Fail").length,
        warnings: checklistItems.filter(i => i.status === "Warning").length,
    };

    const categories = [cat];
    return {
        categories,
        recommendations: extractRecommendations(categories),
        overallScore:    0,
        schemaVersion:   1,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normCategory(raw: RawCategory): AuditCategoryResult {
    const items: ChecklistItem[] = (raw.items ?? []).map(
        (it): ChecklistItem => ({
            id:             it.id ?? "",
            label:          it.label ?? it.id ?? "Check",
            status:         (it.status as ChecklistItem["status"]) ?? "Info",
            finding:        it.finding ?? "",
            recommendation: it.recommendation?.text
                ? { text: it.recommendation.text, priority: (it.recommendation.priority as "High" | "Medium" | "Low") ?? "Medium" }
                : undefined,
            roiImpact:           it.roiImpact,
            aiVisibilityImpact:  it.aiVisibilityImpact,
            details:             it.details,
        })
    );

    const analyzable = items.filter(i => i.status !== "Skipped" && i.status !== "Info");
    const passed   = analyzable.filter(i => i.status === "Pass").length;
    const failed   = analyzable.filter(i => i.status === "Fail").length;
    const warnings = analyzable.filter(i => i.status === "Warning").length;
    const score    = raw.score ?? (analyzable.length > 0
        ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
        : 100);

    return {
        id:       raw.id ?? "general",
        label:    raw.label ?? raw.id ?? "General",
        items,
        score,
        passed:   raw.passed   ?? passed,
        failed:   raw.failed   ?? failed,
        warnings: raw.warnings ?? warnings,
    };
}

function extractRecommendations(categories: AuditCategoryResult[]): NormalizedRecommendation[] {
    const recs: NormalizedRecommendation[] = [];
    for (const cat of categories) {
        for (const item of cat.items) {
            if ((item.status === "Fail" || item.status === "Warning") && item.recommendation) {
                const roi = item.roiImpact ?? 50;
                const aio = item.aiVisibilityImpact ?? 50;
                recs.push({
                    categoryId:         cat.id,
                    itemId:             item.id,
                    finding:            item.finding,
                    recommendation:     item.recommendation.text,
                    priority:           item.recommendation.priority,
                    roiImpact:          roi,
                    aiVisibilityImpact: aio,
                    priorityScore:      Math.round(roi * 0.6 + aio * 0.4),
                });
            }
        }
    }
    return recs.sort((a, b) => b.priorityScore - a.priorityScore);
}

function computeOverallScore(categories: AuditCategoryResult[]): number {
    const scored = categories.filter(c => !(c as { crashed?: boolean }).crashed);
    if (scored.length === 0) return 100;
    return Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length);
}

function emptyResult(): ParsedAuditResult {
    return { categories: [], recommendations: [], overallScore: 0, schemaVersion: 1 };
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── Convenience: flatten to the NormalisedIssue shape used by the UI ────────

export interface NormalisedIssue {
    id: string;
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
    category: string;
    recommendation: string;
    roiImpact: number;
    aiVisibilityImpact: number;
    priorityScore: number;
    status?: string;
    finding?: string;
}

/** Converts ParsedAuditResult into the flat NormalisedIssue[] the dashboard UI expects. */
export function toNormalisedIssues(parsed: ParsedAuditResult): NormalisedIssue[] {
    // Prefer recommendations[] (already priority-sorted with real scores)
    if (parsed.recommendations.length > 0) {
        return parsed.recommendations.map(
            (rec): NormalisedIssue => ({
                id:                 rec.itemId,
                title:              rec.itemId,
                description:        rec.finding,
                severity:           rec.priority === "High" ? "critical" : rec.priority === "Medium" ? "high" : "medium",
                category:           rec.categoryId,
                recommendation:     rec.recommendation,
                roiImpact:          rec.roiImpact,
                aiVisibilityImpact: rec.aiVisibilityImpact,
                priorityScore:      rec.priorityScore,
                finding:            rec.finding,
            })
        );
    }

    // Fallback: extract from categories
    return parsed.categories.flatMap(cat =>
        cat.items
            .filter(i => i.status === "Fail" || i.status === "Warning")
            .map((item): NormalisedIssue => {
                const roi = item.roiImpact ?? 50;
                const aio = item.aiVisibilityImpact ?? 50;
                return {
                    id:                 item.id,
                    title:              item.label,
                    description:        item.finding,
                    severity:           item.status === "Fail" ? "critical" : "high",
                    category:           cat.id,
                    recommendation:     item.recommendation?.text ?? "",
                    roiImpact:          roi,
                    aiVisibilityImpact: aio,
                    priorityScore:      Math.round(roi * 0.6 + aio * 0.4),
                    status:             item.status,
                    finding:            item.finding,
                };
            })
    );
}
