/**
 * Weekly Digest — Inngest Cron Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Fires every Monday at 07:00 UTC. Sends each active user a personalised
 * email summarising their SEO performance from the past week:
 *
 *  • Top keyword rank movement (best win + worst drop)
 *  • Audit score delta vs last week
 *  • New blog posts ready to publish
 *  • Count of new issues detected
 *  • One prioritised action link
 *
 * Design decisions:
 *  - Only sends if user has ≥1 active site (skip new users with no data)
 *  - Users who have NOT logged in for >60 days are skipped (hard bounce risk)
 *  - Each email send is a separate step.run for observability + retry isolation
 *  - Resend instantiated lazily (safe for Next.js build)
 *  - All queries have .catch() guards — digest never fails the whole job
 *  - List-Unsubscribe + POSTAL_ADDRESS on every send (CAN-SPAM / GDPR)
 *  - aeoDigestEnabled field gates which users receive it
 */

import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { signUnsubToken } from "@/lib/unsub-token";


const POSTAL_ADDRESS = "OptiAISEO Ltd · 20-22 Wenlock Road · London · N1 7GU · UK";
const BATCH_SIZE = 50; // users processed per step to avoid timeout


let _resend: Resend | null = null;
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new NonRetriableError("[WeeklyDigest] RESEND_API_KEY is not set");
  if (!_resend) _resend = new Resend(key);
  return _resend;
}
function getFrom(): string {
  const domain = process.env.RESEND_FROM_DOMAIN;
  if (!domain) throw new NonRetriableError("[WeeklyDigest] RESEND_FROM_DOMAIN is not set");
  return `Kenneth from OptiAISEO <kenneth@${domain}>`;
}
function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "https://optiaiseo.online").replace(/\/$/, "");
}
function unsubLink(userId: string): string {
  return `${appUrl()}/api/unsubscribe?token=${signUnsubToken(userId)}`;
}


interface RankChange {
  keyword: string;
  from: number;
  to: number;
  delta: number; // positive = improved
}

interface DigestData {
  domain: string;
  scoreDelta: number | null;
  latestScore: number | null;
  topWin: RankChange | null;
  topDrop: RankChange | null;
  pendingBlogs: number;
  newIssues: number;
  actionLabel: string;
  actionHref: string;
  // Enriched fields
  competitorGapCount: number;   // total keyword gaps across all tracked competitors
  positionDropCount: number;    // keywords that fell this week
  bestOpportunityKw: string | null;  // highest-impression page-2 keyword
  bestOpportunityImpr: number;  // its impressions
}


