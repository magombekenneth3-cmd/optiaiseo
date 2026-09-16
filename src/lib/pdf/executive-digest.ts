/**
 * Executive Digest PDF — unified 4-page report combining:
 *   Page 1: Executive Performance (SEO + AEO KPIs, score rings, trends)
 *   Page 2: AEO Engine Intelligence (per-engine bar chart, Google AIO, categories)
 *   Page 3: Keyword Intelligence + Competitor Landscape
 *   Page 4: Actions, Issues Summary & Data Provenance
 *
 * Data truthfulness rules:
 *   - Unavailable engines render as "— Unavailable" or "— Not configured", never 0%
 *   - Google AIO eligibility is distinct from observed SERP citation
 *   - All data sources declare their snapshot date in the provenance section
 *   - White-label failures are non-fatal (fallback to OptiAISEO branding)
 */

import { renderHtmlToPdf } from "./renderer";
import {
    esc,
    safeUrl,
    scoreColor,
    svgScoreRing,
    svgHorizontalBarChart,
    svgSparkline,
    baseStyles,
} from "./shared";
import type { WhiteLabelConfig } from "./shared";
import type {
    ReportPeriod,
    AeoEngineMetric,
    GoogleAioMetric,
    TrendDirection,
    DataSourceProvenance,
} from "./report-types";
import {
    hasDisplayableScore,
    unavailableLabel,
    deltaIndicator,
    deltaColor,
} from "./report-types";

// ─── Data interface ─────────────────────────────────────────────────────────

export interface ExecutiveDigestData {
    // Client & branding
    domain: string;
    whiteLabel?: WhiteLabelConfig;
    reportPeriod: ReportPeriod;

    // Data provenance — displayed as inline annotations
    dataSources: DataSourceProvenance[];

    // SEO metrics
    seoScore: number;
    prevSeoScore: number | null;
    issuesFixed: number;
    issuesPending: number;
    categoryScores?: Record<string, number>;

    // AEO metrics — truthful per-engine breakdown
    aeoScore: number;
    prevAeoScore: number | null;
    citationRate: number;
    generativeShareOfVoice: number;
    aeoEngineBreakdown: AeoEngineMetric[];
    googleAio: GoogleAioMetric;
    aeoGrade: string;
    aeoTrend: TrendDirection;

    // GSC keyword intelligence
    keywordsTracked: number;
    keywordsImproved: number;
    keywordsDeclined: number;
    topKeywords: Array<{
        keyword: string;
        position: number;
        change: number;
        clicks: number;
    }>;

    // Competitor landscape
    competitorSummary: Array<{
        domain: string;
        estimatedVisits: number;
        trend: "up" | "down" | "flat";
    }>;

