/**
 * src/lib/pdf/audit-report.ts
 *
 * Generates the SEO Audit PDF — premium dark design.
 * HTML templating only — no puppeteer imports here.
 * Browser lifecycle lives in ./renderer.ts.
 */

import { renderHtmlToPdf } from "./renderer";
import {
    esc, safeUrl, scoreColor, scoreBgColor, scoreBorderColor,
    severityColor, svgScoreRing, scoreBar, baseStyles,
} from "./shared";
import type { WhiteLabelConfig } from "./shared";

export type { WhiteLabelConfig };

// ── Public types ──────────────────────────────────────────────────────────────

export interface AuditFinding {
    category: string;
    title: string;
    /** "critical" | "high" | "medium" | "low" */
    severity: string;
    description: string;
    recommendation?: string;
}

export interface AuditVitals {
    lcp?: number | null;
    cls?: number | null;
    inp?: number | null;
}

export interface AuditReportData {
    domain: string;
    score: number;
    createdAt: string;
    findings: AuditFinding[];
    categoryScores?: Record<string, number>;
    vitals?: AuditVitals;
    whiteLabel?: WhiteLabelConfig;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
    basics: "◈", "on-page": "◎", onpage: "◎", technical: "⌬",
    "off-page": "◇", offpage: "◇", schema: "⬡",
    accessibility: "⊙", keywords: "◈", social: "◯", local: "◈",
};

function vitalLabel(metric: "lcp" | "cls" | "inp", value: number): { label: string; color: string } {
    if (metric === "lcp") {
        if (value <= 2.5) return { label: "Good", color: "#34d978" };
        if (value <= 4.0) return { label: "Needs work", color: "#f5a623" };
        return { label: "Poor", color: "#ff5757" };
    }
    if (metric === "cls") {
        if (value <= 0.1) return { label: "Good", color: "#34d978" };
        if (value <= 0.25) return { label: "Needs work", color: "#f5a623" };
        return { label: "Poor", color: "#ff5757" };
    }
    if (value <= 200) return { label: "Good", color: "#34d978" };
    if (value <= 500) return { label: "Needs work", color: "#f5a623" };
    return { label: "Poor", color: "#ff5757" };
}

function formatVitalValue(metric: "lcp" | "cls" | "inp", value: number): string {
    if (metric === "lcp") return `${value.toFixed(1)}s`;
    if (metric === "cls") return value.toFixed(3);
    return `${Math.round(value)}ms`;
}

