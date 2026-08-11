import { esc, baseStyles, scoreColor, WhiteLabelConfig } from "./shared";
import { renderHtmlToPdf } from "./renderer";

export interface AgencyReportData {
    clientSiteName: string;
    clientSiteUrl: string;
    overallScore: number;
    aeoCitationRate: number;
    informationGainScore: number;
    totalPublishedArticles: number;
    topKeywords: Array<{ keyword: string; position: number; citations: number }>;
    whiteLabel: WhiteLabelConfig;
    theme?: "DARK" | "LIGHT";
}

export function buildAgencyWhiteLabelReportHtml(data: AgencyReportData): string {
    const primary = data.whiteLabel.primaryColor || "#3b82f6";
    const companyName = data.whiteLabel.companyName || "SEO Agency Partner";
    const isLight = data.theme === "LIGHT";

    const bgColor = isLight ? "#ffffff" : "#0b0f19";
    const textColor = isLight ? "#0f172a" : "#f8fafc";
    const cardBg = isLight ? "#f1f5f9" : "rgba(30,41,59,0.7)";
    const cardBorder = isLight ? "#cbd5e1" : "rgba(255,255,255,0.08)";

    const rowsHtml = data.topKeywords
        .map(
            (kw) => `
      <tr>
        <td><strong>${esc(kw.keyword)}</strong></td>
        <td><span class="badge" style="background: rgba(59,130,246,0.15); color: #3b82f6;">Position #${kw.position}</span></td>
        <td><strong style="color: ${scoreColor(kw.citations * 10)};">${kw.citations} citations</strong></td>
      </tr>
    `
        )
        .join("");

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(data.clientSiteName)} — AEO Executive Performance Audit</title>
  <style>
    ${baseStyles(primary)}
    body { background-color: ${bgColor} !important; color: ${textColor} !important; }
    .kpi-card { background: ${cardBg} !important; border-color: ${cardBorder} !important; }
  </style>
</head>
<body>

  <div class="page">
    <div class="cover">
      <div class="cover-brand">
        ${data.whiteLabel.logoUrl ? `<img src="${esc(data.whiteLabel.logoUrl)}" height="24" style="border-radius: 4px;" />` : ""}
        <span>${esc(companyName)}</span>
      </div>
      <div class="cover-title">${esc(data.clientSiteName)}</div>
      <div class="cover-sub">AEO & Generative Search Visibility Executive Audit</div>

      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-label">Overall AEO Health</div>
          <div class="kpi-value" style="color: ${scoreColor(data.overallScore)};">${data.overallScore}/100</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">LLM Citation Rate</div>
          <div class="kpi-value" style="color: #38bdf8;">${data.aeoCitationRate}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Info Gain Index</div>
          <div class="kpi-value" style="color: #a855f7;">${data.informationGainScore}/100</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Total pSEO Pages</div>
          <div class="kpi-value" style="color: #f43f5e;">${data.totalPublishedArticles}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title-accent" style="background: ${primary};"></div>
        <div class="section-title">Generative Search Keyword Citation Performance</div>
        <div class="section-title-line"></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Target Keyword / Query</th>
            <th>Search Position</th>
            <th>Generative Citations</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <div>Report generated for <strong style="color: #ffffff;">${esc(data.clientSiteName)}</strong></div>
      <div class="footer-brand">Powered by ${esc(companyName)}</div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export async function generateAgencyWhiteLabelPdfReport(data: AgencyReportData): Promise<Buffer> {
    const html = buildAgencyWhiteLabelReportHtml(data);
    return await renderHtmlToPdf(html, "agency-report");
}