    // Actionable recommendations
    topRecommendations: string[];
    createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function trendMeta(trend: TrendDirection): { icon: string; label: string; color: string } {
    if (trend === "improving") return { icon: "↑", label: "Improving", color: "#34d978" };
    if (trend === "declining") return { icon: "↓", label: "Declining", color: "#ff5757" };
    return { icon: "→", label: "Stable", color: "#6b7280" };
}

function sectionHeader(title: string, primary: string): string {
    return `<div class="section-header">
        <div class="section-title-accent" style="background:${primary}"></div>
        <span class="section-title">${title}</span>
        <div class="section-title-line"></div>
    </div>`;
}

function resolveWhiteLabel(wl?: WhiteLabelConfig): {
    primary: string;
    brand: string;
    logoHtml: string;
} {
    const raw = wl ?? {};
    // Validate primary color — fallback if invalid
    let primary = "#a78bfa";
    if (raw.primaryColor) {
        // Basic CSS color validation — hex, rgb, hsl, named
        const isValid = /^#[0-9a-fA-F]{3,8}$/.test(raw.primaryColor)
            || /^(rgb|hsl)a?\(/.test(raw.primaryColor)
            || /^[a-z]{3,20}$/i.test(raw.primaryColor);
        if (isValid) primary = raw.primaryColor;
    }

    const brand = raw.companyName || "OptiAISEO";
    const logoUrl = safeUrl(raw.logoUrl);

    // Logo with dual fallback (review item #6):
    //   1. onerror → hide img, show text (handles invalid URLs, 404s)
    //   2. Timeout via inline script → if load hasn't fired in 3s, trigger onerror
    //   This prevents a hanging external request from delaying PDF generation.
    //   Puppeteer's navigation timeout also bounds total page load.
    const logoHtml = logoUrl
        ? `<img id="wl-logo" src="${esc(logoUrl)}" style="height:28px;display:block"
             alt="${esc(brand)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"
             onload="clearTimeout(window.__logoTimer)">
           <span style="display:none;font-size:13px;font-weight:800;color:${primary};letter-spacing:0.06em;text-transform:uppercase">${esc(brand)}</span>
           <script>window.__logoTimer=setTimeout(function(){var l=document.getElementById('wl-logo');if(l&&!l.complete){l.onerror()}},3000)</script>`
        : `<span style="font-size:13px;font-weight:800;color:${primary};letter-spacing:0.06em;text-transform:uppercase">${esc(brand)}</span>`;

    return { primary, brand, logoHtml };
}

function competitorTrendIcon(trend: "up" | "down" | "flat"): { icon: string; color: string } {
    if (trend === "up") return { icon: "▲", color: "#34d978" };
    if (trend === "down") return { icon: "▼", color: "#ff5757" };
    return { icon: "→", color: "rgba(180,180,210,0.4)" };
}

// ─── HTML builder ───────────────────────────────────────────────────────────

function buildExecutiveDigestHtml(data: ExecutiveDigestData): string {
    const { primary, brand, logoHtml } = resolveWhiteLabel(data.whiteLabel);
    const trend = trendMeta(data.aeoTrend);
    const seoCol = scoreColor(data.seoScore);
    const aeoCol = scoreColor(data.aeoScore);

    // ── Page 1: Executive Performance ──────────────────────────────────

    const page1 = `
<div class="cover">
    <div class="cover-brand">${logoHtml}</div>

    <div style="display:flex;align-items:flex-start;gap:32px">
        <div style="flex:1">
            <div class="cover-title">Executive Performance<br>Digest</div>
            <div class="cover-sub">${esc(data.domain)} · ${esc(data.reportPeriod.label)}</div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">SEO Score</div>
                    <div class="kpi-value" style="color:${seoCol}">${esc(data.seoScore)}<span style="font-size:12px;color:rgba(180,180,210,0.35)">/100</span></div>
                    <div class="kpi-meta">${deltaIndicator(data.seoScore, data.prevSeoScore)}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">AEO Score</div>
                    <div class="kpi-value" style="color:${aeoCol}">${esc(data.aeoScore)}<span style="font-size:12px;color:rgba(180,180,210,0.35)">/100</span></div>
                    <div class="kpi-meta">Grade: <span style="color:${aeoCol};font-weight:700">${esc(data.aeoGrade)}</span></div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Citation Rate</div>
                    <div class="kpi-value" style="color:${primary}">${esc(data.citationRate)}%</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Keywords</div>
                    <div class="kpi-value" style="color:${primary}">${esc(data.keywordsTracked)}</div>
                    <div class="kpi-meta" style="color:#34d978">▲ ${esc(data.keywordsImproved)} improved</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Trajectory</div>
                    <div style="font-size:18px;font-weight:800;color:${trend.color};margin-top:4px">
                        ${trend.icon} ${trend.label}
                    </div>
                </div>
            </div>
        </div>

        <div style="flex-shrink:0;display:flex;gap:16px;position:relative;z-index:1">
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;
                        background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                        border-radius:16px;padding:20px 22px">
                ${svgScoreRing(data.seoScore, 90)}
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                            color:rgba(180,180,210,0.4)">SEO</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:6px;
                        background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                        border-radius:16px;padding:20px 22px">
                ${svgScoreRing(data.aeoScore, 90)}
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                            color:rgba(180,180,210,0.4)">AEO</div>
            </div>
        </div>
    </div>
</div>`;

    // ── Page 2: AEO Engine Intelligence ───────────────────────────────

    // Build engine rows — respect provider status
    const engineBarData = data.aeoEngineBreakdown
        .filter(m => hasDisplayableScore(m))
        .map(m => ({ label: m.engine, value: m.score ?? 0 }));

    const unavailableEngines = data.aeoEngineBreakdown
        .filter(m => !hasDisplayableScore(m))
        .map(m => `<div style="display:flex;justify-content:space-between;align-items:center;
                    padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.035)">
            <span style="font-size:11px;font-weight:600;color:rgba(228,228,240,0.5)">${esc(m.engine)}</span>
            <span style="font-size:11px;color:rgba(180,180,210,0.35);font-style:italic">${unavailableLabel(m.status)}</span>
        </div>`)
        .join("");

    // Engine delta annotations
    const engineDeltas = data.aeoEngineBreakdown
        .filter(m => hasDisplayableScore(m) && m.previousScore !== null)
        .map(m => `<span style="font-size:10px;color:${deltaColor(m.score, m.previousScore)};margin-right:14px">
            ${esc(m.engine)}: ${deltaIndicator(m.score, m.previousScore)}</span>`)
        .join("");

    // Google AIO box
    const aioObservedHtml = data.googleAio.hasObservedOverview === null
        ? `<span style="color:rgba(180,180,210,0.35);font-style:italic">— Not observed</span>`
        : data.googleAio.hasObservedOverview
            ? data.googleAio.brandMentionedInOverview
                ? `<span style="color:#34d978">✓ Brand mentioned</span>`
                : `<span style="color:#f5a623">✓ Present (brand not cited)</span>`
            : `<span style="color:rgba(180,180,210,0.35)">Not in AI Overview</span>`;

    // Category scores as horizontal bars
    const categoryBarData = data.categoryScores
        ? Object.entries(data.categoryScores)
            .filter(([, v]) => typeof v === "number")
            .sort(([, a], [, b]) => b - a)
            .map(([k, v]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), value: Math.round(v) }))
        : [];

