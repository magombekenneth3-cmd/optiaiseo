
const GSC_BASE = "https://www.googleapis.com/webmasters/v3/sites";
const PAGE_SIZE = 25_000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

const DECAY_MIN_PREV_CLICKS = 20;
const DECAY_MIN_PREV_IMPRESSIONS = 50;
const DECAY_CLICK_DROP_THRESHOLD = 0.15;
const DECAY_IMPRESSION_DROP_MAX = 0.1;
const DECAY_POSITION_DROP_MIN = 2;
const DECAY_CTR_DROP_THRESHOLD = 0.02;

const CANNIBALIZATION_MIN_IMPRESSIONS = 5;
const CANNIBALIZATION_MAX_POSITION = 15;

const OPPORTUNITY_MIN_IMPRESSIONS = 30;
const OPPORTUNITY_MIN_POSITION = 5;

const CONTENT_GAP_MIN_IMPRESSIONS = 50;
const CONTENT_GAP_MIN_POSITION = 10;
const CONTENT_GAP_FRAGMENTED_URL_COUNT = 3;

const INTERNAL_LINK_MIN_POSITION = 5;
const INTERNAL_LINK_MAX_POSITION = 15;
const INTERNAL_LINK_MIN_IMPRESSIONS = 30;

const BASE_CTR_BY_POSITION: Record<number, number> = {
    1: 28, 2: 15, 3: 11, 4: 8, 5: 7,
    6: 5, 7: 4, 8: 3, 9: 2.5, 10: 2,
};
const BASE_CTR_FALLBACK = 1.5;

const CLUSTER_STOP_WORDS =
    /\b(best|top|vs|versus|review|reviews|compare|comparison|alternatives?|software|tool|tools|platform|service|app|solution|solutions|list|guide|tutorial|how|what|why|when|who)\b/g;

export type Device = "DESKTOP" | "MOBILE" | "TABLET";

export interface KeywordRow {
    keyword: string;
    url: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    device?: Device;
}

export interface DeviceSplit {
    desktop: KeywordRow[];
    mobile: KeywordRow[];
    tablet: KeywordRow[];
}

export interface DeviceMetrics {
    device: Device;
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
    clickShare: number;
    impressionShare: number;
}

export interface KeywordDeviceBreakdown {
    keyword: string;
    url: string;
    desktop: Omit<DeviceMetrics, "device"> | null;
    mobile: Omit<DeviceMetrics, "device"> | null;
    tablet: Omit<DeviceMetrics, "device"> | null;
    hasMobileCtrGap: boolean;
}

export type Intent = "informational" | "transactional" | "navigational" | "commercial";

export interface AggregatedKeyword {
    keyword: string;
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
    intent: Intent;
    urls: KeywordRow[];
}

export interface KeywordOpportunity extends AggregatedKeyword {
    opportunityScore: number;
    ctrScore: number;
    rankScore: number;
    opportunityType: "quick-win" | "ctr-optimize" | "ranking-optimize" | "new-content";
    reason: string;
}

export interface KeywordCluster {
    clusterKey: string;
    keywords: AggregatedKeyword[];
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
    dominantIntent: Intent;
}

export interface PageOpportunity {
    url: string;
    totalOpportunityScore: number;
    keywords: KeywordOpportunity[];
}

export interface CannibalizationIssue {
    keyword: string;
    urls: { url: string; clicks: number; impressions: number; position: number }[];
    totalClicks: number;
    totalImpressions: number;
    primaryUrl: string;
    clickConcentration: number;
    positionSpread: number;
    mixedIntent: boolean;
    severity: "high" | "medium" | "low";
    suggestedFix: "merge" | "canonicalize" | "internal-link";
}

export interface CategorisedKeywords {
    critical: AggregatedKeyword[];
    weak: AggregatedKeyword[];
    improving: AggregatedKeyword[];
    strong: AggregatedKeyword[];
}

export interface RankingSummary {
    total: number;
    avgPosition: number;
    totalClicks: number;
    totalImpressions: number;
    page1Count: number;
    page1Pct: number;
    page1ImpressionPct: number;
    top3Count: number;
    top3Pct: number;
    criticalCount: number;
    weakCount: number;
    improvingCount: number;
    strongCount: number;
}

export interface DecayRow {
    url: string;
    currentClicks: number;
    previousClicks: number;
    dropPercentage: number;
}

