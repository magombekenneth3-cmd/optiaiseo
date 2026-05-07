import { logger } from "@/lib/logger";
import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maskEmail(email: string): string {
  return email.replace(/(.{2}).+(@.+)/, "$1***$2");
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface SEODigestData {
  userName: string;
  domain: string;
  auditScore: number;
  auditScoreChange: number;
  topOpportunities: { keyword: string; position: number; impressions: number }[];
  newBacklinks: number;
  lostBacklinks: number;
  topPage: { url: string; clicks: number };
}

export interface PriorityIssue {
  title: string;
  priorityScore: number;
  recommendation: string;
  difficulty: "Easy fix" | "Medium effort" | "Complex";
}

export interface RankMovement {
  keyword: string;
  from: number;
  to: number;
}

export interface PriorityDigestData {
  userName: string;
  domain: string;
  aeoScore: number;
  aeoChange: number;
  /** Accepts PriorityIssue or the richer EnrichedRecommendation (via structural compatibility) */
  topIssues: { title: string; priorityScore: number; difficulty: string; recommendation?: string; action?: string; why?: string }[];
  rankWins: RankMovement[];    // positions improved
  rankDrops: RankMovement[];  // positions lost (for context)
  aiCitations: number;        // new AI citations this week
  unsubToken: string;
  appUrl: string;
}

const buildPriorityDigestHtml = (data: PriorityDigestData): string => {
  const appUrl = data.appUrl ?? process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
  const unsubUrl = `${appUrl}/api/unsubscribe?token=${encodeURIComponent(data.unsubToken)}`;
  const auditUrl = `${appUrl}/dashboard/audits`;
  const rankUrl  = `${appUrl}/dashboard/keywords`;

  const difficultyColor = (d: string) =>
    d === "Easy fix" ? "#16a34a" : d === "Medium effort" ? "#d97706" : "#dc2626";

  const aeoArrow = data.aeoChange >= 0 ? "▲" : "▼";
  const aeoColor = data.aeoChange >= 0 ? "#16a34a" : "#dc2626";
  const aeoChange = Math.abs(data.aeoChange);

  const winsSection = data.rankWins.length > 0 ? `
    <div style="padding:20px 24px;border-bottom:1px solid #1f2937;">
      <h2 style="font-size:16px;font-weight:700;margin:0 0 14px 0;color:#f4f4f5;">🏆 This week's ranking wins</h2>
      ${data.rankWins.slice(0, 5).map(w => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1f2937;">
          <span style="font-size:13px;color:#f4f4f5;">${escapeHtml(w.keyword)}</span>
          <span style="font-size:13px;font-weight:700;color:#16a34a;">▲ #${w.from} → #${w.to}</span>
        </div>
      `).join("")}
      <a href="${rankUrl}" style="display:inline-block;margin-top:12px;font-size:12px;color:#4ade80;">View all rankings →</a>
    </div>` : "";

  const citationsSection = data.aiCitations > 0 ? `
    <div style="padding:16px 24px;border-bottom:1px solid #1f2937;background:#0f2210;">
      <span style="font-size:13px;font-weight:700;color:#4ade80;">🤖 ${data.aiCitations} new AI citation${data.aiCitations !== 1 ? "s" : ""} detected this week in ChatGPT, Claude, or Perplexity</span>
    </div>` : "";

  const issueRows = data.topIssues.map((issue, i) => {
    const bodyText = issue.why ?? issue.action ?? issue.recommendation ?? "";
    return `
    <div style="border-left: 4px solid #4ade80; padding: 12px 16px; margin-bottom: 12px; background: #0f0f0f; border-radius: 0 8px 8px 0;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="font-weight:700; font-size:13px; color:#f4f4f5">#${i + 1} — ${escapeHtml(issue.title)}</span>
        <span style="font-size:12px; font-weight:700; color:#fff; background:#1d4ed8; padding:2px 8px; border-radius:99px;">${issue.priorityScore}/100</span>
      </div>
      <p style="font-size:13px; color:#a1a1aa; margin:0 0 8px 0;">${escapeHtml(bodyText)}</p>
      <span style="font-size:11px; font-weight:600; color:${difficultyColor(String(issue.difficulty))};">${escapeHtml(String(issue.difficulty))}</span>
    </div>
  `;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Weekly SEO Report</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:'Inter',Arial,sans-serif;color:#f4f4f5;">
  <div style="max-width:600px;margin:0 auto;padding:0 0 32px 0;">
    <div style="background:#10b981;padding:32px 24px;text-align:center;border-bottom:1px solid #1f2937;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.85);text-transform:uppercase;margin-bottom:8px;">OptiAISEO Weekly Report</div>
      <h1 style="font-size:22px;font-weight:800;margin:0 0 4px 0;color:#fff;">${escapeHtml(data.domain)}</h1>
      <p style="font-size:13px;color:rgba(255,255,255,0.75);margin:0;">Hi ${escapeHtml(data.userName)} — here's what moved this week</p>
    </div>
    <div style="padding:20px 24px;border-bottom:1px solid #1f2937;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">AI Answer Score</div>
          <div style="font-size:36px;font-weight:800;color:#fff;">${data.aeoScore}<span style="font-size:16px;color:#6b7280;">/100</span></div>
        </div>
        <div style="padding:8px 16px;background:#09090b;border:1px solid #1f2937;border-radius:12px;">
          <span style="font-size:18px;font-weight:700;color:${aeoColor};">${aeoArrow} ${aeoChange} pts</span>
          <div style="font-size:11px;color:#6b7280;">vs last week</div>
        </div>
      </div>
    </div>
    ${citationsSection}
    ${winsSection}
    <div style="padding:20px 24px;">
      <h2 style="font-size:16px;font-weight:700;margin:0 0 16px 0;color:#f4f4f5;">⚡ Top ${data.topIssues.length} Fixes This Week</h2>
      ${issueRows}
    </div>
    <div style="padding:0 24px 24px 24px;text-align:center;">
      <a href="${auditUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none;">
        View Full Audit Report →
      </a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #1f2937;text-align:center;">
      <p style="font-size:11px;color:#52525b;margin:0 0 6px 0;">You're receiving this because you enabled weekly digest emails.</p>
      <a href="${unsubUrl}" style="font-size:11px;color:#4ade80;text-decoration:none;">Unsubscribe from weekly digest</a>
    </div>
  </div>
</body>
</html>`;
};

