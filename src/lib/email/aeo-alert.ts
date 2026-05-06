import { Resend } from "resend";
import { logger } from "@/lib/logger";

let _resend: Resend | null = null;
function resend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const SITE_URL = (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
const FROM = `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`;

export interface AeoDropData {
  domain: string;
  previousScore: number;
  currentScore: number;
  dropAmount: number;
}

export interface AeoWeeklyDigestData {
  domain: string;
  currentScore: number;
  previousScore: number;
  gSovPct: number;
  previousGSovPct: number;
  gainedQueries: string[];
  lostQueries: string[];
  topFix: string | null;
  siteId: string;
}

type EmailResult = { success: boolean; error?: string };

function scoreColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
}

function deltaBadge(delta: number): string {
  if (delta === 0) return `<span style="color:#999">No change</span>`;
  const color = delta > 0 ? "#10b981" : "#ef4444";
  const sign = delta > 0 ? "+" : "";
  return `<span style="color:${color};font-weight:700">${sign}${delta} pts</span>`;
}

const BASE_STYLES = `
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e5e7eb}
    .wrap{max-width:580px;margin:0 auto;padding:24px 16px}
    .card{background:#111;border:1px solid #1f2937;border-radius:16px;overflow:hidden;margin-bottom:16px}
    .header{padding:28px 28px 20px;border-bottom:1px solid #1f2937}
    .logo{font-size:13px;font-weight:700;letter-spacing:-.3px;color:#fff;margin-bottom:16px}
    .logo span{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#fff;color:#000;border-radius:6px;font-size:10px;margin-right:6px}
    .section{padding:20px 28px}
    .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:4px}
    .metric{font-size:32px;font-weight:800;letter-spacing:-1px;color:#fff}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px 28px}
    .cell{background:#1a1a1a;border:1px solid #1f2937;border-radius:10px;padding:14px}
    .pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700}
    .btn{display:inline-block;padding:13px 28px;background:#fff;color:#000;text-decoration:none;border-radius:99px;font-size:14px;font-weight:700}
    .footer{font-size:11px;color:#6b7280;text-align:center;padding:16px}
    ul{padding-left:16px}
    li{font-size:13px;color:#9ca3af;margin-bottom:4px}
  </style>
`;

function buildDropHtml(data: AeoDropData): string {
  const scoreCol = scoreColor(data.currentScore);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${BASE_STYLES}</head><body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <div class="logo"><span>AI</span>OptiAISEO</div>
      <div class="label">AEO Score Alert — ${data.domain}</div>
    </div>
    <div class="section">
      <div class="label">Score dropped</div>
      <div class="metric" style="color:${scoreCol}">${data.currentScore}<span style="font-size:18px;color:#6b7280">/100</span></div>
      <p style="font-size:13px;color:#9ca3af;margin-top:8px">Down ${data.dropAmount} points from ${data.previousScore}. Your AI citation rate may be declining.</p>
      <div style="margin-top:20px">
        <a href="${SITE_URL}/dashboard/aeo" class="btn">View full report</a>
      </div>
    </div>
  </div>
  <div class="footer"><a href="${SITE_URL}/dashboard/settings" style="color:#6b7280">Manage preferences</a> · 1 Infinity Loop, Cupertino CA 95014</div>
</div>
</body></html>`;
}

function buildDigestHtml(data: AeoWeeklyDigestData): string {
  const scoreDelta = data.currentScore - data.previousScore;
  const sovDelta = Math.round(data.gSovPct - data.previousGSovPct);
  const scoreCol = scoreColor(data.currentScore);
  const gainList = data.gainedQueries.slice(0, 3).map((q) => `<li>${q}</li>`).join("") || "<li>No new gains this week</li>";
  const lostList = data.lostQueries.slice(0, 3).map((q) => `<li>${q}</li>`).join("") || "<li>No citations lost this week</li>";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${BASE_STYLES}</head><body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <div class="logo"><span>AI</span>OptiAISEO</div>
      <div class="label">Weekly AEO Report — ${data.domain}</div>
    </div>
    <div class="grid">
      <div class="cell">
        <div class="label">AEO Score</div>
        <div style="font-size:28px;font-weight:800;color:${scoreCol}">${data.currentScore}</div>
        <div style="margin-top:4px;font-size:12px">${deltaBadge(scoreDelta)}</div>
      </div>
      <div class="cell">
        <div class="label">Gen. Share of Voice</div>
        <div style="font-size:28px;font-weight:800;color:#a78bfa">${data.gSovPct}%</div>
        <div style="margin-top:4px;font-size:12px">${deltaBadge(sovDelta)}</div>
      </div>
    </div>
    <div class="section" style="border-top:1px solid #1f2937">
      <div class="label" style="color:#10b981;margin-bottom:8px">Queries you gained this week</div>
      <ul>${gainList}</ul>
    </div>
    <div class="section" style="border-top:1px solid #1f2937">
      <div class="label" style="color:#ef4444;margin-bottom:8px">Queries lost to competitors</div>
      <ul>${lostList}</ul>
    </div>
    ${data.topFix ? `
    <div class="section" style="border-top:1px solid #1f2937;background:#0d1f16">
      <div class="label" style="color:#10b981">Top recommended fix</div>
      <p style="font-size:13px;color:#d1fae5;margin-top:6px">${data.topFix}</p>
    </div>` : ""}
    <div class="section" style="border-top:1px solid #1f2937;text-align:center">
      <a href="${SITE_URL}/dashboard/aeo?siteId=${data.siteId}" class="btn">View full dashboard</a>
    </div>
  </div>
  <div class="footer"><a href="${SITE_URL}/dashboard/settings" style="color:#6b7280">Unsubscribe</a> · 1 Infinity Loop, Cupertino CA 95014</div>
</div>
</body></html>`;
}

function guardEnv(): string | null {
  if (!process.env.RESEND_API_KEY) return "RESEND_API_KEY not set";
  if (!process.env.RESEND_FROM_DOMAIN) return "RESEND_FROM_DOMAIN not set";
  return null;
}

export async function sendAeoDropAlert(toEmail: string, data: AeoDropData): Promise<EmailResult> {
  const envErr = guardEnv();
  if (envErr) { logger.warn(`[Email] ${envErr} — drop alert not sent`); return { success: false, error: envErr }; }
  try {
    await resend().emails.send({ from: FROM, to: toEmail, subject: `⚠️ AEO score alert for ${data.domain}`, html: buildDropHtml(data) });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[Email] AEO drop alert failed", { error: (err as Error)?.message, toEmail });
    return { success: false, error: (err as Error).message };
  }
}

export async function sendAeoWeeklyDigest(toEmail: string, data: AeoWeeklyDigestData): Promise<EmailResult> {
  const envErr = guardEnv();
  if (envErr) { logger.warn(`[Email] ${envErr} — digest not sent`); return { success: false, error: envErr }; }
  try {
    await resend().emails.send({ from: FROM, to: toEmail, subject: `Your weekly AEO report — ${data.domain}`, html: buildDigestHtml(data) });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[Email] AEO weekly digest failed", { error: (err as Error)?.message, toEmail });
    return { success: false, error: (err as Error).message };
  }
}