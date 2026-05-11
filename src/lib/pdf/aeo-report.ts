import { renderHtmlToPdf } from "./renderer";
import { esc, safeUrl, scoreColor, scoreBgColor, scoreBorderColor, svgScoreRing, baseStyles } from "./shared";
import type { WhiteLabelConfig } from "./shared";


export interface AeoReportPdfData {
    domain: string;
    score: number;
    grade: string;
    citationScore: number;
    generativeShareOfVoice: number;
    topRecommendations: string[];
    multiModelResults: Record<string, number> | null;
    trend: "improving" | "stable" | "declining";
    projected90Day: number;
    topCompetitorAdvantage: string;
    createdAt: string;
    whiteLabel?: WhiteLabelConfig;
}


function trendMeta(trend: AeoReportPdfData["trend"]): { icon: string; label: string; color: string } {
    if (trend === "improving") return { icon: "↑", label: "Improving", color: "#34d978" };
    if (trend === "declining") return { icon: "↓", label: "Declining", color: "#ff5757" };
    return { icon: "→", label: "Stable", color: "#6b7280" };
}

function sectionHeader(title: string): string {
    return `<div class="section-header">
        <span class="section-title">${title}</span>
        <div class="section-title-line"></div>
    </div>`;
}

function modelBar(score: number): string {
    const pct = Math.min(100, Math.max(0, score));
    const col = scoreColor(score);
    return `<div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;height:5px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden">
            <div style="width:${pct}%;height:5px;background:${col};border-radius:3px"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${col};font-family:'Courier New',Consolas,'Liberation Mono',monospace;min-width:36px;text-align:right">${score}%</span>
    </div>`;
}


function buildAeoHtml(data: AeoReportPdfData): string {
    const wl = data.whiteLabel ?? {};
    const primary = wl.primaryColor ?? "#a78bfa";
    const brand = wl.companyName ?? "OptiAISEO";
    const client = wl.clientName ?? data.domain;
    const logoUrl = safeUrl(wl.logoUrl);
    const col = scoreColor(data.score);
    const trend = trendMeta(data.trend);
    const date = new Date(data.createdAt).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
    });

    const logoHtml = logoUrl
        ? `<img src="${esc(logoUrl)}" style="height:28px;display:block" alt="${esc(brand)}">`
        : `<span style="font-size:13px;font-weight:800;color:${primary};letter-spacing:0.06em;text-transform:uppercase">${esc(brand)}</span>`;

    const modelRows = data.multiModelResults
        ? Object.entries(data.multiModelResults).map(([model, score]) => `
            <tr>
                <td style="font-weight:600;text-transform:capitalize;font-size:12.5px">
                    <span style="display:inline-flex;align-items:center;gap:8px">
                        <span style="width:6px;height:6px;border-radius:50%;background:${scoreColor(score)};flex-shrink:0"></span>
                        ${esc(model)}
                    </span>
                </td>
                <td>${modelBar(score)}</td>
            </tr>`).join("")
        : `<tr><td colspan="2" style="text-align:center;padding:24px;color:rgba(180,180,210,0.35)">
               Model breakdown not yet available
           </td></tr>`;

    const recItems = data.topRecommendations.slice(0, 6).map((r, i) => `
        <div style="display:flex;gap:14px;align-items:flex-start;padding:13px 0;
                    border-bottom:1px solid rgba(255,255,255,0.04)">
            <div style="min-width:22px;height:22px;border-radius:50%;
                        background:${primary};color:#0c0c12;font-size:10px;font-weight:800;
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
                ${i + 1}
            </div>
            <p style="font-size:12.5px;color:rgba(228,228,240,0.8);margin:0;line-height:1.6">${esc(r)}</p>
        </div>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AEO Performance Report – ${esc(data.domain)}</title>
<style>
${baseStyles(primary)}
</style>
</head>
<body>

<!-- ── COVER ── -->
<div class="cover">
    <div class="cover-brand">${logoHtml}</div>

    <div style="display:flex;align-items:flex-start;gap:32px">
        <div style="flex:1">
            <div class="cover-title">AEO Performance<br>Report</div>
            <div class="cover-sub">${esc(client)} · ${esc(date)}</div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">AEO Score</div>
                    <div class="kpi-value" style="color:${col}">${esc(data.score)}<span style="font-size:12px;color:rgba(180,180,210,0.35)">/100</span></div>
                    <div class="kpi-meta">Grade: <span style="color:${col};font-weight:700">${esc(data.grade)}</span></div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Citation Score</div>
                    <div class="kpi-value" style="color:${scoreColor(data.citationScore)}">${esc(data.citationScore)}<span style="font-size:12px;color:rgba(180,180,210,0.35)">/100</span></div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Gen. Share of Voice</div>
                    <div class="kpi-value" style="color:${primary}">${esc(data.generativeShareOfVoice)}%</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Trajectory</div>
                    <div style="font-size:18px;font-weight:800;color:${trend.color};margin-top:4px">
                        ${trend.icon} ${trend.label}
                    </div>
                </div>
            </div>
        </div>

        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:8px;
                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:16px;padding:24px 28px">
            ${svgScoreRing(data.score, 100)}
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4)">AEO Score</div>
        </div>
    </div>
</div>

<!-- ── FORECAST ── -->
<div class="section">
    ${sectionHeader("90-Day AI Visibility Forecast")}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:12px;padding:20px 22px;border-left:3px solid ${primary}">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4);margin-bottom:10px">Projected Citation Rate</div>
            <div style="font-size:32px;font-weight:800;color:${primary};font-family:'Courier New',Consolas,'Liberation Mono',monospace;line-height:1">
                ${esc(data.projected90Day)}%
            </div>
            <div style="font-size:11px;color:rgba(180,180,210,0.45);margin-top:5px">in 90 days</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:12px;padding:20px 22px">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4);margin-bottom:10px">Competitor Landscape</div>
            <p style="font-size:12.5px;color:rgba(228,228,240,0.7);line-height:1.6;margin:0">
                ${esc(data.topCompetitorAdvantage)}
            </p>
        </div>
    </div>
</div>

<!-- ── MODEL BREAKDOWN ── -->
<div class="section">
    ${sectionHeader("Citation Rate by AI Engine")}
    <table>
        <thead>
            <tr>
                <th style="width:35%">Engine</th>
                <th>Citation Rate</th>
            </tr>
        </thead>
        <tbody>${modelRows}</tbody>
    </table>
</div>

<!-- ── RECOMMENDATIONS ── -->
${data.topRecommendations.length > 0 ? `
<div class="section">
    ${sectionHeader("Top Recommendations")}
    <div style="margin-top:-4px">
        ${recItems}
    </div>
</div>` : ""}

<!-- ── FOOTER ── -->
<div class="footer">
    <span>Generated by <span class="footer-brand">${esc(brand)}</span></span>
    <span>${esc(data.domain)} · ${esc(date)}</span>
</div>

</body>
</html>`;
}


export async function generateAeoReportPdf(data: AeoReportPdfData): Promise<Buffer> {
    return renderHtmlToPdf(buildAeoHtml(data), "aeo");
}