function sectionHeader(title: string): string {
    return `<div class="section-header">
        <span class="section-title">${title}</span>
        <div class="section-title-line"></div>
    </div>`;
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildAuditHtml(data: AuditReportData): string {
    const wl = data.whiteLabel ?? {};
    const primary = wl.primaryColor ?? "#34d978";
    const brand = wl.companyName ?? "OptiAISEO";
    const client = wl.clientName ?? data.domain;
    const logoUrl = safeUrl(wl.logoUrl);
    const col = scoreColor(data.score);

    const criticalCount = data.findings.filter(f => ["critical", "high"].includes(f.severity.toLowerCase())).length;
    const warnCount = data.findings.filter(f => f.severity.toLowerCase() === "medium").length;
    const date = new Date(data.createdAt).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
    });

    // ── Logo / Brand ──
    const logoHtml = logoUrl
        ? `<img src="${esc(logoUrl)}" style="height:28px;display:block" alt="${esc(brand)}">`
        : `<span style="font-size:13px;font-weight:800;color:${primary};letter-spacing:0.06em;text-transform:uppercase">${esc(brand)}</span>`;

    // ── Category scores grid ──
    const catEntries = Object.entries(data.categoryScores ?? {});
    const categoryGrid = catEntries.length > 0 ? `
    <div class="section">
        ${sectionHeader("Category Scores")}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            ${catEntries.map(([cat, score]) => {
        const c = scoreColor(score);
        const bg = scoreBgColor(score);
        const bdr = scoreBorderColor(score);
        const icon = CATEGORY_ICONS[cat.toLowerCase()] ?? "◈";
        return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                            border-radius:10px;padding:14px 16px;position:relative;overflow:hidden">
                    <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:10px">
                        <span style="font-size:12px;color:rgba(180,180,210,0.4)">${icon}</span>
                    </div>
                    <div style="font-size:24px;font-weight:800;color:${c};font-family:'DM Mono',monospace;line-height:1">${score}</div>
                    <div style="margin-top:6px">${scoreBar(score, 80, 3)}</div>
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;
                                color:rgba(180,180,210,0.4);margin-top:7px;capitalize">${esc(cat.replace(/-/g, " "))}</div>
                </div>`;
    }).join("")}
        </div>
    </div>` : "";

    // ── Core Web Vitals ──
    const v = data.vitals ?? {};
    const hasVitals = v.lcp != null || v.cls != null || v.inp != null;
    const vitalsHtml = hasVitals ? `
    <div style="background:rgba(0,0,0,0.25);border-bottom:1px solid rgba(255,255,255,0.05);
                padding:16px 52px;display:flex;align-items:center;gap:36px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;
                     color:rgba(180,180,210,0.35);white-space:nowrap">Core Web Vitals</span>
        ${v.lcp != null ? (() => {
            const s = vitalLabel("lcp", v.lcp!); return `
        <div style="display:flex;align-items:baseline;gap:8px">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);font-family:'DM Mono',monospace">LCP</span>
            <span style="font-size:15px;font-weight:800;color:${s.color};font-family:'DM Mono',monospace">${formatVitalValue("lcp", v.lcp!)}</span>
            <span style="font-size:10px;color:${s.color};opacity:0.65">${s.label}</span>
        </div>`;
        })() : ""}
        ${v.cls != null ? (() => {
            const s = vitalLabel("cls", v.cls!); return `
        <div style="display:flex;align-items:baseline;gap:8px">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);font-family:'DM Mono',monospace">CLS</span>
            <span style="font-size:15px;font-weight:800;color:${s.color};font-family:'DM Mono',monospace">${formatVitalValue("cls", v.cls!)}</span>
            <span style="font-size:10px;color:${s.color};opacity:0.65">${s.label}</span>
        </div>`;
        })() : ""}
        ${v.inp != null ? (() => {
            const s = vitalLabel("inp", v.inp!); return `
        <div style="display:flex;align-items:baseline;gap:8px">
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);font-family:'DM Mono',monospace">INP</span>
            <span style="font-size:15px;font-weight:800;color:${s.color};font-family:'DM Mono',monospace">${formatVitalValue("inp", v.inp!)}</span>
            <span style="font-size:10px;color:${s.color};opacity:0.65">${s.label}</span>
        </div>`;
        })() : ""}
    </div>` : "";

    // ── Findings table ──
    const groupedFindings = data.findings.reduce<Record<string, AuditFinding[]>>((acc, f) => {
        const cat = f.category || "General";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(f);
        return acc;
    }, {});

    const findingsHtml = data.findings.length === 0
        ? `<tr><td colspan="4" style="text-align:center;padding:32px;color:rgba(180,180,210,0.4)">
               <span style="font-size:22px;display:block;margin-bottom:8px">✓</span>
               No issues found — site is well-optimised
           </td></tr>`
        : data.findings.map(f => {
            const sev = severityColor(f.severity);
            return `<tr>
                <td style="font-size:11px;color:rgba(180,180,210,0.45);font-weight:500;white-space:nowrap">
                    ${esc(f.category)}
                </td>
                <td style="font-weight:600;color:#e4e4f0;font-size:12.5px">${esc(f.title)}</td>
                <td>
                    <span class="badge" style="background:${sev.bg};color:${sev.fg};border-color:${sev.border}">
                        <span class="badge-dot" style="background:${sev.fg}"></span>
                        ${esc(f.severity)}
                    </span>
                </td>
                <td style="font-size:11.5px;color:rgba(180,180,210,0.6);max-width:240px">${esc(f.description)}</td>
            </tr>`;
        }).join("");

    // ── Summary stats bar ──
    const summaryBar = `
    <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.2)">
        <div style="flex:1;padding:20px 24px;border-right:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);margin-bottom:5px">Total Findings</div>
            <div style="font-size:22px;font-weight:800;color:#e4e4f0;font-family:'DM Mono',monospace">${data.findings.length}</div>
        </div>
        <div style="flex:1;padding:20px 24px;border-right:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);margin-bottom:5px">Critical</div>
            <div style="font-size:22px;font-weight:800;color:#ff5757;font-family:'DM Mono',monospace">${criticalCount}</div>
        </div>
        <div style="flex:1;padding:20px 24px;border-right:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);margin-bottom:5px">Warnings</div>
            <div style="font-size:22px;font-weight:800;color:#f5a623;font-family:'DM Mono',monospace">${warnCount}</div>
        </div>
        <div style="flex:1;padding:20px 24px">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(180,180,210,0.4);margin-bottom:5px">Score</div>
            <div style="font-size:22px;font-weight:800;color:${col};font-family:'DM Mono',monospace">${data.score}<span style="font-size:12px;color:rgba(180,180,210,0.35)">/100</span></div>
        </div>
    </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SEO Audit Report – ${esc(data.domain)}</title>
<style>
${baseStyles(primary)}
</style>
</head>
<body>

<!-- ── COVER ── -->
<div class="cover">
    <div class="cover-brand">
        ${logoHtml}
    </div>

    <div style="display:flex;align-items:flex-start;gap:32px">
        <div style="flex:1">
            <div class="cover-title">SEO Audit<br>Report</div>
            <div class="cover-sub">Prepared for ${esc(client)} · ${esc(date)}</div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">Domain</div>
                    <div style="font-size:13px;font-weight:600;color:#e4e4f0;margin-top:3px;font-family:'DM Mono',monospace">${esc(data.domain)}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Audit Date</div>
                    <div style="font-size:13px;font-weight:600;color:#e4e4f0;margin-top:3px">${esc(date)}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Critical Issues</div>
                    <div class="kpi-value" style="color:#ff5757">${criticalCount}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Warnings</div>
                    <div class="kpi-value" style="color:#f5a623">${warnCount}</div>
                </div>
            </div>
        </div>

        <!-- Score ring -->
        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:8px;
                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:16px;padding:24px 28px">
            ${svgScoreRing(data.score, 100)}
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4)">Overall Score</div>
        </div>
    </div>
</div>

${vitalsHtml}
${summaryBar}
${categoryGrid}

<!-- ── FINDINGS ── -->
<div class="section">
    ${sectionHeader(`All Findings (${data.findings.length})`)}
    <table>
        <thead>
            <tr>
                <th style="width:13%">Category</th>
                <th style="width:28%">Issue</th>
                <th style="width:10%">Severity</th>
                <th>Description</th>
            </tr>
        </thead>
        <tbody>${findingsHtml}</tbody>
    </table>
</div>

<!-- ── FOOTER ── -->
<div class="footer">
    <span>Generated by <span class="footer-brand">${esc(brand)}</span></span>
    <span>${esc(data.domain)} · ${esc(date)}</span>
</div>

</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateAuditReportPdf(data: AuditReportData): Promise<Buffer> {
    return renderHtmlToPdf(buildAuditHtml(data), "audit");
}