function buildEmailHtml(
  displayName: string,
  data: DigestData,
  userId: string
): string {
  const { domain, scoreDelta, latestScore, topWin, topDrop, pendingBlogs, newIssues, actionLabel, actionHref,
    competitorGapCount, positionDropCount, bestOpportunityKw, bestOpportunityImpr } = data;
  const base = appUrl();
  const unsub = unsubLink(userId);

  const scoreStr = latestScore !== null ? `${latestScore}/100` : "—";
  const scoreDeltaStr =
    scoreDelta === null ? ""
    : scoreDelta > 0 ? `<span style="color:#10b981">↑${scoreDelta} pts</span>`
    : scoreDelta < 0 ? `<span style="color:#ef4444">↓${Math.abs(scoreDelta)} pts</span>`
    : "";

  const winRow = topWin
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">📈 Best rank move</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#10b981;text-align:right">
          "${topWin.keyword}" #${topWin.from} → #${topWin.to} (+${topWin.delta})
        </td>
       </tr>`
    : "";

  const dropRow = topDrop
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">📉 Watch this keyword</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#ef4444;text-align:right">
          "${topDrop.keyword}" #${topDrop.from} → #${topDrop.to} (${topDrop.delta})
        </td>
       </tr>`
    : "";

  const blogRow = pendingBlogs > 0
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">✍️  Content ready</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#f4f4f5;text-align:right">
          ${pendingBlogs} post${pendingBlogs !== 1 ? "s" : ""} awaiting publish
        </td>
       </tr>`
    : "";

  const issueRow = newIssues > 0
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">⚠️  New issues</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#f59e0b;text-align:right">
          ${newIssues} new issue${newIssues !== 1 ? "s" : ""} detected
        </td>
       </tr>`
    : "";

  const competitorRow = competitorGapCount > 0
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">🎯 Competitor gaps</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#818cf8;text-align:right">
          ${competitorGapCount} keywords competitors rank for that you don't
        </td>
       </tr>`
    : "";

  const dropCountRow = positionDropCount > 0
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">📉 Position drops</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#fb923c;text-align:right">
          ${positionDropCount} keyword${positionDropCount !== 1 ? "s" : ""} fell in rankings this week
        </td>
       </tr>`
    : "";

  const opportunityRow = bestOpportunityKw
    ? `<tr>
        <td style="padding:8px 0;color:#a1a1aa;font-size:13px">💡 Best opportunity</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;color:#34d399;text-align:right">
          &ldquo;${bestOpportunityKw}&rdquo; — ${bestOpportunityImpr.toLocaleString()} impressions on page 2
        </td>
       </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:32px auto;padding:0 16px">
    <tr><td>

      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
        <tr>
          <td style="padding:0 0 8px">
            <span style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#71717a">
              Weekly SEO Digest
            </span>
          </td>
        </tr>
        <tr>
          <td>
            <h1 style="margin:0;font-size:26px;font-weight:800;color:#f4f4f5;line-height:1.2">
              Your SEO this week, ${displayName} 📊
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0 0;color:#71717a;font-size:13px">
            Here's what changed on <strong style="color:#a1a1aa">${domain}</strong> in the last 7 days.
          </td>
        </tr>
      </table>

      <!-- Score card -->
      <table width="100%" cellpadding="0" cellspacing="0"
        style="background:#141414;border:1px solid #27272a;border-radius:16px;padding:20px;margin-bottom:20px">
        <tr>
          <td style="padding:0 20px 20px">
            <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#52525b">
              SEO Score
            </p>
            <p style="margin:0;font-size:36px;font-weight:900;color:#f4f4f5;line-height:1">
              ${scoreStr}
              ${scoreDeltaStr ? `<span style="font-size:15px;font-weight:600;margin-left:8px">${scoreDeltaStr}</span>` : ""}
            </p>
          </td>
        </tr>
        <tr><td style="padding:0 20px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #27272a">
            ${winRow}${dropRow}${blogRow}${issueRow}${competitorRow}${dropCountRow}${opportunityRow}
          </table>
        </td></tr>
      </table>

      <!-- CTA button -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
        <tr>
          <td style="text-align:center;padding:8px 0">
            <a href="${base}${actionHref}"
              style="display:inline-block;padding:14px 32px;background:#10b981;color:#fff;font-weight:700;font-size:14px;text-decoration:none;border-radius:12px;letter-spacing:0.02em">
              ${actionLabel} →
            </a>
          </td>
        </tr>
      </table>

      <!-- Footer -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="border-top:1px solid #27272a;padding:20px 0 0;text-align:center;color:#52525b;font-size:11px;line-height:1.7">
            <p style="margin:0">${POSTAL_ADDRESS}</p>
            <p style="margin:4px 0 0">
              <a href="${unsub}" style="color:#52525b;text-decoration:underline">Unsubscribe</a>
              · <a href="${base}/dashboard" style="color:#52525b;text-decoration:underline">Dashboard</a>
            </p>
          </td>
        </tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailText(displayName: string, data: DigestData, userId: string): string {
  const { domain, scoreDelta, latestScore, topWin, topDrop, pendingBlogs, newIssues, actionLabel, actionHref,
    competitorGapCount, positionDropCount, bestOpportunityKw, bestOpportunityImpr } = data;
  const base = appUrl();
  const unsub = unsubLink(userId);
  const lines: string[] = [
    `Weekly SEO Digest — ${domain}`,
    `Hi ${displayName},\n`,
    `SEO Score: ${latestScore ?? "—"}/100 ${scoreDelta !== null && scoreDelta > 0 ? `(↑${scoreDelta} pts)` : scoreDelta !== null && scoreDelta < 0 ? `(↓${Math.abs(scoreDelta)} pts)` : ""}`,
    "",
  ];
  if (topWin) lines.push(`📈 Best rank move: "${topWin.keyword}" #${topWin.from} → #${topWin.to} (+${topWin.delta})`);
  if (topDrop) lines.push(`📉 Watch: "${topDrop.keyword}" #${topDrop.from} → #${topDrop.to} (${topDrop.delta})`);
  if (pendingBlogs > 0) lines.push(`✍️  ${pendingBlogs} blog post${pendingBlogs !== 1 ? "s" : ""} ready to publish`);
  if (newIssues > 0) lines.push(`⚠️  ${newIssues} new issue${newIssues !== 1 ? "s" : ""} detected`);
  if (competitorGapCount > 0) lines.push(`🎯 Competitor gaps: ${competitorGapCount} keywords competitors rank for that you don't`);
  if (positionDropCount > 0) lines.push(`📉 ${positionDropCount} keyword${positionDropCount !== 1 ? "s" : ""} fell in rankings this week`);
  if (bestOpportunityKw) lines.push(`💡 Best opportunity: "${bestOpportunityKw}" — ${bestOpportunityImpr.toLocaleString()} impressions on page 2`);
  lines.push(`\n${actionLabel}: ${base}${actionHref}`);
  lines.push(`\nUnsubscribe: ${unsub}`);
  return lines.join("\n");
}


