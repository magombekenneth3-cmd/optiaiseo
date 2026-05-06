/**
 * src/lib/pdf/monthly-report.ts
 *
 * Generates the Monthly SEO Report PDF — premium dark design.
 * HTML templating only — no puppeteer imports here.
 * Browser lifecycle lives in ./renderer.ts.
 */

import { renderHtmlToPdf } from "./renderer";
import { esc, scoreColor, scoreBgColor, scoreBorderColor, svgScoreRing, scoreBar, baseStyles } from "./shared";
import type { WhiteLabelConfig } from "./shared";

export type { WhiteLabelConfig };

// ── Public types ──────────────────────────────────────────────────────────────

export interface MonthlyReportData {
    domain: string;
    month: string;
    seoScore: number;
    prevSeoScore: number | null;
    aeoScore: number;
    keywordsTracked: number;
    keywordsImproved: number;
    keywordsDeclined: number;
    topKeywords: Array<{ keyword: string; position: number; change: number }>;
    issuesFixed: number;
    issuesPending: number;
    competitorSummary: Array<{ domain: string; estimatedVisits: number; trend: "up" | "down" | "flat" }>;
    whiteLabel?: WhiteLabelConfig;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionHeader(title: string): string {
    return `<div class="section-header">
        <span class="section-title">${title}</span>
        <div class="section-title-line"></div>
    </div>`;
}

function trendMeta(trend: "up" | "down" | "flat"): { icon: string; label: string; color: string } {
    if (trend === "up") return { icon: "↑", label: "Growing", color: "#34d978" };
    if (trend === "down") return { icon: "↓", label: "Declining", color: "#ff5757" };
    return { icon: "→", label: "Stable", color: "#6b7280" };
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildMonthlyHtml(data: MonthlyReportData): string {
    const wl = data.whiteLabel ?? {};
    const brand = wl.companyName ?? "OptiAISEO";
    const primary = wl.primaryColor ?? "#6395ff"; // blue for monthly — distinct from audit/aeo
    const delta = data.prevSeoScore !== null ? data.seoScore - data.prevSeoScore : null;
    const col = scoreColor(data.seoScore);

    const deltaHtml = delta !== null
        ? `<div style="font-size:11px;margin-top:5px;color:${delta >= 0 ? "#34d978" : "#ff5757"};font-weight:600">
               ${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} pts vs last month
           </div>`
        : "";

    // ── Keyword rows ──
    const kwRows = data.topKeywords.length > 0
        ? data.topKeywords.map((k, i) => {
            const up = k.change > 0;
            const down = k.change < 0;
            const changeColor = up ? "#34d978" : down ? "#ff5757" : "rgba(180,180,210,0.3)";
            const changeStr = k.change === 0 ? "—" : `${up ? "▲" : "▼"} ${Math.abs(k.change)}`;
            return `<tr>
                <td style="color:rgba(180,180,210,0.4);font-size:11px;font-family:'DM Mono',monospace;width:30px">${i + 1}</td>
                <td style="font-weight:600;font-size:13px">${esc(k.keyword)}</td>
                <td style="text-align:center;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:#e4e4f0">
                    #${esc(k.position)}
                </td>
                <td style="text-align:center;color:${changeColor};font-weight:700;font-family:'DM Mono',monospace;font-size:12px">
                    ${changeStr}
                </td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="4" style="text-align:center;padding:24px;color:rgba(180,180,210,0.35)">
               No keyword data available for this period
           </td></tr>`;

    // ── Competitor rows ──
    const compRows = data.competitorSummary.length > 0
        ? data.competitorSummary.map(c => {
            const t = trendMeta(c.trend);
            return `<tr>
                <td style="font-weight:600;font-size:13px;font-family:'DM Mono',monospace">${esc(c.domain)}</td>
                <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:rgba(180,180,210,0.7)">
                    ~${c.estimatedVisits.toLocaleString()}/mo
                </td>
                <td style="text-align:center">
                    <span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${t.color}">
                        ${t.icon} ${t.label}
                    </span>
                </td>
            </tr>`;
        }).join("")
        : `<tr><td colspan="3" style="text-align:center;padding:24px;color:rgba(180,180,210,0.35)">No competitor data</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Monthly SEO Report – ${esc(data.domain)} – ${esc(data.month)}</title>
<style>
${baseStyles(primary)}
</style>
</head>
<body>

<!-- ── COVER ── -->
<div class="cover">
    <div class="cover-brand">
        <span style="font-size:13px;font-weight:800;color:${primary};letter-spacing:0.06em;text-transform:uppercase">${esc(brand)}</span>
    </div>

    <div style="display:flex;align-items:flex-start;gap:32px">
        <div style="flex:1">
            <div class="cover-title">Monthly SEO<br>Report</div>
            <div class="cover-sub">${esc(data.domain)} · ${esc(data.month)}</div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">SEO Score</div>
                    <div class="kpi-value" style="color:${col}">${esc(data.seoScore)}</div>
                    ${deltaHtml}
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">AI Visibility</div>
                    <div class="kpi-value" style="color:${scoreColor(data.aeoScore)}">${esc(data.aeoScore)}</div>
                    <div class="kpi-meta">AEO score</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Issues Fixed</div>
                    <div class="kpi-value" style="color:#34d978">${esc(data.issuesFixed)}</div>
                    <div class="kpi-meta">${esc(data.issuesPending)} pending</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Keywords ▲</div>
                    <div class="kpi-value" style="color:${primary}">${esc(data.keywordsImproved)}</div>
                    <div class="kpi-meta">${esc(data.keywordsDeclined)} declined</div>
                </div>
            </div>
        </div>

        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:8px;
                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:16px;padding:24px 28px">
            ${svgScoreRing(data.seoScore, 100)}
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4)">SEO Score</div>
        </div>
    </div>
</div>

<!-- ── KEYWORD OVERVIEW ── -->
<div style="background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(255,255,255,0.05);
            padding:16px 52px;display:flex;gap:0">
    <div style="flex:1;border-right:1px solid rgba(255,255,255,0.05);padding-right:28px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                    color:rgba(180,180,210,0.35);margin-bottom:4px">Keywords Tracked</div>
        <div style="font-size:20px;font-weight:800;color:#e4e4f0;font-family:'DM Mono',monospace">
            ${esc(data.keywordsTracked)}
        </div>
    </div>
    <div style="flex:1;padding-left:28px;border-right:1px solid rgba(255,255,255,0.05);padding-right:28px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                    color:rgba(180,180,210,0.35);margin-bottom:4px">Improved</div>
        <div style="font-size:20px;font-weight:800;color:#34d978;font-family:'DM Mono',monospace">
            ▲ ${esc(data.keywordsImproved)}
        </div>
    </div>
    <div style="flex:1;padding-left:28px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                    color:rgba(180,180,210,0.35);margin-bottom:4px">Declined</div>
        <div style="font-size:20px;font-weight:800;color:#ff5757;font-family:'DM Mono',monospace">
            ▼ ${esc(data.keywordsDeclined)}
        </div>
    </div>
</div>

<!-- ── TOP KEYWORDS ── -->
<div class="section">
    ${sectionHeader("Top Keyword Rankings")}
    <table>
        <thead>
            <tr>
                <th style="width:4%">#</th>
                <th>Keyword</th>
                <th style="text-align:center;width:14%">Position</th>
                <th style="text-align:center;width:12%">Change</th>
            </tr>
        </thead>
        <tbody>${kwRows}</tbody>
    </table>
</div>

<!-- ── COMPETITOR INTELLIGENCE ── -->
${data.competitorSummary.length > 0 ? `
<div class="section">
    ${sectionHeader("Competitor Intelligence")}
    <table>
        <thead>
            <tr>
                <th>Competitor</th>
                <th style="text-align:right;width:26%">Est. Monthly Traffic</th>
                <th style="text-align:center;width:16%">Trend</th>
            </tr>
        </thead>
        <tbody>${compRows}</tbody>
    </table>
</div>` : ""}

<!-- ── FOOTER ── -->
<div class="footer">
    <span>Generated by <span class="footer-brand">${esc(brand)}</span></span>
    <span>${esc(data.domain)} · ${esc(data.month)}</span>
</div>

</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateMonthlyReportPdf(data: MonthlyReportData): Promise<Buffer> {
    return renderHtmlToPdf(buildMonthlyHtml(data), "monthly");
}