    const page2 = `
<div class="section" style="page-break-before:always">
    ${sectionHeader("Citation Rate by AI Engine", primary)}

    ${engineBarData.length > 0 ? svgHorizontalBarChart(engineBarData) : ""}

    ${unavailableEngines ? `<div style="margin-top:12px">${unavailableEngines}</div>` : ""}

    ${engineDeltas ? `<div style="margin-top:12px;padding:10px 14px;
        background:rgba(255,255,255,0.025);border-radius:8px;
        border:1px solid rgba(255,255,255,0.05)">${engineDeltas}</div>` : ""}
</div>

<div class="section">
    ${sectionHeader("Google AI Overview", primary)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:12px;padding:18px 20px;border-left:3px solid ${primary}">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4);margin-bottom:8px">Eligibility Score</div>
            <div style="font-size:28px;font-weight:800;color:${scoreColor(data.googleAio.eligibilityScore)};
                        font-family:'Courier New',Consolas,'Liberation Mono',monospace;line-height:1">
                ${esc(data.googleAio.eligibilityScore)}%
            </div>
            <div style="font-size:10px;color:rgba(180,180,210,0.35);margin-top:4px">On-page signal analysis</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:12px;padding:18px 20px">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4);margin-bottom:8px">Observed Citation</div>
            <div style="font-size:14px;font-weight:600;margin-top:10px">${aioObservedHtml}</div>
        </div>
    </div>
</div>

${categoryBarData.length > 0 ? `
<div class="section">
    ${sectionHeader("SEO Category Breakdown", primary)}
    ${svgHorizontalBarChart(categoryBarData)}
</div>` : ""}`;

    // ── Page 3: Keyword Intelligence + Competitors ────────────────────

    const keywordRows = data.topKeywords.slice(0, 12).map(kw => {
        const changeCol = kw.change > 0 ? "#34d978" : kw.change < 0 ? "#ff5757" : "rgba(180,180,210,0.4)";
        const changeStr = kw.change > 0 ? `▲ ${kw.change}` : kw.change < 0 ? `▼ ${Math.abs(kw.change)}` : "→";
        return `<tr>
            <td style="font-weight:600">${esc(kw.keyword)}</td>
            <td style="text-align:center;font-family:'Courier New',monospace;font-weight:700">${kw.position}</td>
            <td style="text-align:center;color:${changeCol};font-weight:700;font-size:11px">${changeStr}</td>
            <td style="text-align:right;font-family:'Courier New',monospace">${kw.clicks.toLocaleString()}</td>
        </tr>`;
    }).join("");

    const competitorRows = data.competitorSummary.slice(0, 8).map(c => {
        const t = competitorTrendIcon(c.trend);
        return `<tr>
            <td style="font-weight:600">${esc(c.domain)}</td>
            <td style="text-align:right;font-family:'Courier New',monospace">${c.estimatedVisits.toLocaleString()}</td>
            <td style="text-align:center;color:${t.color};font-weight:700">${t.icon}</td>
        </tr>`;
    }).join("");

    const page3 = `
<div class="section" style="page-break-before:always">
    ${sectionHeader("Keyword Intelligence", primary)}
    <div style="display:flex;gap:10px;margin-bottom:20px">
        <div class="kpi-card" style="flex:1">
            <div class="kpi-label">Tracked</div>
            <div class="kpi-value" style="color:${primary};font-size:22px">${esc(data.keywordsTracked)}</div>
        </div>
        <div class="kpi-card" style="flex:1">
            <div class="kpi-label">Improved</div>
            <div class="kpi-value" style="color:#34d978;font-size:22px">${esc(data.keywordsImproved)}</div>
        </div>
        <div class="kpi-card" style="flex:1">
            <div class="kpi-label">Declined</div>
            <div class="kpi-value" style="color:#ff5757;font-size:22px">${esc(data.keywordsDeclined)}</div>
        </div>
    </div>

    ${data.topKeywords.length > 0 ? `
    <table>
        <thead><tr>
            <th>Keyword</th>
            <th style="text-align:center">Position</th>
            <th style="text-align:center">Change</th>
            <th style="text-align:right">Clicks</th>
        </tr></thead>
        <tbody>${keywordRows}</tbody>
    </table>` : `<p style="text-align:center;color:rgba(180,180,210,0.35);padding:24px">
        No keyword data available for this period.</p>`}
</div>

${data.competitorSummary.length > 0 ? `
<div class="section">
    ${sectionHeader("Competitor Landscape", primary)}
    <table>
        <thead><tr>
            <th>Competitor</th>
            <th style="text-align:right">Est. Visits</th>
            <th style="text-align:center">Trend</th>
        </tr></thead>
        <tbody>${competitorRows}</tbody>
    </table>
</div>` : ""}`;

    // ── Page 4: Actions & Data Provenance ─────────────────────────────

    const recItems = data.topRecommendations.slice(0, 8).map((r, i) => `
        <div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;
                    border-bottom:1px solid rgba(255,255,255,0.04)">
            <div style="min-width:22px;height:22px;border-radius:50%;
                        background:${primary};color:#0c0c12;font-size:10px;font-weight:800;
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
                ${i + 1}
            </div>
            <p style="font-size:12.5px;color:rgba(228,228,240,0.8);margin:0;line-height:1.6">${esc(r)}</p>
        </div>`).join("");

    const provenanceRows = data.dataSources.map(ds => {
        const dateStr = new Date(ds.snapshotDate).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
        });
        const staleTag = ds.isStale
            ? ` <span style="color:#f5a623;font-size:9px;font-weight:700;text-transform:uppercase;
                        background:rgba(245,166,35,0.12);padding:1px 5px;border-radius:3px;margin-left:6px">Stale</span>`
            : "";
        return `<div style="display:flex;justify-content:space-between;padding:6px 0;
                    border-bottom:1px solid rgba(255,255,255,0.03)">
            <span style="font-size:11px;color:rgba(228,228,240,0.6)">${esc(ds.source)}</span>
            <span style="font-size:11px;color:rgba(180,180,210,0.4)">${dateStr}${staleTag}</span>
        </div>`;
    }).join("");

    const page4 = `
${data.topRecommendations.length > 0 ? `
<div class="section" style="page-break-before:always">
    ${sectionHeader("Priority Recommendations", primary)}
    <div style="margin-top:-4px">${recItems}</div>
