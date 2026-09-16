
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
    if (score >= 80) return "#34d978";   
    if (score >= 60) return "#f5a623";   
    if (score >= 40) return "#ff8c42";  
    return "#ff5757";                    
}

export function scoreBgColor(score: number): string {
    if (score >= 80) return "rgba(52,217,120,0.10)";
    if (score >= 60) return "rgba(245,166,35,0.10)";
    if (score >= 40) return "rgba(255,140,66,0.10)";
    return "rgba(255,87,87,0.10)";
}

export function scoreBorderColor(score: number): string {
    if (score >= 80) return "rgba(52,217,120,0.28)";
    if (score >= 60) return "rgba(245,166,35,0.28)";
    if (score >= 40) return "rgba(255,140,66,0.28)";
    return "rgba(255,87,87,0.28)";
}

export function scoreBadgeClass(score: number): "good" | "warn" | "poor" {
    if (score >= 75) return "good";
    if (score >= 50) return "warn";
    return "poor";
}

export function severityColor(severity: string): { bg: string; fg: string; border: string } {
    switch (severity.toLowerCase()) {
        case "critical": return { bg: "rgba(255,87,87,0.14)", fg: "#ff5757", border: "rgba(255,87,87,0.35)" };
        case "high":     return { bg: "rgba(255,140,66,0.14)", fg: "#ff8c42", border: "rgba(255,140,66,0.35)" };
        case "medium":   return { bg: "rgba(245,166,35,0.14)", fg: "#f5a623", border: "rgba(245,166,35,0.35)" };
        default:         return { bg: "rgba(52,217,120,0.10)", fg: "#34d978", border: "rgba(52,217,120,0.28)" };
    }
}

export function statusColor(status: string): { bg: string; fg: string; border: string } {
    switch (status) {
        case "Fail":    return { bg: "rgba(255,87,87,0.12)", fg: "#ff5757", border: "rgba(255,87,87,0.3)" };
        case "Warning": return { bg: "rgba(245,166,35,0.12)", fg: "#f5a623", border: "rgba(245,166,35,0.3)" };
        case "Pass":    return { bg: "rgba(52,217,120,0.12)", fg: "#34d978", border: "rgba(52,217,120,0.3)" };
        default:        return { bg: "rgba(99,149,255,0.12)", fg: "#6395ff", border: "rgba(99,149,255,0.3)" };
    }
}


export function svgScoreRing(score: number, size = 96): string {
    const r = (size / 2) - 10;
    const circ = 2 * Math.PI * r;
    const offset = circ - (score / 100) * circ;
    const col = scoreColor(score);
    const cx = size / 2;
    const cy = size / 2;
    const fontSize = Math.round(size * 0.23);
    const labelSize = Math.round(size * 0.09);

    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <!-- Track -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
  <!-- Glow layer -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="${col}" stroke-width="7" stroke-linecap="round" opacity="0.18"
    stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
    transform="rotate(-90 ${cx} ${cy})" filter="url(#glow)"/>
  <!-- Arc -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
    stroke="${col}" stroke-width="7" stroke-linecap="round"
    stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
    transform="rotate(-90 ${cx} ${cy})"/>
  <!-- Score label -->
  <text x="${cx}" y="${cy - 2}" text-anchor="middle" dominant-baseline="middle"
    font-size="${fontSize}" font-weight="800" fill="${col}"
    font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Helvetica,Arial,sans-serif">${score}</text>
  <text x="${cx}" y="${cy + fontSize * 0.78}" text-anchor="middle"
    font-size="${labelSize}" fill="rgba(160,160,185,0.6)" letter-spacing="0.12em"
    font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Helvetica,Arial,sans-serif">SCORE</text>
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
</svg>`;
}


export function scoreBar(score: number, width = 120, height = 4): string {
    const col = scoreColor(score);
    const filled = Math.round((score / 100) * width);
    const r = height / 2;
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="${r}" fill="rgba(255,255,255,0.07)"/>
  <rect width="${filled}" height="${height}" rx="${r}" fill="${col}"/>
</svg>`;
}


// ─── Horizontal bar chart ───────────────────────────────────────────────────
// Used for AEO per-engine breakdowns and SEO category scores.
// Each bar has an optional label, value, and max (defaults to 100).

export interface BarChartItem {
    label: string;
    value: number;
    maxValue?: number;
}

export interface BarChartOptions {
    width?: number;
    barHeight?: number;
    gap?: number;
    primaryColor?: string;
    labelWidth?: number;
}

export function svgHorizontalBarChart(
    data: BarChartItem[],
    options?: BarChartOptions,
): string {
    const width = options?.width ?? 420;
    const barHeight = options?.barHeight ?? 18;
    const gap = options?.gap ?? 10;
    const labelWidth = options?.labelWidth ?? 100;
    const barAreaWidth = width - labelWidth - 60; // 60px for value label
    const totalHeight = data.length * (barHeight + gap) - gap + 4;

    const bars = data.map((item, i) => {
        const max = item.maxValue ?? 100;
        const pct = Math.min(1, Math.max(0, item.value / max));
        const barW = Math.round(pct * barAreaWidth);
        const y = i * (barHeight + gap);
        const col = options?.primaryColor ?? scoreColor(item.value);

        return `
    <text x="0" y="${y + barHeight * 0.72}" font-size="11" fill="rgba(228,228,240,0.75)"
      font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,Helvetica,Arial,sans-serif"
      font-weight="600">${esc(item.label)}</text>
    <rect x="${labelWidth}" y="${y + 2}" width="${barAreaWidth}" height="${barHeight - 4}"
      rx="${(barHeight - 4) / 2}" fill="rgba(255,255,255,0.06)"/>
    <rect x="${labelWidth}" y="${y + 2}" width="${barW}" height="${barHeight - 4}"
      rx="${(barHeight - 4) / 2}" fill="${col}"/>
    <text x="${labelWidth + barAreaWidth + 8}" y="${y + barHeight * 0.72}"
      font-size="11" fill="${col}" font-weight="700"
      font-family="'Courier New',Consolas,'Liberation Mono',monospace">${item.value}%</text>`;
    }).join("");

    return `<svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">${bars}
</svg>`;
}