const buildPriorityDigestText = (data: PriorityDigestData): string => {
  const appUrl = data.appUrl ?? process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
  const lines = [
    `OptiAISEO Weekly Report — ${data.domain}`,
    `Hi ${data.userName}`,
    ``,
    `AI Answer Score: ${data.aeoScore}/100 (${data.aeoChange >= 0 ? "+" : ""}${data.aeoChange} pts vs last week)`,
    ...(data.aiCitations > 0 ? ["", `🤖 ${data.aiCitations} new AI citation(s) detected in ChatGPT, Claude, or Perplexity`] : []),
    ...(data.rankWins.length > 0 ? [
      ``,
      `🏆 Ranking wins this week:`,
      ...data.rankWins.slice(0, 5).map(w => `  ${w.keyword}: #${w.from} → #${w.to}`),
    ] : []),
    ``,
    `Top ${data.topIssues.length} Fixes This Week:`,
    ...data.topIssues.map((issue, i) =>
      `${i + 1}. ${issue.title} [${issue.priorityScore}/100] — ${issue.difficulty}\n   ${issue.recommendation}`
    ),
    ``,
    `View full report: ${appUrl}/dashboard/audits`,
    ``,
    `Unsubscribe: ${appUrl}/api/unsubscribe?token=${encodeURIComponent(data.unsubToken)}`,
  ];
  return lines.join("\n");
};

