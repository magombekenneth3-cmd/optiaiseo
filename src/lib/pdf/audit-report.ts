import { renderHtmlToPdf } from "./renderer";
import {
    esc, safeUrl, scoreColor, scoreBgColor, scoreBorderColor,
    severityColor, svgScoreRing, scoreBar, baseStyles,
} from "./shared";
import type { WhiteLabelConfig } from "./shared";

export type { WhiteLabelConfig };

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

const CATEGORY_ICONS: Record<string, string> = {
    basics: "◈", "on-page": "◎", onpage: "◎", technical: "⌬",
    "off-page": "◇", offpage: "◇", schema: "⬡",
    accessibility: "⊙", keywords: "◈", social: "◯", local: "◈",
    performance: "◎", security: "⌬", content: "◎", links: "◇",
};

const SEVERITY_ORDER: Record<string, number> = {
    critical: 0, high: 1, medium: 2, low: 3,
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

function sectionHeader(title: string, accent?: string): string {
    return `<div class="section-header">
        <div class="section-title-accent" style="background:${accent ?? "#34d978"}"></div>
        <span class="section-title">${title}</span>
        <div class="section-title-line"></div>
    </div>`;
}

function grade(score: number): string {
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    if (score >= 50) return "D";
    return "F";
}

function gradeLabel(score: number): string {
    if (score >= 80) return "Excellent";
    if (score >= 65) return "Good";
    if (score >= 50) return "Needs Work";
    return "Critical";
}

function buildAuditHtml(data: AuditReportData): string {
    const wl = data.whiteLabel ?? {};
    const primary = wl.primaryColor ?? "#34d978";
    const brand = wl.companyName ?? "OptiAISEO";
    const client = wl.clientName ?? data.domain;
    const logoUrl = safeUrl(wl.logoUrl);
    const col = scoreColor(data.score);
    const g = grade(data.score);
    const gl = gradeLabel(data.score);

    const criticalCount = data.findings.filter(f => f.severity.toLowerCase() === "critical").length;
    const highCount     = data.findings.filter(f => f.severity.toLowerCase() === "high").length;
    const warnCount     = data.findings.filter(f => f.severity.toLowerCase() === "medium").length;
    const lowCount      = data.findings.filter(f => f.severity.toLowerCase() === "low").length;
    const urgentCount   = criticalCount + highCount;

    const date = new Date(data.createdAt).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
    });

    const logoHtml = logoUrl
        ? `<img src="${esc(logoUrl)}" style="height:26px;display:block" alt="${esc(brand)}">`
        : `<span style="font-size:12px;font-weight:800;color:${primary};letter-spacing:0.08em;text-transform:uppercase">${esc(brand)}</span>`;

    // ── Category grid ─────────────────────────────────────────────────────────
    const catEntries = Object.entries(data.categoryScores ?? {})
        .sort(([, a], [, b]) => a - b); // worst first

    const categoryGrid = catEntries.length > 0 ? `
    <div class="section">
        ${sectionHeader("Category Breakdown", primary)}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
            ${catEntries.map(([cat, score]) => {
        const c = scoreColor(score);
        const bg = scoreBgColor(score);
        const bdr = scoreBorderColor(score);
        const icon = CATEGORY_ICONS[cat.toLowerCase()] ?? "◈";
        const g2 = grade(score);
        return `<div style="background:rgba(255,255,255,0.025);border:1px solid ${bdr};
                            border-radius:12px;padding:16px 18px;position:relative;overflow:hidden">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
                        <span style="font-size:18px;color:rgba(180,180,210,0.25)">${icon}</span>
                        <div style="background:${bg};border:1px solid ${bdr};border-radius:8px;
                                    padding:3px 8px;font-size:11px;font-weight:800;color:${c};
                                    font-family:'Courier New',Consolas,monospace">${g2}</div>
                    </div>
                    <div style="font-size:26px;font-weight:800;color:${c};
                                font-family:'Courier New',Consolas,monospace;line-height:1">${score}</div>
                    <div style="margin:8px 0 6px">${scoreBar(score, 100, 3)}</div>
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;
                                color:rgba(180,180,210,0.45)">${esc(cat.replace(/-/g, " "))}</div>
                </div>`;
    }).join("")}
        </div>
    </div>` : "";

    // ── Core Web Vitals ───────────────────────────────────────────────────────
    const v = data.vitals ?? {};
    const hasVitals = v.lcp != null || v.cls != null || v.inp != null;
    const vitalsHtml = hasVitals ? `
    <div style="background:rgba(0,0,0,0.2);border-bottom:1px solid rgba(255,255,255,0.05);
                padding:14px 52px;display:flex;align-items:center;gap:36px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;
                     color:rgba(180,180,210,0.35);white-space:nowrap">Core Web Vitals</span>
        ${(["lcp", "cls", "inp"] as const).map(m => {
        const val = v[m];
        if (val == null) return "";
        const s = vitalLabel(m, val);
        return `<div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.03);
                            border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:8px 14px">
            <div>
                <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                            color:rgba(180,180,210,0.4)">${m.toUpperCase()}</div>
                <div style="font-size:16px;font-weight:800;color:${s.color};
                            font-family:'Courier New',Consolas,monospace;line-height:1.2">
                    ${formatVitalValue(m, val)}
                </div>
            </div>
            <span style="font-size:9px;color:${s.color};background:${s.color}18;
                         border:1px solid ${s.color}40;border-radius:99px;padding:2px 7px;
                         font-weight:700">${s.label}</span>
        </div>`;
    }).join("")}
    </div>` : "";

    // ── Summary bar ───────────────────────────────────────────────────────────
    const summaryBar = `
    <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.15)">
        ${[
            { label: "Total Issues", val: data.findings.length, color: "#e4e4f0" },
            { label: "Critical", val: criticalCount, color: "#ff5757" },
            { label: "High", val: highCount, color: "#ff8c42" },
            { label: "Medium", val: warnCount, color: "#f5a623" },
            { label: "Low", val: lowCount, color: "#34d978" },
        ].map((item, i, arr) => `
        <div style="flex:1;padding:18px 22px${i < arr.length - 1 ? ";border-right:1px solid rgba(255,255,255,0.06)" : ""}">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4);margin-bottom:4px">${item.label}</div>
            <div style="font-size:22px;font-weight:800;color:${item.color};
                        font-family:'Courier New',Consolas,monospace">${item.val}</div>
        </div>`).join("")}
    </div>`;

    // ── Executive summary ─────────────────────────────────────────────────────
    const topActions = data.findings
        .filter(f => ["critical", "high"].includes(f.severity.toLowerCase()))
        .slice(0, 5);

    const executiveSummary = `
    <div class="section">
        ${sectionHeader("Executive Summary", primary)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
            <div>
                <p style="font-size:13px;color:rgba(228,228,240,0.75);line-height:1.7;margin-bottom:14px">
                    This report covers a comprehensive technical SEO audit of
                    <strong style="color:#e4e4f0">${esc(data.domain)}</strong>, conducted on ${esc(date)}.
                    The site achieved an overall score of
                    <strong style="color:${col}">${data.score}/100 (${gl})</strong>,
                    with ${urgentCount > 0
            ? `<strong style="color:#ff5757">${urgentCount} urgent issue${urgentCount !== 1 ? "s" : ""}</strong> requiring immediate attention`
            : "no urgent issues detected"}.
                </p>
                ${urgentCount > 0 ? `
                <div style="background:rgba(255,87,87,0.06);border:1px solid rgba(255,87,87,0.2);
                            border-radius:10px;padding:14px 16px">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                                color:#ff8080;margin-bottom:10px">Priority Actions</div>
                    ${topActions.map((f, i) => `
                    <div style="display:flex;gap:10px;align-items:flex-start;
                                ${i < topActions.length - 1 ? "margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.04)" : ""}">
                        <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;
                                     background:rgba(255,87,87,0.15);color:#ff5757;font-size:9px;
                                     font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</span>
                        <div>
                            <div style="font-size:12px;font-weight:600;color:#e4e4f0">${esc(f.title)}</div>
                            ${f.recommendation ? `<div style="font-size:11px;color:rgba(180,180,210,0.55);margin-top:2px">${esc(f.recommendation)}</div>` : ""}
                        </div>
                    </div>`).join("")}
                </div>` : `
                <div style="background:rgba(52,217,120,0.06);border:1px solid rgba(52,217,120,0.2);
                            border-radius:10px;padding:16px;text-align:center">
                    <div style="font-size:22px;margin-bottom:6px">✓</div>
                    <div style="font-size:12px;color:#34d978;font-weight:600">No critical issues detected</div>
                    <div style="font-size:11px;color:rgba(180,180,210,0.5);margin-top:4px">
                        Focus on medium/low items to push your score higher
                    </div>
                </div>`}
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                            border-radius:12px;padding:20px;text-align:center">
                    <div style="margin-bottom:12px">${svgScoreRing(data.score, 100)}</div>
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;
                                letter-spacing:0.1em;color:rgba(180,180,210,0.4)">Overall Score</div>
                    <div style="font-size:36px;font-weight:800;color:${col};
                                font-family:'Courier New',Consolas,monospace;line-height:1;margin-top:4px">${g}</div>
                    <div style="font-size:11px;color:${col};margin-top:4px;opacity:0.7">${gl}</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    ${[
            { label: "Total Issues", val: data.findings.length, color: "#e4e4f0" },
            { label: "Categories", val: catEntries.length, color: primary },
            { label: "Critical/High", val: urgentCount, color: urgentCount > 0 ? "#ff5757" : "#34d978" },
            { label: "Warnings", val: warnCount, color: "#f5a623" },
        ].map(item => `
                    <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);
                                border-radius:8px;padding:12px">
                        <div style="font-size:8px;font-weight:700;text-transform:uppercase;
                                    letter-spacing:0.1em;color:rgba(180,180,210,0.4)">${item.label}</div>
                        <div style="font-size:22px;font-weight:800;color:${item.color};
                                    font-family:'Courier New',Consolas,monospace;line-height:1.2">${item.val}</div>
                    </div>`).join("")}
                </div>
            </div>
        </div>
    </div>`;

    // ── Findings grouped by category ──────────────────────────────────────────
    const groupedFindings = data.findings.reduce<Record<string, AuditFinding[]>>((acc, f) => {
        const cat = f.category || "General";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(f);
        return acc;
    }, {});

    // Sort each group by severity
    Object.values(groupedFindings).forEach(group =>
        group.sort((a, b) =>
            (SEVERITY_ORDER[a.severity.toLowerCase()] ?? 9) -
            (SEVERITY_ORDER[b.severity.toLowerCase()] ?? 9)
        )
    );

    const findingsSectionsHtml = data.findings.length === 0
        ? `<div class="section">
            ${sectionHeader(`All Findings (0)`, primary)}
            <div style="text-align:center;padding:48px;color:rgba(180,180,210,0.4)">
                <div style="font-size:32px;margin-bottom:12px">✓</div>
                <div style="font-size:14px;font-weight:600;color:#34d978">No issues found</div>
                <div style="font-size:12px;margin-top:6px">Site is well-optimised across all checked areas</div>
            </div>
        </div>`
        : Object.entries(groupedFindings).map(([cat, findings]) => {
            const catScore = data.categoryScores?.[cat.toLowerCase()];
            const icon = CATEGORY_ICONS[cat.toLowerCase()] ?? "◈";
            const catCritical = findings.filter(f => ["critical", "high"].includes(f.severity.toLowerCase())).length;

            return `<div class="section">
            ${sectionHeader(`${icon} ${cat} — ${findings.length} issue${findings.length !== 1 ? "s" : ""}${catScore != null ? ` · Score ${catScore}` : ""}`, primary)}
            <table>
                <thead>
                    <tr>
                        <th style="width:6%">Sev.</th>
                        <th style="width:26%">Issue</th>
                        <th style="width:34%">Description</th>
                        <th>Recommendation</th>
                    </tr>
                </thead>
                <tbody>
                    ${findings.map(f => {
                const sev = severityColor(f.severity);
                return `<tr>
                        <td>
                            <span class="badge" style="background:${sev.bg};color:${sev.fg};border-color:${sev.border}">
                                <span class="badge-dot" style="background:${sev.fg}"></span>
                                ${esc(f.severity)}
                            </span>
                        </td>
                        <td style="font-weight:600;color:#e4e4f0;font-size:12px">${esc(f.title)}</td>
                        <td style="font-size:11.5px;color:rgba(180,180,210,0.6)">${esc(f.description)}</td>
                        <td style="font-size:11.5px;color:rgba(180,180,210,0.75)">
                            ${f.recommendation
                        ? `<span style="display:flex;align-items:flex-start;gap:6px">
                                    <span style="color:${primary};flex-shrink:0;margin-top:1px">→</span>
                                    ${esc(f.recommendation)}
                                   </span>`
                        : `<span style="color:rgba(180,180,210,0.3);font-style:italic">—</span>`}
                        </td>
                    </tr>`;
            }).join("")}
                </tbody>
            </table>
        </div>`;
        }).join("");

    // ── Cover ─────────────────────────────────────────────────────────────────
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SEO Audit Report – ${esc(data.domain)}</title>
<style>
${baseStyles(primary)}
.cover-grade {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: ${col}18;
    border: 1px solid ${col}40;
    border-radius: 12px;
    padding: 8px 16px;
    margin-bottom: 36px;
}
.severity-legend {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 20px;
}
.severity-legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: rgba(180,180,210,0.55);
}
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
            <div class="cover-title">Technical SEO<br>Audit Report</div>
            <div class="cover-sub">Prepared for <strong style="color:#e4e4f0">${esc(client)}</strong> &middot; ${esc(date)}</div>

            <div class="cover-grade">
                <span style="font-size:28px;font-weight:900;color:${col};
                             font-family:'Courier New',Consolas,monospace;line-height:1">${g}</span>
                <div>
                    <div style="font-size:11px;font-weight:700;color:${col}">${gl}</div>
                    <div style="font-size:10px;color:rgba(180,180,210,0.5)">Score: ${data.score}/100</div>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi-card">
                    <div class="kpi-label">Domain</div>
                    <div style="font-size:12px;font-weight:600;color:#e4e4f0;margin-top:3px;
                                font-family:'Courier New',Consolas,monospace">${esc(data.domain)}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Critical / High</div>
                    <div class="kpi-value" style="color:${urgentCount > 0 ? "#ff5757" : "#34d978"}">${urgentCount}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Warnings</div>
                    <div class="kpi-value" style="color:#f5a623">${warnCount}</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label">Categories</div>
                    <div class="kpi-value" style="color:${primary}">${catEntries.length || "—"}</div>
                </div>
            </div>
        </div>

        <!-- Score ring -->
        <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:8px;
                    background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                    border-radius:16px;padding:28px 32px">
            ${svgScoreRing(data.score, 110)}
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;
                        color:rgba(180,180,210,0.4)">Overall Score</div>
            <div class="severity-legend">
                ${[
            { label: "Critical", color: "#ff5757" },
            { label: "High", color: "#ff8c42" },
            { label: "Medium", color: "#f5a623" },
            { label: "Low", color: "#34d978" },
        ].map(s => `
                <div class="severity-legend-item">
                    <span style="width:7px;height:7px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
                    ${s.label}
                </div>`).join("")}
            </div>
        </div>
    </div>
</div>

${vitalsHtml}
${summaryBar}
${executiveSummary}
${categoryGrid}

<!-- ── FINDINGS BY CATEGORY ── -->
${findingsSectionsHtml}

<!-- ── FOOTER ── -->
<div class="footer">
    <span>Generated by <span class="footer-brand">${esc(brand)}</span></span>
    <span>${esc(data.domain)} &middot; ${esc(date)}</span>
</div>

</body>
</html>`;
}


export async function generateAuditReportPdf(data: AuditReportData): Promise<Buffer> {
    return renderHtmlToPdf(buildAuditHtml(data), "audit");
}