</div>` : ""}

<div class="section">
    ${sectionHeader("Issues Summary", primary)}
    <div style="display:flex;gap:12px">
        <div class="kpi-card" style="flex:1;border-left:3px solid #34d978">
            <div class="kpi-label">Fixed</div>
            <div class="kpi-value" style="color:#34d978;font-size:22px">${esc(data.issuesFixed)}</div>
        </div>
        <div class="kpi-card" style="flex:1;border-left:3px solid #f5a623">
            <div class="kpi-label">Pending</div>
            <div class="kpi-value" style="color:#f5a623;font-size:22px">${esc(data.issuesPending)}</div>
        </div>
    </div>
</div>

${data.dataSources.length > 0 ? `
<div class="section">
    ${sectionHeader("Data Source Provenance", primary)}
    <p style="font-size:10px;color:rgba(180,180,210,0.35);margin-bottom:12px">
        Snapshot dates for each data source used in this report.
    </p>
    ${provenanceRows}
</div>` : ""}`;

    // ── Footer ────────────────────────────────────────────────────────

    const dateStr = new Date(data.createdAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
    });

    const footer = `
<div class="footer">
    <span>Generated by <span class="footer-brand">${esc(brand)}</span></span>
    <span>${esc(data.domain)} · ${esc(dateStr)}</span>
</div>`;

    // ── Assemble ──────────────────────────────────────────────────────

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Executive Digest – ${esc(data.domain)}</title>
<style>
${baseStyles(primary)}
</style>
</head>
<body>
${page1}
${page2}
${page3}
${page4}
${footer}
</body>
</html>`;
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** Build the full HTML string (exported for HTML-only fallback). */
export { buildExecutiveDigestHtml };

/** Generate a PDF buffer of the Executive Digest. */
export async function generateExecutiveDigestPdf(data: ExecutiveDigestData): Promise<Buffer> {
    return renderHtmlToPdf(buildExecutiveDigestHtml(data), "executive-digest");
}