export const sendPriorityDigest = async (
  toEmail: string,
  data: PriorityDigestData,
): Promise<{ success: boolean; error?: string }> => {
  if (!validateEmail(toEmail)) {
    return { success: false, error: "Invalid email address." };
  }
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`[Email] RESEND_API_KEY not set — priority digest NOT sent to: ${maskEmail(toEmail)}`);
    return { success: false, error: "Email service not configured." };
  }
  if (!process.env.RESEND_FROM_DOMAIN) {
    logger.error("[Email] RESEND_FROM_DOMAIN is not set — priority digest NOT sent.");
    return { success: false, error: "Email sender domain not configured." };
  }

  const topTitle = data.rankWins.length > 0
    ? `${data.domain} moved from #${data.rankWins[0].from} → #${data.rankWins[0].to} for "${data.rankWins[0].keyword}"`
    : data.topIssues[0]?.title ?? "Your weekly SEO priorities";

  try {
    const result = await getResend().emails.send({
      from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
      to: toEmail,
      subject: `OptiAISEO weekly priorities for ${data.domain}: ${topTitle}`,
      html: buildPriorityDigestHtml(data),
      text: buildPriorityDigestText(data),
      headers: {
        "List-Unsubscribe": `<${process.env.NEXTAUTH_URL ?? "https://optiaiseo.online"}/dashboard/settings?tab=notifications>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "Precedence": "bulk",
      },
    });
    logger.debug(`[Email] Sent priority digest to ${maskEmail(toEmail)}`, { result });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[Email] Failed to send priority digest", {
      error: (err as Error)?.message ?? String(err),
      email: maskEmail(toEmail),
      domain: data.domain,
    });
    return { success: false, error: (err as Error).message };
  }
};

const buildDigestHtml = (data: SEODigestData): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; }
    .header { background: #000; color: #fff; padding: 24px; text-align: center; }
    .section { padding: 20px; border-bottom: 1px solid #eee; }
    .score { font-size: 48px; font-weight: bold; color: #000; }
    .change-pos { color: #16a34a; }
    .change-neg { color: #dc2626; }
    .keyword-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .footer { padding: 20px; text-align: center; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>SEO Weekly Digest</h1>
    <p>${escapeHtml(data.domain)}</p>
  </div>
  <div class="section">
    <h2>Overall SEO Score</h2>
    <div class="score">${data.auditScore}/100</div>
    <p class="${data.auditScoreChange >= 0 ? "change-pos" : "change-neg"}">
      ${data.auditScoreChange >= 0 ? "▲" : "▼"} ${Math.abs(data.auditScoreChange)} points from last week
    </p>
  </div>
  <div class="section">
    <h2>Top Keyword Opportunities</h2>
    ${data.topOpportunities.map(kw => `
      <div class="keyword-row">
        <span>${escapeHtml(kw.keyword)}</span>
        <span>Position #${kw.position} · ${kw.impressions} impressions</span>
      </div>
    `).join("")}
  </div>
  <div class="section">
    <h2>Backlinks</h2>
    <p>✅ ${data.newBacklinks} new backlinks gained</p>
    <p>❌ ${data.lostBacklinks} backlinks lost</p>
  </div>
  <div class="section">
    <h2>Top Performing Page</h2>
    <p><strong>${escapeHtml(data.topPage.url)}</strong> — ${data.topPage.clicks} clicks</p>
  </div>
  <div class="footer">
    <p>You're receiving this because you have an active OptiAISEO subscription.</p>
    <p><a href="${process.env.NEXTAUTH_URL}/dashboard/settings">Manage email preferences</a></p>
  </div>
</body>
</html>
`;

const buildDigestText = (data: SEODigestData): string => [
  `SEO Weekly Digest — ${data.domain}`,
  ``,
  `Overall SEO Score: ${data.auditScore}/100 (${data.auditScoreChange >= 0 ? "+" : ""}${data.auditScoreChange} pts)`,
  ``,
  `Top Keyword Opportunities:`,
  ...data.topOpportunities.map(kw => `  ${kw.keyword} — Position #${kw.position} · ${kw.impressions} impressions`),
  ``,
  `Backlinks: +${data.newBacklinks} gained, -${data.lostBacklinks} lost`,
  ``,
  `Top Page: ${data.topPage.url} — ${data.topPage.clicks} clicks`,
  ``,
  `Manage preferences: ${process.env.NEXTAUTH_URL}/dashboard/settings`,
].join("\n");

export const sendSEODigest = async (
  toEmail: string,
  data: SEODigestData,
): Promise<{ success: boolean; error?: string }> => {
  if (!validateEmail(toEmail)) {
    return { success: false, error: "Invalid email address." };
  }
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`[Email] RESEND_API_KEY not set — digest NOT sent to: ${maskEmail(toEmail)}`);
    return { success: false, error: "Email service not configured." };
  }
  if (!process.env.RESEND_FROM_DOMAIN) {
    logger.error("[Email] RESEND_FROM_DOMAIN is not set — digest NOT sent.");
    return { success: false, error: "Email sender domain not configured." };
  }

  try {
    const result = await getResend().emails.send({
      from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
      to: toEmail,
      subject: `Your OptiAISEO Weekly Digest — ${data.domain}`,
      html: buildDigestHtml(data),
      text: buildDigestText(data),
      headers: {
        "List-Unsubscribe": `<${process.env.NEXTAUTH_URL ?? "https://optiaiseo.online"}/dashboard/settings?tab=notifications>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "Precedence": "bulk",
      },
    });
    logger.debug(`[Email] Sent digest to ${maskEmail(toEmail)}`, { result });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[Email] Failed to send digest", {
      error: (err as Error)?.message || String(err),
      email: maskEmail(toEmail),
      domain: data.domain,
    });
    return { success: false, error: (err as Error).message };
  }
};

export async function sendRankMovementEmail(params: {
  userId: string;
  domain: string;
  siteId: string;
  wins:  { keyword: string; from: number; to: number; delta: number }[];
  drops: { keyword: string; from: number; to: number; delta: number }[];
}): Promise<{ success: boolean; error?: string }> {
  const { userId, domain, wins, drops } = params;

  const { prisma } = await import("@/lib/prisma");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  if (!user?.email) {
    logger.warn("[Email] sendRankMovementEmail — no email for user", { userId });
    return { success: false, error: "No user email found" };
  }

  const appUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";

  return sendPriorityDigest(user.email, {
    userName:   user.name ?? user.email.split("@")[0],
    domain,
    aeoScore:   0,
    aeoChange:  0,
    topIssues:  [],
    rankWins:   wins.map(w  => ({ keyword: w.keyword, from: w.from, to: w.to })),
    rankDrops:  drops.map(d => ({ keyword: d.keyword, from: d.from, to: d.to })),
    aiCitations: 0,
    unsubToken: userId,
    appUrl,
  });
}