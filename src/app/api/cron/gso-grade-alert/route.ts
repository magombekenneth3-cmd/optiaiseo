export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/gso-grade-alert
 *
 * Weekly cron: compare latest vs previous AEO/GSO snapshots.
 * If a site's AI visibility grade drops by more than one letter grade
 * (e.g. B → C) send an alert email to the site owner.
 *
 * Schedule: 0 7 * * 2  (07:00 UTC every Tuesday)
 */

const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];

function gradeFromScore(score: number): string {
    if (score >= 97) return "A+";
    if (score >= 93) return "A";
    if (score >= 90) return "A-";
    if (score >= 87) return "B+";
    if (score >= 83) return "B";
    if (score >= 80) return "B-";
    if (score >= 77) return "C+";
    if (score >= 73) return "C";
    if (score >= 70) return "C-";
    if (score >= 60) return "D";
    return "F";
}

function gradeDropped(from: string, to: string): boolean {
    const fromIdx = GRADE_ORDER.indexOf(from);
    const toIdx = GRADE_ORDER.indexOf(to);
    // toIdx > fromIdx means lower grade (F=10 > A+=0)
    return toIdx - fromIdx >= 2;
}

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const sites = await prisma.site.findMany({
            where: {
                user: {
                    subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] },
                    email: { not: null },
                },
            },
            include: {
                user: { select: { email: true, name: true } },
                aeoSnapshots: {
                    orderBy: { createdAt: "desc" },
                    take: 2,
                    select: { score: true, grade: true, createdAt: true },
                },
            },
        });

        let alertsSent = 0;
        let skipped = 0;

        for (const site of sites) {
            try {
                const [latest, previous] = site.aeoSnapshots;
                if (!latest || !previous) { skipped++; continue; }
                if (!site.user.email) { skipped++; continue; }

                const latestGrade = latest.grade ?? gradeFromScore(latest.score);
                const previousGrade = previous.grade ?? gradeFromScore(previous.score);

                if (!gradeDropped(previousGrade, latestGrade)) { skipped++; continue; }

                // Suppress if we already sent this alert this week
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

                const recentAlert = await prisma.competitorAlert.findFirst({
                    where: {
                        siteId: site.id,
                        competitor: "__gso_grade_drop__",
                        createdAt: { gte: oneWeekAgo },
                    },
                });
                if (recentAlert) { skipped++; continue; }

                // Record the alert to prevent duplicate sends
                await prisma.competitorAlert.create({
                    data: {
                        siteId: site.id,
                        competitor: "__gso_grade_drop__",
                        gainedCount: 0,
                        message: `AI visibility grade dropped from ${previousGrade} to ${latestGrade} for ${site.domain}`,
                        details: {
                            previousGrade,
                            latestGrade,
                            previousScore: previous.score,
                            latestScore: latest.score,
                        },
                    },
                });

                // Send alert email via Resend
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                const appUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
                const fromAddress = process.env.EMAIL_FROM ?? "alerts@optiaiseo.online";

                const scoreDelta = latest.score - previous.score;
                const formattedDelta = scoreDelta > 0 ? `+${scoreDelta}` : `${scoreDelta}`;

                await resend.emails.send({
                    from: fromAddress,
                    to: site.user.email,
                    subject: `⚠️ AI Visibility Grade Drop: ${site.domain} (${previousGrade} → ${latestGrade})`,
                    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr>
    <td style="background:#111;border:1px solid #222;border-radius:16px;padding:40px;">
      <p style="color:#10b981;font-size:14px;font-weight:700;margin:0 0 24px;letter-spacing:2px;text-transform:uppercase;">OptiAISEO Alert</p>
      <h1 style="color:#f8fafc;font-size:24px;font-weight:800;margin:0 0 8px;line-height:1.3;">AI Visibility Grade Drop Detected</h1>
      <p style="color:#64748b;font-size:14px;margin:0 0 32px;">${site.domain}</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr>
          <td width="48%" style="background:#1a1a1a;border-radius:12px;padding:20px;text-align:center;border:1px solid #ef444433;">
            <p style="color:#64748b;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Previous Grade</p>
            <p style="color:#ef4444;font-size:48px;font-weight:900;margin:0;line-height:1;">${previousGrade}</p>
            <p style="color:#64748b;font-size:12px;margin:8px 0 0;">Score: ${previous.score}</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:#1a1a1a;border-radius:12px;padding:20px;text-align:center;border:1px solid #ef444433;">
            <p style="color:#64748b;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Current Grade</p>
            <p style="color:#f87171;font-size:48px;font-weight:900;margin:0;line-height:1;">${latestGrade}</p>
            <p style="color:#64748b;font-size:12px;margin:8px 0 0;">Score: ${latest.score} (${formattedDelta})</p>
          </td>
        </tr>
      </table>

      <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 24px;">
        Your site&apos;s AI visibility has dropped by more than one letter grade. This means AI models like Gemini, ChatGPT, and Perplexity are less likely to cite your content for relevant queries.
      </p>

      <a href="${appUrl}/dashboard" style="display:inline-block;background:#10b981;color:#000;font-weight:700;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-bottom:32px;">View Dashboard & Fix Issues →</a>

      <p style="color:#374151;font-size:12px;margin:0;">You&apos;re receiving this because you have GSO grade alerts enabled. <a href="${appUrl}/dashboard/settings" style="color:#4b5563;text-decoration:underline;">Manage preferences</a></p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`,
                });

                alertsSent++;
            } catch (err) {
                logger.warn("[Cron/GsoGradeAlert] Failed for site", {
                    siteId: site.id,
                    error: (err as Error)?.message,
                });
                skipped++;
            }
        }

        logger.info("[Cron/GsoGradeAlert] Done", { alertsSent, skipped, total: sites.length });
        return NextResponse.json({ success: true, alertsSent, skipped, total: sites.length });
    } catch (error: unknown) {
        logger.error("[Cron/GsoGradeAlert] Fatal:", { error: (error as Error)?.message });
        return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
    }
}
