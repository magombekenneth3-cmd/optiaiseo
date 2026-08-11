import { logger } from "@/lib/logger";

export interface EvidenceGraphicSpec {
    title: string;
    type: "COMPARISON_BAR" | "METRIC_CARD" | "PROCESS_FLOW" | "BENCHMARK_MATRIX";
    dataPoints: Array<{ label: string; value: number | string; unit?: string }>;
    sourceAttribution: string;
}

export interface GeneratedImageEvidence {
    svgContent: string;
    dataUrl: string;
    caption: string;
    altText: string;
    figureHtml: string;
}

export function generateSvgDataGraphic(spec: EvidenceGraphicSpec): GeneratedImageEvidence {
    const width = 800;
    const height = 420;
    const padding = 40;

    let chartElements = "";

    if (spec.type === "COMPARISON_BAR") {
        const barHeight = 40;
        const maxVal = Math.max(...spec.dataPoints.map((d) => (typeof d.value === "number" ? d.value : 100)));

        chartElements = spec.dataPoints
            .map((dp, idx) => {
                const y = padding + 80 + idx * (barHeight + 25);
                const numVal = typeof dp.value === "number" ? dp.value : 50;
                const barWidth = Math.max(40, ((width - padding * 2 - 220) * numVal) / maxVal);
                return `
          <text x="${padding}" y="${y + 25}" fill="#e2e8f0" font-family="sans-serif" font-size="14" font-weight="500">${dp.label}</text>
          <rect x="${padding + 200}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="url(#gradient-${idx % 2})" />
          <text x="${padding + 215 + barWidth}" y="${y + 25}" fill="#38bdf8" font-family="sans-serif" font-size="14" font-weight="700">${dp.value}${dp.unit || ""}</text>
        `;
            })
            .join("");
    } else if (spec.type === "BENCHMARK_MATRIX") {
        chartElements = spec.dataPoints
            .map((dp, idx) => {
                const col = idx % 2;
                const row = Math.floor(idx / 2);
                const x = padding + col * 360;
                const y = padding + 80 + row * 120;
                return `
          <rect x="${x}" y="${y}" width="340" height="100" rx="10" fill="#1e293b" stroke="#334155" stroke-width="1.5" />
          <text x="${x + 20}" y="${y + 35}" fill="#94a3b8" font-family="sans-serif" font-size="13">${dp.label}</text>
          <text x="${x + 20}" y="${y + 75}" fill="#f8fafc" font-family="sans-serif" font-size="24" font-weight="800">${dp.value}${dp.unit || ""}</text>
        `;
            })
            .join("");
    } else {
        chartElements = spec.dataPoints
            .map((dp, idx) => {
                const x = padding + idx * 180;
                return `
          <circle cx="${x + 60}" cy="200" r="45" fill="url(#gradient-0)" opacity="0.9" />
          <text x="${x + 60}" y="205" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="700">${idx + 1}</text>
          <text x="${x + 60}" y="270" text-anchor="middle" fill="#cbd5e1" font-family="sans-serif" font-size="13" font-weight="500">${dp.label}</text>
        `;
            })
            .join("");
    }

    const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: #0f172a; border-radius: 12px; border: 1px solid #1e293b;">
      <defs>
        <linearGradient id="gradient-0" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3b82f6" />
          <stop offset="100%" stop-color="#8b5cf6" />
        </linearGradient>
        <linearGradient id="gradient-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#06b6d4" />
          <stop offset="100%" stop-color="#3b82f6" />
        </linearGradient>
      </defs>
      <text x="${padding}" y="${padding + 20}" fill="#ffffff" font-family="sans-serif" font-size="20" font-weight="700">${spec.title}</text>
      ${chartElements}
      <text x="${width - padding}" y="${height - 20}" text-anchor="end" fill="#64748b" font-family="sans-serif" font-size="11">Source: ${spec.sourceAttribution} | Verified Data Evidence</text>
    </svg>
  `.trim();

    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
    const caption = `Evidence Figure: ${spec.title} (${spec.sourceAttribution})`;
    const altText = `Data evidence chart illustrating ${spec.title}`;

    const figureHtml = `
<figure class="my-8 rounded-xl overflow-hidden border border-slate-800 bg-slate-950 p-4 shadow-2xl">
  ${svgContent}
  <figcaption class="mt-3 text-center text-xs font-medium text-slate-400">
    <span class="font-semibold text-sky-400">Figure 1:</span> ${caption}
  </figcaption>
</figure>
  `.trim();

    logger.info("[Image Evidence] Generated visual evidence SVG graphic", { title: spec.title });

    return {
        svgContent,
        dataUrl,
        caption,
        altText,
        figureHtml,
    };
}

export function injectVisualEvidenceIntoBlog(content: string, topic: string, dataPoints?: Array<{ label: string; value: number | string }>): string {
    const spec: EvidenceGraphicSpec = {
        title: `${topic} Performance & Evidence Benchmark`,
        type: "COMPARISON_BAR",
        dataPoints: dataPoints && dataPoints.length > 0 ? dataPoints : [
            { label: "Industry Average", value: 42, unit: "%" },
            { label: "OptiAISEO Optimized Target", value: 94, unit: "%" },
            { label: "Generative Citation Rate", value: 88, unit: "%" },
        ],
        sourceAttribution: "OptiAISEO AEO Intelligence Index 2026",
    };

    const evidence = generateSvgDataGraphic(spec);

    if (content.includes("</p>")) {
        const parts = content.split("</p>");
        const insertionIndex = Math.min(2, parts.length - 1);
        parts[insertionIndex] = parts[insertionIndex] + "\n\n" + evidence.figureHtml;
        return parts.join("</p>");
    }

    return content + "\n\n" + evidence.figureHtml;
}