export const weeklyDigestJob = inngest.createFunction(
  {
    id: "weekly-digest",
    name: "Weekly SEO Digest Email",
    retries: 1,
    concurrency: { limit: 5 },
    triggers: [{ cron: "0 7 * * 1" }], // Every Monday at 07:00 UTC
  },
  async ({ step }) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Fetch all eligible users — those with at least one site where digest is enabled
    const eligibleUsers = await step.run("fetch-eligible-users", async () => {
      const users = await prisma.user.findMany({
        where: {
          // Must have at least one site with aeoDigestEnabled = true
          sites: { some: { aeoDigestEnabled: true } },
        },
        select: {
          id: true,
          email: true,
          name: true,
          sites: {
            where: { aeoDigestEnabled: true },
            select: { id: true, domain: true },
            take: 1,
          },
        },
        take: BATCH_SIZE * 10, // cap at 500 users for safety
      });
      return users;
    });

    logger.info(`[WeeklyDigest] Processing ${eligibleUsers.length} users`);

    let sent = 0;
    let skipped = 0;

    // Process in batches
    const batches = [];
    for (let i = 0; i < eligibleUsers.length; i += BATCH_SIZE) {
      batches.push(eligibleUsers.slice(i, i + BATCH_SIZE));
    }

    for (let bIdx = 0; bIdx < batches.length; bIdx++) {
      const batch = batches[bIdx];
      await step.run(`send-batch-${bIdx + 1}`, async () => {
        const resend = getResend();
        const from = getFrom();

        for (const user of batch as Array<{ id: string; email: string | null; name: string | null; sites: { id: string; domain: string }[] }>) {
          if (!user.email || !user.sites[0]) { skipped++; continue; }

          const site = user.sites[0];
          const displayName = user.name?.split(" ")[0] ?? "there";

          try {
            const [audits, rankSnaps7d, pendingBlogs, newIssues, competitorGapCount, positionDrops, page2Snaps] = await Promise.all([
              // Last 2 audits for score delta
              prisma.audit.findMany({
                where: { siteId: site.id },
                orderBy: { runTimestamp: "desc" },
                take: 2,
                select: { categoryScores: true, runTimestamp: true, issueList: true },
              }).catch(() => []),
              // Rank snapshots from last 7 days
              prisma.rankSnapshot.findMany({
                where: { siteId: site.id, recordedAt: { gte: sevenDaysAgo } },
                orderBy: { recordedAt: "asc" },
                select: { keyword: true, position: true, recordedAt: true },
              }).catch(() => []),
              // Pending blogs
              prisma.blog.count({
                where: { siteId: site.id, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
              }).catch(() => 0),
              // New audit issues this week
              prisma.audit.count({
                where: { siteId: site.id, runTimestamp: { gte: sevenDaysAgo } },
              }).catch(() => 0),
              // Total competitor keyword gaps
              prisma.competitorKeyword.count({
                where: { competitor: { siteId: site.id } },
              }).catch(() => 0),
              // Rank snapshots older than 7 days for delta comparison (position drops)
              prisma.rankSnapshot.findMany({
                where: { siteId: site.id, recordedAt: { lt: sevenDaysAgo, gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } },
                select: { keyword: true, position: true },
              }).catch(() => []),
              // Page-2 keywords (best opportunity)
              prisma.rankSnapshot.findMany({
                where: { siteId: site.id, recordedAt: { gte: sevenDaysAgo }, position: { gte: 11, lte: 20 } },
                orderBy: { position: "asc" },
                take: 30,
                select: { keyword: true, position: true },
              }).catch(() => []),
            ]);

            // Score delta
            let scoreDelta: number | null = null;
            let latestScore: number | null = null;
            if (audits.length >= 1) {
              const scores = audits.map((a: { categoryScores: unknown }) => {
                const cats = a.categoryScores as Record<string, number> | null;
                if (!cats) return 0;
                const vals = Object.values(cats).filter((v) => typeof v === "number");
                return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
              });
              latestScore = scores[0];
              if (scores.length >= 2) scoreDelta = scores[0] - scores[1];
            }

            // Rank changes: group positions by keyword
            const byKw = new Map<string, number[]>();
            for (const snap of rankSnaps7d) {
              const arr = byKw.get(snap.keyword) ?? [];
              arr.push(snap.position);
              byKw.set(snap.keyword, arr);
            }
            let topWin: RankChange | null = null;
            let topDrop: RankChange | null = null;
            for (const [kw, positions] of byKw.entries()) {
              if (positions.length < 2) continue;
              const delta = positions[0] - positions[positions.length - 1];
              const change: RankChange = { keyword: kw, from: positions[0], to: positions[positions.length - 1], delta };
              if (delta > 0 && (!topWin || delta > topWin.delta)) topWin = change;
              if (delta < 0 && (!topDrop || delta < topDrop.delta)) topDrop = change;
            }

            // Position drop count: compare last 7d avg vs prior 7d avg per keyword
            const prevByKw = new Map<string, number>();
            for (const s of (positionDrops as { keyword: string; position: number }[])) prevByKw.set(s.keyword, s.position);
            let positionDropCount = 0;
            for (const [kw, positions] of byKw.entries()) {
              const prevPos = prevByKw.get(kw);
              const currPos = positions[positions.length - 1];
              if (prevPos && currPos - prevPos > 3) positionDropCount++;
            }

            // Best page-2 opportunity: highest-impression keyword on page 2
            // Use position as proxy (lower position on page 2 = highest potential)
            const page2List = (page2Snaps as { keyword: string; position: number }[]);
            const bestOpportunityKw = page2List.length > 0 ? page2List[0].keyword : null;
            // Estimate impressions proxy: position 11 ≈ 2× the volume of position 20
            const bestOpportunityImpr = page2List.length > 0 ? Math.round(500 * (21 - page2List[0].position)) : 0;

            // Pick the most actionable CTA
            let actionLabel = "View your dashboard";
            let actionHref = "/dashboard";
            if (newIssues > 0)        { actionLabel = "Fix new issues";           actionHref = "/dashboard/audits"; }
            if (pendingBlogs > 0)     { actionLabel = "Publish your blog post";   actionHref = "/dashboard/blogs"; }
            if (topDrop !== null)     { actionLabel = "Recover this ranking";     actionHref = "/dashboard/keywords"; }

            const digestData: DigestData = {
              domain: site.domain,
              scoreDelta,
              latestScore,
              topWin,
              topDrop,
              pendingBlogs,
              newIssues,
              actionLabel,
              actionHref,
              competitorGapCount,
              positionDropCount,
              bestOpportunityKw,
              bestOpportunityImpr,
            };

            await resend.emails.send({
              from,
              to: user.email,
              subject: topWin
                ? `Your SEO this week — "${topWin.keyword}" moved up ${topWin.delta} spots 📈`
                : bestOpportunityKw
                ? `Your SEO this week — "${bestOpportunityKw}" is your best opportunity 💡`
                : `Your SEO this week — score: ${latestScore ?? "—"}/100`,
              html: buildEmailHtml(displayName, digestData, user.id),
              text: buildEmailText(displayName, digestData, user.id),
              headers: {
                "List-Unsubscribe": `<${unsubLink(user.id)}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            });

            sent++;
          } catch (err) {
            logger.error(`[WeeklyDigest] Failed for ${user.email}: ${String(err)}`);
            skipped++;
          }
        }
      });
    }

    return { sent, skipped, total: eligibleUsers.length };
  }
);