export interface KeywordDecayRow {
    keyword: string;
    currentClicks: number;
    previousClicks: number;
    currentPosition: number;
    previousPosition: number;
    clickDropPct: number;
    positionDrop: number;
    decayType: "ranking" | "ctr";
}

export interface BrandSplit {
    brand: AggregatedKeyword[];
    nonBrand: AggregatedKeyword[];
}

export interface KeywordTrend {
    keyword: string;
    clickChange: number;
    impressionChange: number;
    positionChange: number;
    trend: "up" | "down" | "stable";
}

export interface ContentGap {
    keyword: string;
    impressions: number;
    avgPosition: number;
    intent: Intent;
    isFragmented: boolean;
}

export interface InternalLinkOpportunity {
    keyword: string;
    targetUrl: string;
    avgPosition: number;
    impressions: number;
    clicks: number;
}

interface GscApiRow {
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

function fmt(d: Date): string {
    return d.toISOString().split("T")[0];
}

function cleanUrl(url: string): string {
    return url
        .split("?")[0]
        .split("#")[0]
        .replace(/\/(index\.(html?|php|aspx?))?$/i, "/")
        .replace(/\/$/, "");
}

function normalizeKeyword(keyword: string): string {
    return keyword
        .replace(/-(?:site|inurl|intitle|filetype|inanchor):\S+/g, "")
        .replace(/^"+|"+$/g, "")
        .replace(/"/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clusterKey(keyword: string): string {
    const cleaned = keyword
        .toLowerCase()
        .replace(CLUSTER_STOP_WORDS, " ")
        .replace(/\s+/g, " ")
        .trim();

    const tokens = cleaned.split(" ").filter(Boolean);
    if (tokens.length <= 2) return cleaned;
    return tokens.slice(0, 3).join(" ");
}

function expectedCtrForKeyword(position: number, intent: Intent): number {
    const posKey = Math.min(10, Math.round(position));
    const base = BASE_CTR_BY_POSITION[posKey] ?? BASE_CTR_FALLBACK;
    if (intent === "transactional") return base * 1.2;
    if (intent === "informational") return base * 0.85;
    return base;
}

async function fetchWithRetry(
    url: string,
    options: RequestInit,
    attempt = 1
): Promise<Response> {
    const res = await fetch(url, options);
    if (res.ok) return res;

    if ((res.status === 429 || res.status >= 500) && attempt < RETRY_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        return fetchWithRetry(url, options, attempt + 1);
    }

    const err = await res.text();
    throw new Error(`GSC API ${res.status}: ${err}`);
}

async function queryGSC(
    accessToken: string,
    siteUrl: string,
    body: Record<string, unknown>,
    minKeyLength = 2
): Promise<GscApiRow[]> {
    const allRows: GscApiRow[] = [];
    let startRow = 0;

    while (true) {
        const res = await fetchWithRetry(
            `${GSC_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ ...body, rowLimit: PAGE_SIZE, startRow }),
            }
        );

        const data = (await res.json()) as { rows?: GscApiRow[] };
        const rows: GscApiRow[] = data.rows ?? [];

        for (const row of rows) {
            if (!row.keys || row.keys.length < minKeyLength) continue;
            allRows.push(row);
        }

        if (rows.length < PAGE_SIZE) break;
        startRow += PAGE_SIZE;
    }

    return allRows;
}

function rowToKeyword(row: GscApiRow, hasDevice = false): KeywordRow {
    const result: KeywordRow = {
        keyword: normalizeKeyword(row.keys[0]),
        url: cleanUrl(row.keys[1]),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: parseFloat((row.ctr * 100).toFixed(2)),
        position: parseFloat(row.position.toFixed(1)),
    };
    if (hasDevice && row.keys[2]) {
        result.device = row.keys[2].toUpperCase() as Device;
    }
    return result;
}

export interface FetchGSCOptions {
    includeDevice?: boolean;
    dataState?: "final" | "all";
}

export async function fetchGSCKeywords(
    accessToken: string,
    siteUrl: string,
    days = 90,
    _cacheTtlSeconds?: number,
    options: FetchGSCOptions = {}
): Promise<KeywordRow[]> {
    const { includeDevice = false, dataState = "final" } = options;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const dimensions = includeDevice
        ? ["query", "page", "device"]
        : ["query", "page"];

    const rows = await queryGSC(
        accessToken,
        siteUrl,
        { startDate: fmt(startDate), endDate: fmt(endDate), dimensions, dataState },
        2
    );

    return rows.map((r) => rowToKeyword(r, includeDevice));
}

export async function fetchGSCKeywordsByDateRange(
    accessToken: string,
    siteUrl: string,
    startDate: Date,
    endDate: Date,
    options: FetchGSCOptions = {}
): Promise<KeywordRow[]> {
    const { includeDevice = false, dataState = "final" } = options;

    const dimensions = includeDevice
        ? ["query", "page", "device"]
        : ["query", "page"];

    const rows = await queryGSC(
        accessToken,
        siteUrl,
        { startDate: fmt(startDate), endDate: fmt(endDate), dimensions, dataState },
        2
    );

    return rows.map((r) => rowToKeyword(r, includeDevice));
}

export async function fetchGSCKeywordsByDevice(
    accessToken: string,
    siteUrl: string,
    days = 90
): Promise<KeywordRow[]> {
    return fetchGSCKeywords(accessToken, siteUrl, days, undefined, {
        includeDevice: true,
    });
}

export function splitByDevice(rows: KeywordRow[]): DeviceSplit {
    const split: DeviceSplit = { desktop: [], mobile: [], tablet: [] };
    for (const row of rows) {
        if (row.device === "MOBILE") split.mobile.push(row);
        else if (row.device === "TABLET") split.tablet.push(row);
        else split.desktop.push(row);
    }
    return split;
}

export function aggregateDeviceMetrics(rows: KeywordRow[]): DeviceMetrics[] {
    const byDevice = new Map<Device, KeywordRow[]>();

    for (const row of rows) {
        const device = row.device ?? "DESKTOP";
        if (!byDevice.has(device)) byDevice.set(device, []);
        byDevice.get(device)!.push(row);
    }

    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);

    return Array.from(byDevice.entries()).map(([device, deviceRows]) => {
        const clicks = deviceRows.reduce((s, r) => s + r.clicks, 0);
        const impressions = deviceRows.reduce((s, r) => s + r.impressions, 0);
        const ctr = impressions > 0
            ? parseFloat(((clicks / impressions) * 100).toFixed(2))
            : 0;
        const avgPosition = impressions > 0
            ? parseFloat(
                (deviceRows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions).toFixed(1)
            )
            : 0;

        return {
            device,
            clicks,
            impressions,
            ctr,
            avgPosition,
            clickShare: totalClicks > 0
                ? parseFloat(((clicks / totalClicks) * 100).toFixed(1))
                : 0,
            impressionShare: totalImpressions > 0
                ? parseFloat(((impressions / totalImpressions) * 100).toFixed(1))
                : 0,
        };
    }).sort((a, b) => b.impressions - a.impressions);
}

export function buildKeywordDeviceBreakdown(
    rows: KeywordRow[]
): KeywordDeviceBreakdown[] {
    const byPair = new Map<string, KeywordRow[]>();
    for (const row of rows) {
        const pairKey = `${normalizeKeyword(row.keyword)}||${cleanUrl(row.url)}`;
        if (!byPair.has(pairKey)) byPair.set(pairKey, []);
        byPair.get(pairKey)!.push(row);
    }

    const results: KeywordDeviceBreakdown[] = [];

    for (const [pairKey, pairRows] of byPair.entries()) {
        const [keyword, url] = pairKey.split("||");

        const getMetrics = (device: Device): Omit<DeviceMetrics, "device"> | null => {
            const deviceRows = pairRows.filter(
                (r) => (r.device ?? "DESKTOP") === device
            );
            if (!deviceRows.length) return null;

            const clicks = deviceRows.reduce((s, r) => s + r.clicks, 0);
            const impressions = deviceRows.reduce((s, r) => s + r.impressions, 0);
            const ctr = impressions > 0
                ? parseFloat(((clicks / impressions) * 100).toFixed(2))
                : 0;
            const avgPosition = impressions > 0
                ? parseFloat(
                    (deviceRows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions).toFixed(1)
                )
                : 0;

            const totalClicks = pairRows.reduce((s, r) => s + r.clicks, 0);
            const totalImpressions = pairRows.reduce((s, r) => s + r.impressions, 0);

            return {
                clicks,
                impressions,
                ctr,
                avgPosition,
                clickShare: totalClicks > 0
                    ? parseFloat(((clicks / totalClicks) * 100).toFixed(1))
                    : 0,
                impressionShare: totalImpressions > 0
                    ? parseFloat(((impressions / totalImpressions) * 100).toFixed(1))
                    : 0,
            };
        };

        const desktop = getMetrics("DESKTOP");
        const mobile = getMetrics("MOBILE");
        const tablet = getMetrics("TABLET");

        const hasMobileCtrGap =
            !!desktop &&
            !!mobile &&
            desktop.ctr > 0 &&
            mobile.ctr < desktop.ctr * 0.6 &&
            Math.abs(mobile.avgPosition - desktop.avgPosition) < 3;

        results.push({ keyword, url, desktop, mobile, tablet, hasMobileCtrGap });
    }

    return results.sort((a, b) => {
        const aImpr = (a.desktop?.impressions ?? 0) + (a.mobile?.impressions ?? 0);
        const bImpr = (b.desktop?.impressions ?? 0) + (b.mobile?.impressions ?? 0);
        return bImpr - aImpr;
    });
}

export async function fetchGSCSites(accessToken: string): Promise<string[]> {
    const res = await fetchWithRetry(GSC_BASE, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as { siteEntry?: { siteUrl: string }[] };
    return (data.siteEntry ?? []).map((s) => s.siteUrl);
}

export async function fetchGSCDecayData(
    accessToken: string,
    siteUrl: string
): Promise<DecayRow[]> {
    const currentEnd = new Date();
    const currentStart = new Date();
    currentStart.setDate(currentEnd.getDate() - 90);

    const previousEnd = new Date(currentStart);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - 90);

    const fetchPageRows = (start: Date, end: Date) =>
        queryGSC(accessToken, siteUrl, {
            startDate: fmt(start),
            endDate: fmt(end),
            dimensions: ["page"],
            dataState: "final",
        });

    const [currentData, previousData] = await Promise.all([
        fetchPageRows(currentStart, currentEnd),
        fetchPageRows(previousStart, previousEnd),
    ]);

    const prevMap = new Map<string, { clicks: number; impressions: number; position: number }>();
    for (const row of previousData) {
        prevMap.set(cleanUrl(row.keys[0]), {
            clicks: row.clicks,
            impressions: row.impressions,
            position: row.position,
        });
    }

    const decayRows: DecayRow[] = [];

    for (const row of currentData) {
        const url = cleanUrl(row.keys[0]);
        const curr = { clicks: row.clicks, impressions: row.impressions, position: row.position };
        const prev = prevMap.get(url);

        if (
            !prev ||
            prev.clicks < DECAY_MIN_PREV_CLICKS ||
            prev.impressions < DECAY_MIN_PREV_IMPRESSIONS
        ) {
            continue;
        }

        const clickDrop = (prev.clicks - curr.clicks) / prev.clicks;
        const impressionDrop =
            prev.impressions > 0
                ? (prev.impressions - curr.impressions) / prev.impressions
                : 0;
        const positionDrop = curr.position - prev.position;

        if (
            clickDrop > DECAY_CLICK_DROP_THRESHOLD &&
            impressionDrop < DECAY_IMPRESSION_DROP_MAX &&
            positionDrop > DECAY_POSITION_DROP_MIN
        ) {
            decayRows.push({
                url,
                currentClicks: curr.clicks,
                previousClicks: prev.clicks,
                dropPercentage: Math.round(clickDrop * 100),
            });
        }
    }

    return decayRows.sort((a, b) => b.dropPercentage - a.dropPercentage);
}

export function aggregateKeywords(rows: KeywordRow[]): AggregatedKeyword[] {
    const map = new Map<string, KeywordRow[]>();

    for (const row of rows) {
        const key = normalizeKeyword(row.keyword);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ ...row, keyword: key });
    }

    return Array.from(map.entries()).map(([keyword, urls]) => {
        const clicks = urls.reduce((s, u) => s + u.clicks, 0);
        const impressions = urls.reduce((s, u) => s + u.impressions, 0);
        const avgPosition =
            impressions > 0
                ? parseFloat(
                    (urls.reduce((s, u) => s + u.position * u.impressions, 0) / impressions).toFixed(1)
                )
                : 0;
        const ctr =
            impressions > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0;

        return {
            keyword,
            clicks,
            impressions,
            ctr,
            avgPosition,
            intent: classifyIntent(keyword),
            urls: urls.sort((a, b) => b.impressions - a.impressions),
        };
    });
}

export function clusterKeywords(aggregated: AggregatedKeyword[]): KeywordCluster[] {
    const map = new Map<string, AggregatedKeyword[]>();

    for (const kw of aggregated) {
        const key = clusterKey(kw.keyword);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(kw);
    }

    return Array.from(map.entries())
        .map(([key, keywords]) => {
            const totalClicks = keywords.reduce((s, k) => s + k.clicks, 0);
            const totalImpressions = keywords.reduce((s, k) => s + k.impressions, 0);
            const avgPosition =
                totalImpressions > 0
                    ? parseFloat(
                        (
                            keywords.reduce((s, k) => s + k.avgPosition * k.impressions, 0) /
                            totalImpressions
                        ).toFixed(1)
                    )
                    : 0;

            const intentCounts = keywords.reduce<Record<Intent, number>>(
                (acc, k) => { acc[k.intent] = (acc[k.intent] ?? 0) + k.impressions; return acc; },
                {} as Record<Intent, number>
            );
            const dominantIntent = (Object.entries(intentCounts) as [Intent, number][]).reduce(
                (a, b) => (b[1] > a[1] ? b : a)
            )[0];

            return {
                clusterKey: key,
                keywords: keywords.sort((a, b) => b.impressions - a.impressions),
                totalClicks,
                totalImpressions,
                avgPosition,
                dominantIntent,
            };
        })
        .sort((a, b) => b.totalImpressions - a.totalImpressions);
}

export function classifyIntent(keyword: string): Intent {
    const kw = keyword.toLowerCase();

    if (/\b(best|top|vs|versus|review|reviews|compare|comparison|alternatives?)\b/.test(kw)) {
        return "commercial";
    }
    if (/\b(buy|price|pricing|cost|cheap|deal|order|shop|hire|subscribe)\b/.test(kw)) {
        return "transactional";
    }
    if (/\b(how|what|why|when|who|guide|tutorial|tips|examples?)\b/.test(kw)) {
        return "informational";
    }
    return "navigational";
}

export function splitBrandKeywords(
    aggregated: AggregatedKeyword[],
    brandTerms: string[]
): BrandSplit {
    const patterns = brandTerms.map(
        (b) => new RegExp(`\\b${escapeRegex(b)}\\b`, "i")
    );

    return {
        brand: aggregated.filter((k) => patterns.some((p) => p.test(k.keyword))),
        nonBrand: aggregated.filter((k) => !patterns.some((p) => p.test(k.keyword))),
    };
}

function normaliseInput(rows: KeywordRow[] | AggregatedKeyword[]): AggregatedKeyword[] {
    if (rows.length === 0) return [];
    if ("avgPosition" in rows[0]) return rows as AggregatedKeyword[];
    return aggregateKeywords(rows as KeywordRow[]);
}

export function categoriseKeywords(rows: KeywordRow[] | AggregatedKeyword[]): CategorisedKeywords {
    const aggregated = normaliseInput(rows);

    const result: CategorisedKeywords = {
        critical: [],
        weak: [],
        improving: [],
        strong: [],
    };

    for (const kw of aggregated) {
        if (kw.avgPosition > 20 || (kw.impressions > 100 && kw.clicks === 0)) {
            result.critical.push(kw);
        } else if (kw.avgPosition > 10) {
            result.weak.push(kw);
        } else if (kw.avgPosition > 3) {
            result.improving.push(kw);
        } else {
            result.strong.push(kw);
        }
    }

    for (const bucket of Object.values(result) as AggregatedKeyword[][]) {
        bucket.sort((a, b) => b.impressions - a.impressions);
    }

    return result;
}

export function findOpportunities(
    rows: KeywordRow[] | AggregatedKeyword[],
    limit = 20
): KeywordOpportunity[] {
    const aggregated = normaliseInput(rows);
    return aggregated
        .filter(
            (kw) =>
                kw.impressions >= 10 &&
                kw.avgPosition > OPPORTUNITY_MIN_POSITION &&
                kw.impressions > OPPORTUNITY_MIN_IMPRESSIONS
        )
        .map((kw) => {
            const expectedCtr = expectedCtrForKeyword(kw.avgPosition, kw.intent);
            const expectedCtrDecimal = expectedCtr / 100;

            const potentialClicks = kw.impressions * expectedCtrDecimal;
            const ctrScore = Math.round(Math.max(0, potentialClicks - kw.clicks));

            const positionLift = Math.max(0, kw.avgPosition - 3);
            const rankScore = Math.round((kw.impressions * positionLift) / kw.avgPosition);

            const intentMultiplier =
                kw.intent === "transactional" ? 1.5
                    : kw.intent === "commercial" ? 1.3
                        : 1;

            const opportunityScore = Math.round(
                (ctrScore * 0.6 + rankScore * 0.4) * intentMultiplier
            );

            const isHighRankLowCtr =
                kw.avgPosition <= 5 &&
                kw.impressions > 100 &&
                kw.ctr < expectedCtr * 0.5;

            const ctrGapRatio = expectedCtr > 0 ? Math.max(0, 1 - kw.ctr / expectedCtr) : 0;

            let opportunityType: KeywordOpportunity["opportunityType"];
            let reason: string;

            if (isHighRankLowCtr) {
                opportunityType = "ctr-optimize";
                reason = `High ranking (#${kw.avgPosition}) but underperforming CTR (${kw.ctr}% vs ${expectedCtr.toFixed(1)}% expected) — fastest win available.`;
            } else if (kw.avgPosition > 20) {
                opportunityType = "new-content";
                reason = `Ranking #${kw.avgPosition} — a dedicated page could push this onto page 1.`;
            } else if (kw.avgPosition > 10) {
                opportunityType = "quick-win";
                reason = `Position #${kw.avgPosition} — just off page 1. Deeper content and internal links can crack the top 10.`;
            } else if (ctrGapRatio > 0.3 && kw.impressions > 100) {
                opportunityType = "ctr-optimize";
                reason = `CTR is ${kw.ctr}% vs ${expectedCtr.toFixed(1)}% expected at position #${kw.avgPosition} — rewriting title/meta could recover ~${ctrScore} clicks/period.`;
            } else {
                opportunityType = "ranking-optimize";
                reason = `Position #${kw.avgPosition} with ${kw.impressions} impressions — content improvements can lift ranking.`;
            }

            return { ...kw, opportunityScore, ctrScore, rankScore, opportunityType, reason };
        })
        .sort((a, b) => b.opportunityScore - a.opportunityScore)
        .slice(0, limit);
}

export function buildPageOpportunities(opportunities: KeywordOpportunity[]): PageOpportunity[] {
    const map = new Map<string, KeywordOpportunity[]>();

    for (const opp of opportunities) {
        if (!opp.urls.length) continue;
        const bestUrl = opp.urls.reduce((best, u) =>
            u.position < best.position ? u : best
        );
        const url = bestUrl.url;
        if (!map.has(url)) map.set(url, []);
        map.get(url)!.push(opp);
    }

    return Array.from(map.entries())
        .map(([url, keywords]) => ({
            url,
            totalOpportunityScore: keywords.reduce((s, k) => s + k.opportunityScore, 0),
            keywords: keywords.sort((a, b) => b.opportunityScore - a.opportunityScore),
        }))
        .sort((a, b) => b.totalOpportunityScore - a.totalOpportunityScore);
}

export function detectCannibalization(rows: KeywordRow[] | AggregatedKeyword[]): CannibalizationIssue[] {
    const aggregated = normaliseInput(rows);
    const issues: CannibalizationIssue[] = [];

    for (const kw of aggregated) {
        const competing = kw.urls.filter(
            (r) =>
                r.impressions > CANNIBALIZATION_MIN_IMPRESSIONS &&
                r.position <= CANNIBALIZATION_MAX_POSITION
        );
        if (competing.length <= 1) continue;

        const totalClicks = competing.reduce((acc, r) => acc + r.clicks, 0);
        const totalImpressions = competing.reduce((acc, r) => acc + r.impressions, 0);

        const sorted = [...competing].sort((a, b) => b.impressions - a.impressions);

        const bestRanked = competing.reduce((best, r) =>
            r.position < best.position ? r : best
        );
        const primaryUrl = bestRanked.url;
        const primaryClicks = bestRanked.clicks;

        const urlIntents = new Set(competing.map((r) => classifyIntent(r.keyword || kw.keyword)));
        const mixedIntent = urlIntents.size > 1;

        const clickConcentration =
            totalClicks > 0
                ? parseFloat((primaryClicks / totalClicks).toFixed(2))
                : 1;

        const positions = competing.map((r) => r.position);
        const positionSpread = parseFloat(
            (Math.max(...positions) - Math.min(...positions)).toFixed(1)
        );

        let severity: CannibalizationIssue["severity"];
        if (mixedIntent) {
            severity = "low";
        } else if (clickConcentration < 0.6 && positionSpread > 5) {
            severity = "high";
        } else if (clickConcentration < 0.8 || positionSpread > 3) {
            severity = "medium";
        } else {
            severity = "low";
        }

        let suggestedFix: CannibalizationIssue["suggestedFix"];
        if (severity === "high") {
            suggestedFix = "merge";
        } else if (positionSpread > 4) {
            suggestedFix = "canonicalize";
        } else {
            suggestedFix = "internal-link";
        }

        issues.push({
            keyword: kw.keyword,
            urls: sorted.map((r) => ({
                url: r.url,
                clicks: r.clicks,
                impressions: r.impressions,
                position: r.position,
            })),
            totalClicks,
            totalImpressions,
            primaryUrl,
            clickConcentration,
            positionSpread,
            mixedIntent,
            severity,
            suggestedFix,
        });
    }

    return issues.sort((a, b) => b.totalImpressions - a.totalImpressions);
}

export function buildRankingSummary(rows: KeywordRow[] | AggregatedKeyword[]): RankingSummary {
    const aggregated = normaliseInput(rows);
    const total = aggregated.length;
    const totalClicks = aggregated.reduce((s, k) => s + k.clicks, 0);
    const totalImpressions = aggregated.reduce((s, k) => s + k.impressions, 0);

    const avgPosition =
        totalImpressions > 0
            ? parseFloat(
                (
                    aggregated.reduce((s, k) => s + k.avgPosition * k.impressions, 0) /
                    totalImpressions
                ).toFixed(1)
            )
            : 0;

    const page1Keywords = aggregated.filter((k) => k.avgPosition <= 10);
    const top3Keywords = aggregated.filter((k) => k.avgPosition <= 3);

    const page1Count = page1Keywords.length;
    const top3Count = top3Keywords.length;
    const page1Pct = total > 0 ? Math.round((page1Count / total) * 100) : 0;
    const top3Pct = total > 0 ? Math.round((top3Count / total) * 100) : 0;

    const page1Impressions = page1Keywords.reduce((s, k) => s + k.impressions, 0);
    const page1ImpressionPct =
        totalImpressions > 0
            ? parseFloat(((page1Impressions / totalImpressions) * 100).toFixed(1))
            : 0;

    const cats = categoriseKeywords(aggregated);

    return {
        total,
        avgPosition,
        totalClicks,
        totalImpressions,
        page1Count,
        page1Pct,
        page1ImpressionPct,
        top3Count,
        top3Pct,
        criticalCount: cats.critical.length,
        weakCount: cats.weak.length,
        improvingCount: cats.improving.length,
        strongCount: cats.strong.length,
    };
}

export function buildKeywordTrends(
    current: KeywordRow[],
    previous: KeywordRow[]
): KeywordTrend[] {
    const prevAgg = new Map<string, AggregatedKeyword>();
    for (const agg of aggregateKeywords(previous)) {
        prevAgg.set(agg.keyword, agg);
    }

    return aggregateKeywords(current)
        .filter((curr) => curr.impressions >= 10)
        .map((curr) => {
            const prev = prevAgg.get(curr.keyword);

            const clickChange = prev ? curr.clicks - prev.clicks : curr.clicks;
            const impressionChange = prev ? curr.impressions - prev.impressions : curr.impressions;
            const positionChange = prev
                ? parseFloat((curr.avgPosition - prev.avgPosition).toFixed(1))
                : 0;

            let trend: KeywordTrend["trend"];
            if (clickChange > 0 && impressionChange >= 0 && positionChange < -1) {
                trend = "up";
            } else if (clickChange < 0 && (positionChange > 1 || impressionChange < 0)) {
                trend = "down";
            } else {
                trend = "stable";
            }

            return { keyword: curr.keyword, clickChange, impressionChange, positionChange, trend };
        });
}

export function detectKeywordDecay(
    current: KeywordRow[],
    previous: KeywordRow[]
): KeywordDecayRow[] {
    const prevAgg = new Map<string, AggregatedKeyword>();
    for (const agg of aggregateKeywords(previous)) {
        prevAgg.set(agg.keyword, agg);
    }

    const results: KeywordDecayRow[] = [];

    for (const curr of aggregateKeywords(current)) {
        if (curr.impressions < 10) continue;
        const prev = prevAgg.get(curr.keyword);
        if (
            !prev ||
            prev.clicks < DECAY_MIN_PREV_CLICKS ||
            prev.impressions < DECAY_MIN_PREV_IMPRESSIONS
        ) {
            continue;
        }

        const clickDrop = (prev.clicks - curr.clicks) / prev.clicks;
        const impressionDrop =
            prev.impressions > 0
                ? (prev.impressions - curr.impressions) / prev.impressions
                : 0;
        const positionDrop = curr.avgPosition - prev.avgPosition;

        const prevCtrRaw = prev.impressions > 0 ? prev.clicks / prev.impressions : 0;
        const currCtrRaw = curr.impressions > 0 ? curr.clicks / curr.impressions : 0;
        const ctrDrop = prevCtrRaw - currCtrRaw;

        const isRankingDecay =
            clickDrop > DECAY_CLICK_DROP_THRESHOLD &&
            impressionDrop < DECAY_IMPRESSION_DROP_MAX &&
            positionDrop > DECAY_POSITION_DROP_MIN;

        const isCtrDecay =
            ctrDrop > DECAY_CTR_DROP_THRESHOLD &&
            positionDrop < 1 &&
            prev.impressions >= DECAY_MIN_PREV_IMPRESSIONS;

        if (isRankingDecay || isCtrDecay) {
            results.push({
                keyword: curr.keyword,
                currentClicks: curr.clicks,
                previousClicks: prev.clicks,
                currentPosition: curr.avgPosition,
                previousPosition: prev.avgPosition,
                clickDropPct: Math.round(clickDrop * 100),
                positionDrop: parseFloat(positionDrop.toFixed(1)),
                decayType: isRankingDecay ? "ranking" : "ctr",
            });
        }
    }

    return results.sort((a, b) => b.clickDropPct - a.clickDropPct);
}

export function findContentGaps(aggregated: AggregatedKeyword[]): ContentGap[] {
    return aggregated
        .filter((kw) => {
            if (kw.impressions < CONTENT_GAP_MIN_IMPRESSIONS) return false;
            const isWeakRanking = kw.avgPosition > CONTENT_GAP_MIN_POSITION;
            const isFragmented = kw.urls.length >= CONTENT_GAP_FRAGMENTED_URL_COUNT;
            return isWeakRanking || isFragmented;
        })
        .map((kw) => ({
            keyword: kw.keyword,
            impressions: kw.impressions,
            avgPosition: kw.avgPosition,
            intent: kw.intent,
            isFragmented: kw.urls.length >= CONTENT_GAP_FRAGMENTED_URL_COUNT,
        }))
        .sort((a, b) => b.impressions - a.impressions);
}

export function findInternalLinkOpportunities(
    aggregated: AggregatedKeyword[]
): InternalLinkOpportunity[] {
    return aggregated
        .filter(
            (kw) =>
                kw.avgPosition >= INTERNAL_LINK_MIN_POSITION &&
                kw.avgPosition <= INTERNAL_LINK_MAX_POSITION &&
                kw.impressions >= INTERNAL_LINK_MIN_IMPRESSIONS
        )
        .map((kw) => {
            const bestUrl = kw.urls.reduce((best, u) =>
                u.position < best.position ? u : best
            );
            return {
                keyword: kw.keyword,
                targetUrl: bestUrl.url,
                avgPosition: kw.avgPosition,
                impressions: kw.impressions,
                clicks: kw.clicks,
            };
        })
        .sort((a, b) => b.impressions - a.impressions);
}

export function normaliseSiteUrl(domain: string): string {
    if (domain.startsWith("sc-domain:")) return domain;
    const clean = domain.replace(/\/+$/, "");
    if (clean.startsWith("http")) return `${clean}/`;
    return `https://${clean}/`;
}