// ─── Sparkline ──────────────────────────────────────────────────────────────
// Mini trend line for 30-day metrics. Renders as an SVG polyline with an
// optional area fill beneath.

export interface SparklineOptions {
    width?: number;
    height?: number;
    color?: string;
    showArea?: boolean;
}

export function svgSparkline(
    dataPoints: number[],
    options?: SparklineOptions,
): string {
    const w = options?.width ?? 120;
    const h = options?.height ?? 32;
    const color = options?.color ?? "#a78bfa";
    const showArea = options?.showArea ?? true;

    if (dataPoints.length < 2) {
        // Not enough data — render a flat line
        return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
</svg>`;
    }

    const padding = 2;
    const plotW = w - padding * 2;
    const plotH = h - padding * 2;
    const min = Math.min(...dataPoints);
    const max = Math.max(...dataPoints);
    const range = max - min || 1;

    const points = dataPoints.map((v, i) => {
        const x = padding + (i / (dataPoints.length - 1)) * plotW;
        const y = padding + plotH - ((v - min) / range) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polyline = points.join(" ");
    const areaPath = showArea
        ? `<polygon points="${points.join(" ")} ${(padding + plotW).toFixed(1)},${(padding + plotH).toFixed(1)} ${padding.toFixed(1)},${(padding + plotH).toFixed(1)}"
      fill="${color}" opacity="0.1"/>`
        : "";

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  ${areaPath}
  <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}


export function baseStyles(primary: string): string {
    return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
    background: #0a0a12;
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
    background: linear-gradient(140deg, #0c0c1a 0%, #0f101e 55%, #0b1220 100%);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    overflow: hidden;
}
.cover::before {
    content: '';
    position: absolute;
    top: -140px; right: -100px;
    width: 450px; height: 450px;
    border-radius: 50%;
    background: radial-gradient(circle, ${primary}1a 0%, transparent 65%);
    pointer-events: none;
}
.cover::after {
    content: '';
    position: absolute;
    bottom: -100px; left: -60px;
    width: 300px; height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, ${primary}0e 0%, transparent 70%);
    pointer-events: none;
}
.cover-brand {
    font-size: 12px;
    font-weight: 700;
    color: ${primary};
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 40px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.cover-title {
    font-size: 38px;
    font-weight: 800;
    line-height: 1.15;
    color: #ffffff;
    margin-bottom: 6px;
    letter-spacing: -0.02em;
}
.cover-sub {
    font-size: 14px;
    color: rgba(180,180,210,0.55);
    margin-bottom: 32px;
    font-weight: 400;
}
.kpi-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    position: relative;
    z-index: 1;
}
.kpi-card {
    flex: 1;
    min-width: 90px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 14px 16px;
}
.kpi-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(180,180,210,0.45);
    margin-bottom: 5px;
}
.kpi-value {
    font-size: 26px;
    font-weight: 800;
    line-height: 1;
    font-family: 'Courier New', Consolas, 'Liberation Mono', monospace;
}
.kpi-meta {
    font-size: 10px;
    color: rgba(180,180,210,0.4);
    margin-top: 4px;
}

/* ── Section ── */
.section {
    padding: 32px 52px;
    border-bottom: 1px solid rgba(255,255,255,0.045);
}
.section:last-of-type { border-bottom: none; }
.section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
}
.section-title-accent {
    width: 3px;
    height: 14px;
    border-radius: 2px;
    flex-shrink: 0;
}
.section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(200,200,220,0.6);
}
.section-title-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.055);
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
    color: rgba(180,180,210,0.38);
    padding: 0 14px 10px;
    text-align: left;
    white-space: nowrap;
}
td {
    padding: 11px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.035);
    vertical-align: top;
    color: rgba(228,228,240,0.8);
    font-size: 12px;
    line-height: 1.5;
}
tr:last-child td { border-bottom: none; }
tr { page-break-inside: avoid; }
tbody tr:nth-child(even) { background: rgba(255,255,255,0.012); }

/* ── Badge ── */
.badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 99px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.05em;
    white-space: nowrap;
    border: 1px solid transparent;
    text-transform: uppercase;
}
.badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* ── Footer ── */
.footer {
    padding: 16px 52px;
    border-top: 1px solid rgba(255,255,255,0.055);
    background: rgba(0,0,0,0.18);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    color: rgba(180,180,210,0.32);
    letter-spacing: 0.03em;
}
.footer-brand { color: ${primary}; font-weight: 600; }

@media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .section { page-break-inside: avoid; }
    tr { page-break-inside: avoid; }
}
`.trim();
}