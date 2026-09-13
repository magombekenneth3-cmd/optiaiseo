/**
 * GSC Date Range normalization and validation.
 *
 * Provides a single source of truth for converting URL search params
 * into validated, GSC-safe date ranges with automatic comparison period derivation.
 *
 * Rules:
 *   - `days` param OR `startDate`+`endDate` params (never both)
 *   - endDate ≤ today - 3 days (GSC 2-3 day reporting lag)
 *   - startDate < endDate
 *   - range ≤ 16 months
 *   - all dates are UTC date-only (no timezone drift)
 *   - comparison period = preceding period of equal length
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GscDateRange {
    startDate: Date;
    endDate: Date;
    /** The comparison period (previous equivalent period) */
    comparisonStart: Date;
    comparisonEnd: Date;
    /** Human-readable label for the UI */
    label: string;
    /** Number of days in the selected range */
    days: number;
}

export interface DateRangeParams {
    days?: string;
    startDate?: string;
    endDate?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GSC_LAG_DAYS = 3;
const MAX_RANGE_MONTHS = 16;
const MAX_RANGE_DAYS = MAX_RANGE_MONTHS * 30; // ~480 days
const DEFAULT_DAYS = 90;

const PRESET_LABELS: Record<number, string> = {
    7: "Last 7 days",
    28: "Last 28 days",
    90: "Last 90 days",
    365: "Last year",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date at midnight UTC */
function todayUTC(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Formats a Date as YYYY-MM-DD */
export function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Parses a YYYY-MM-DD string into a UTC Date. Returns null if invalid. */
function parseISODate(input: string): Date | null {
    if (!input || typeof input !== "string") return null;

    // Strict format: YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;

    const [year, month, day] = input.split("-").map(Number);

    // Basic range checks
    if (year < 2000 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    const date = new Date(Date.UTC(year, month - 1, day));

    // Verify the date components didn't roll over (e.g. Feb 30 → Mar 2)
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date;
}

/** Returns the number of days between two dates (inclusive of start) */
function daysBetween(start: Date, end: Date): number {
    const ms = end.getTime() - start.getTime();
    return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** Subtracts N days from a date */
function subtractDays(date: Date, n: number): Date {
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() - n);
    return result;
}

// ─── Main normalization ───────────────────────────────────────────────────────

/**
 * Normalizes URL search params into a validated GSC date range.
 *
 * Priority:
 *   1. If both `days` AND `startDate`/`endDate` are present, `days` is stripped
 *      and custom range is used (URL canonicalization)
 *   2. If `startDate`+`endDate` are present, use custom range
 *   3. If `days` is present, use preset
 *   4. Fall back to 90 days
 *
 * @throws Error on invalid date combinations
 */
export function normalizeKeywordDateRange(params: DateRangeParams): GscDateRange {
    const today = todayUTC();
    const maxEndDate = subtractDays(today, GSC_LAG_DAYS);
    const minStartDate = subtractDays(today, MAX_RANGE_DAYS);

    // ── Custom range takes priority when both are present
    if (params.startDate && params.endDate) {
        return normalizeCustomRange(params.startDate, params.endDate, maxEndDate, minStartDate);
    }

    // ── Preset days
    const presetDays = params.days ? parseInt(params.days, 10) : DEFAULT_DAYS;
    if (isNaN(presetDays) || presetDays < 1 || presetDays > MAX_RANGE_DAYS) {
        return buildPresetRange(DEFAULT_DAYS, maxEndDate);
    }

    return buildPresetRange(presetDays, maxEndDate);
}

function buildPresetRange(days: number, maxEndDate: Date): GscDateRange {
    const endDate = maxEndDate;
    // For a "7 day" range, we want 7 days of data: endDate - 6 days
    const startDate = subtractDays(endDate, days - 1);

    // Comparison: equal-length period immediately preceding
    const comparisonEnd = subtractDays(startDate, 1);
    const comparisonStart = subtractDays(comparisonEnd, days - 1);

    const label = PRESET_LABELS[days] ?? `Last ${days} days`;

    return {
        startDate,
        endDate,
        comparisonStart,
        comparisonEnd,
        label,
        days,
    };
}

function normalizeCustomRange(
    startStr: string,
    endStr: string,
    maxEndDate: Date,
    minStartDate: Date,
): GscDateRange {
    const startDate = parseISODate(startStr);
    const endDate = parseISODate(endStr);

    if (!startDate) {
        throw new Error(`Invalid start date: "${startStr}". Expected YYYY-MM-DD format.`);
    }
    if (!endDate) {
        throw new Error(`Invalid end date: "${endStr}". Expected YYYY-MM-DD format.`);
    }

    // Clamp end date to respect GSC lag
    const effectiveEnd = endDate.getTime() > maxEndDate.getTime() ? maxEndDate : endDate;

    // Reject start > end
    if (startDate.getTime() >= effectiveEnd.getTime()) {
        throw new Error(
            `Start date (${fmtDate(startDate)}) must be before end date (${fmtDate(effectiveEnd)}).`,
        );
    }

    // Reject too-old start date
    if (startDate.getTime() < minStartDate.getTime()) {
        throw new Error(
            `Start date (${fmtDate(startDate)}) is too far in the past. Maximum range is ${MAX_RANGE_MONTHS} months.`,
        );
    }

    // Calculate range days
    const days = daysBetween(startDate, effectiveEnd) + 1;

    if (days > MAX_RANGE_DAYS) {
        throw new Error(`Date range (${days} days) exceeds maximum of ${MAX_RANGE_DAYS} days.`);
    }

    // Derive comparison period
    const comparisonEnd = subtractDays(startDate, 1);
    const comparisonStart = subtractDays(comparisonEnd, days - 1);

    const label = `${fmtDate(startDate)} — ${fmtDate(effectiveEnd)}`;

    return {
        startDate,
        endDate: effectiveEnd,
        comparisonStart,
        comparisonEnd,
        label,
        days,
    };
}

// ─── URL canonicalization ─────────────────────────────────────────────────────

/**
 * Converts a GscDateRange into canonical URL search params.
 *
 * Rules:
 *   - Preset ranges use `days=N` only
 *   - Custom ranges use `startDate` + `endDate` only
 *   - Never both
 */
export function toSearchParams(range: GscDateRange): URLSearchParams {
    const params = new URLSearchParams();

    // Check if this matches a known preset
    const isPreset = Object.keys(PRESET_LABELS).includes(String(range.days));

    if (isPreset) {
        params.set("days", String(range.days));
    } else {
        params.set("startDate", fmtDate(range.startDate));
        params.set("endDate", fmtDate(range.endDate));
    }

    return params;
}

/**
 * Checks whether the given params represent the default range (90 days).
 * Used to suppress unnecessary URL params.
 */
export function isDefaultRange(params: DateRangeParams): boolean {
    if (params.startDate || params.endDate) return false;
    if (!params.days) return true; // no params = default 90d
    return parseInt(params.days, 10) === DEFAULT_DAYS;
}
