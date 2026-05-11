
export interface WhiteLabelConfig {
    logoUrl?: string;
    primaryColor?: string;
    companyName?: string;
    clientName?: string;
}


export function esc(s: string | number | undefined | null): string {
    if (s === undefined || s === null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function safeUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        return ["http:", "https:"].includes(parsed.protocol) ? url : undefined;
    } catch {
        return undefined;
    }
}


export function scoreColor(score: number): string {
    if (score >= 75) return "#34d978";   // emerald
    if (score >= 50) return "#f5a623";   // amber
    return "#ff5757";                     // red
}

export function scoreBgColor(score: number): string {
    if (score >= 75) return "rgba(52,217,120,0.12)";
    if (score >= 50) return "rgba(245,166,35,0.12)";
    return "rgba(255,87,87,0.12)";
}

export function scoreBorderColor(score: number): string {
    if (score >= 75) return "rgba(52,217,120,0.3)";
    if (score >= 50) return "rgba(245,166,35,0.3)";
    return "rgba(255,87,87,0.3)";
}

export function scoreBadgeClass(score: number): "good" | "warn" | "poor" {
    if (score >= 75) return "good";
    if (score >= 50) return "warn";
    return "poor";
}

export function severityColor(severity: string): { bg: string; fg: string; border: string } {
    switch (severity.toLowerCase()) {
        case "critical":
        case "high": return { bg: "rgba(255,87,87,0.12)", fg: "#ff5757", border: "rgba(255,87,87,0.3)" };
        case "medium": return { bg: "rgba(245,166,35,0.12)", fg: "#f5a623", border: "rgba(245,166,35,0.3)" };
        default: return { bg: "rgba(52,217,120,0.12)", fg: "#34d978", border: "rgba(52,217,120,0.3)" };
    }
}

export function statusColor(status: string): { bg: string; fg: string; border: string } {
    switch (status) {
        case "Fail": return { bg: "rgba(255,87,87,0.12)", fg: "#ff5757", border: "rgba(255,87,87,0.3)" };
        case "Warning": return { bg: "rgba(245,166,35,0.12)", fg: "#f5a623", border: "rgba(245,166,35,0.3)" };
        case "Pass": return { bg: "rgba(52,217,120,0.12)", fg: "#34d978", border: "rgba(52,217,120,0.3)" };
        default: return { bg: "rgba(99,149,255,0.12)", fg: "#6395ff", border: "rgba(99,149,255,0.3)" };
    }
}


export function svgScoreRing(score: number, size = 96): string {
    const r = (size / 2) - 8;
    const circ = 2 * Math.PI * r;
    const offset = circ - (score / 100) * circ;
    const col = scoreColor(score);
    const cx = size / 2;
    const cy = size / 2;
    const fontSize = size * 0.22;
    const labelSize = size * 0.095;

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="6"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="${col}" stroke-width="6" stroke-linecap="round"
    stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
    transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy - 2}" text-anchor="middle" dominant-baseline="middle"
    font-size="${fontSize}" font-weight="800" fill="${col}"
    font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Helvetica,Arial,sans-serif">${score}</text>
  <text x="${cx}" y="${cy + fontSize * 0.75}" text-anchor="middle"
    font-size="${labelSize}" fill="rgba(160,160,185,0.7)" letter-spacing="0.1em"
    font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Helvetica,Arial,sans-serif">SCORE</text>
</svg>`;
}


export function scoreBar(score: number, width = 120, height = 4): string {
    const col = scoreColor(score);
    const filled = Math.round((score / 100) * width);
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="${height / 2}" fill="rgba(255,255,255,0.07)"/>
  <rect width="${filled}" height="${height}" rx="${height / 2}" fill="${col}"/>
</svg>`;
}


export function baseStyles(primary: string): string {
    return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
    background: #0c0c12;
    color: #e4e4f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
}

/* ── Layout ── */
.page { padding: 0; }

/* ── Cover ── */
.cover {
    position: relative;
    padding: 52px 52px 44px;
    background: linear-gradient(135deg, #0f0f1a 0%, #111120 60%, #0d1525 100%);
    border-bottom: 1px solid rgba(255,255,255,0.07);
    overflow: hidden;
}
.cover::before {
    content: '';
    position: absolute;
    top: -120px; right: -120px;
    width: 400px; height: 400px;
    border-radius: 50%;
    background: radial-gradient(circle, ${primary}18 0%, transparent 70%);
    pointer-events: none;
}
.cover::after {
    content: '';
    position: absolute;
    bottom: -80px; left: -80px;
    width: 260px; height: 260px;
    border-radius: 50%;
    background: radial-gradient(circle, ${primary}0d 0%, transparent 70%);
    pointer-events: none;
}
.cover-brand {
    font-size: 13px;
    font-weight: 700;
    color: ${primary};
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.cover-title {
    font-size: 36px;
    font-weight: 800;
    line-height: 1.15;
    color: #ffffff;
    margin-bottom: 6px;
    letter-spacing: -0.02em;
}
.cover-sub {
    font-size: 14px;
    color: rgba(180,180,210,0.6);
    margin-bottom: 40px;
    font-weight: 400;
}
.kpi-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
}
.kpi-card {
    flex: 1;
    min-width: 100px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 16px 18px;
    backdrop-filter: blur(4px);
}
.kpi-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(180,180,210,0.5);
    margin-bottom: 6px;
}
.kpi-value {
    font-size: 28px;
    font-weight: 800;
    line-height: 1;
    font-family: 'Courier New', Consolas, 'Liberation Mono', monospace;
}
.kpi-meta {
    font-size: 10px;
    color: rgba(180,180,210,0.45);
    margin-top: 4px;
}

/* ── Section ── */
.section {
    padding: 36px 52px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.section:last-of-type { border-bottom: none; }
.section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 22px;
}
.section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(180,180,210,0.5);
}
.section-title-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.06);
}

/* ── Tables ── */
table { width: 100%; border-collapse: collapse; }
thead tr {
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
th {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(180,180,210,0.4);
    padding: 0 14px 10px;
    text-align: left;
    white-space: nowrap;
}
td {
    padding: 11px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    vertical-align: middle;
    color: rgba(228,228,240,0.85);
    font-size: 12.5px;
}
tr:last-child td { border-bottom: none; }
tr { page-break-inside: avoid; }
tbody tr:hover { background: rgba(255,255,255,0.02); }

/* ── Badge ── */
.badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border: 1px solid transparent;
}
.badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* ── Footer ── */
.footer {
    padding: 18px 52px;
    border-top: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.2);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    color: rgba(180,180,210,0.35);
    letter-spacing: 0.03em;
}
.footer-brand { color: ${primary}; font-weight: 600; }

@media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .section { page-break-inside: avoid; }
}
`.trim();
}