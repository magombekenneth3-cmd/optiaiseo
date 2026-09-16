/**
 * Shared report types — single source of truth for all PDF reports.
 *
 * Used by:
 *   - executive-digest.ts (unified executive report)
 *   - agency-report.ts   (agency white-label report)
 *   - aeo-report.ts      (standalone AEO report)
 *   - queries.ts         (data aggregation layer)
 */
import type { ProviderStatus } from "@/lib/aeo/provider-result";

// ─── Reporting period ───────────────────────────────────────────────────────

/**
 * Explicit reporting period contract.
 *
 * Every data source feeding into a report must either:
 *   1. Be queried for this exact period, or
 *   2. Declare its actual snapshot date via DataSourceProvenance.
 *
 * The PDF displays this as:
 *   "Reporting period: Aug 1 – Aug 31, 2026"
 * rather than a vague "September 2026" label.
 */
export interface ReportPeriod {
    /** ISO date string — start of the reporting window */
    startDate: string;
    /** ISO date string — end of the reporting window */
    endDate: string;
    /** Human-readable label, e.g. "Aug 1 – Aug 31, 2026" */
    label: string;
}

// ─── AEO engine metrics ─────────────────────────────────────────────────────

/**
 * Per-engine AEO metric preserving provider availability.
 *
 * Inherits the ProviderStatus semantics from P0:
 *
 *   SUCCESS        → engine responded; score is authoritative
 *   NO_RESULT      → engine responded but found no mention → score = 0 (truthful)
 *   NO_API_KEY     → integration isn't configured → render "— Not configured"
 *   PROVIDER_ERROR → engine returned an error    → render "— Unavailable"
 *   TIMEOUT        → engine didn't respond       → render "— Unavailable"
 *   CIRCUIT_OPEN   → system prevented the call   → render "— Unavailable"
 *
 * The PDF NEVER renders non-SUCCESS/NO_RESULT statuses as 0%.
 */
export interface AeoEngineMetric {
    engine: string;
    /** null when status is not SUCCESS or NO_RESULT */
    score: number | null;
    /** null when no previous period data exists */
    previousScore: number | null;
    status: ProviderStatus;
}

/**
 * Google AI Overview metric — preserves the distinction between:
 *   - Eligibility scoring (on-page signals, always computable)
 *   - Observed SERP citation (requires SerpAPI + actual observation)
 *
 * Example PDF rendering:
 *   Eligibility: 63%
 *   Observed citation: ✓ Brand mentioned
 *                      — Not observed (no SerpAPI)
 */
export interface GoogleAioMetric {
    /** 0-100 composite eligibility score from on-page signals */
    eligibilityScore: number;
    /** null when SerpAPI key not configured or check didn't run */
    hasObservedOverview: boolean | null;
    /** null when hasObservedOverview is null or false */
    brandMentionedInOverview: boolean | null;
    status: ProviderStatus;
}

// ─── Trend ──────────────────────────────────────────────────────────────────

export type TrendDirection = "improving" | "stable" | "declining";

// ─── Data provenance ────────────────────────────────────────────────────────

/**
 * Tracks where each report section's data came from and when it was captured.
 *
 * Rendered in the PDF footer or as inline annotations so the reader
 * knows the exact age of each data point. If a source is stale
 * (> 7 days before report period end), the PDF annotates it.
 */
export interface DataSourceProvenance {
    /** Data source name, e.g. "Audit", "AeoReport", "GSC", "CompetitorSnapshot" */
    source: string;
    /** ISO date of when this data was captured */
    snapshotDate: string;
    /** true if snapshot is > 7 days before report period endDate */
    isStale: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Whether an AEO engine metric has a displayable score. */
export function hasDisplayableScore(metric: AeoEngineMetric): boolean {
    return metric.status === "SUCCESS" || metric.status === "NO_RESULT";
}

/** Human-readable label for unavailable statuses. */
export function unavailableLabel(status: ProviderStatus): string {
    if (status === "NO_API_KEY") return "— Not configured";
    return "— Unavailable";
}

/** Compute delta indicator string for score changes. */
export function deltaIndicator(current: number | null, previous: number | null): string {
    if (current === null || previous === null) return "";
    const delta = current - previous;
    if (delta > 0) return `▲ +${delta}`;
    if (delta < 0) return `▼ ${delta}`;
    return "→ stable";
}

/** Compute delta color. */
export function deltaColor(current: number | null, previous: number | null): string {
    if (current === null || previous === null) return "rgba(180,180,210,0.4)";
    const delta = current - previous;
    if (delta > 0) return "#34d978";
    if (delta < 0) return "#ff5757";
    return "rgba(180,180,210,0.4)";
}

/**
 * Format a ReportPeriod from start/end dates.
 */
export function formatReportPeriod(startDate: string, endDate: string): ReportPeriod {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return {
        startDate,
        endDate,
        label: `${fmt(start)} – ${fmt(end)}`,
    };
}

/**
 * Create a DataSourceProvenance entry, auto-computing staleness.
 */
export function createProvenance(
    source: string,
    snapshotDate: string,
    periodEndDate: string,
): DataSourceProvenance {
    const snap = new Date(snapshotDate).getTime();
    const end = new Date(periodEndDate).getTime();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    return {
        source,
        snapshotDate,
        isStale: end - snap > SEVEN_DAYS_MS,
    };
}
