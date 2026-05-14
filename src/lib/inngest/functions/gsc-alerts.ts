import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { detectGscAnomalies } from "@/lib/self-healing/gsc";
import { logger } from "@/lib/logger";
import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
    return _resend;
}

export const weeklyGscAlerts = inngest.createFunction(
    {
        id: "weekly-gsc-alerts",
        name: "Weekly GSC Anomaly Alerts",
        retries: 1,
        triggers: [{ cron: "0 8 * * 1" }],
    },
    async ({ step }) => {
        const sites = await step.run("get-gsc-connected-sites", () =>
            prisma.site.findMany({
                where: { user: { gscConnected: true } },
                include: { user: { select: { email: true, name: true } } },
            })
        );

        let alertsSent = 0;

        for (const site of sites) {
            const result = await step.run(`check-anomalies-${site.id}`, async () => {
                try {
                    return await detectGscAnomalies(site.id);
                } catch (err: unknown) {
                    logger.warn(`[GscAlerts] Failed to check ${site.domain}`, {
                        error: (err as Error)?.message ?? String(err),
                    });
                    return { dropped: false, anomalies: [] };
                }
            });

            if (!result.dropped || result.anomalies.length === 0) continue;

            await step.run(`persist-alerts-${site.id}`, async () => {
                for (const anomaly of result.anomalies.slice(0, 10)) {
                    await prisma.selfHealingLog.create({
                        data: {
                            siteId: site.id,
                            issueType: "GSC_ANOMALY",
                            description: `Impression drop of ${anomaly.dropPercentage}% for "${anomaly.keyword}" on ${anomaly.url}`,
                            actionTaken: "Alert sent to user — no auto-fix applied",
                            status: "COMPLETED",
                            metadata: anomaly,
                        },
                    });
                }
            });

            if (site.user.email && process.env.RESEND_API_KEY && process.env.RESEND_FROM_DOMAIN) {
                await step.run(`email-alert-${site.id}`, async () => {
                    try {
                        await getResend().emails.send({
                            from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
                            to: site.user.email!,
                            subject: `GSC Alert: ${result.anomalies.length} impression drop${result.anomalies.length > 1 ? "s" : ""} on ${site.domain}`,
                            html: buildGscAlertEmail(site.domain, result.anomalies, site.id),
                        });
                        alertsSent++;
                        logger.info(`[GscAlerts] Alert sent to ${site.user.email} for ${site.domain}`);
                    } catch (err: unknown) {
                        logger.error(`[GscAlerts] Failed to send email for ${site.domain}`, {
                            error: (err as Error)?.message ?? String(err),
                        });
                    }
                });
            }
        }

        return { processed: sites.length, alertsSent };
    }
);

function buildGscAlertEmail(domain: string, anomalies: { keyword: string; dropPercentage: number; url: string }[], siteId: string): string {
    const appUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";

    const rows = anomalies.slice(0, 5).map(a => {
        const safeKeyword = a.keyword.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const safeUrl = a.url.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<tr>
      <td style="padding:8px 12px; border-bottom:1px solid #1f2937; font-size:13px; color:#f4f4f5;">${safeKeyword}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #1f2937; font-size:13px; color:#ef4444; font-weight:700;">-${a.dropPercentage}%</td>
      <td style="padding:8px 12px; border-bottom:1px solid #1f2937; font-size:12px; color:#6b7280; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeUrl}</td>
    </tr>`;
    }).join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:'Inter',Arial,sans-serif;color:#f4f4f5;">
  <div style="max-width:560px;margin:0 auto;padding:32px 0;">
    <div style="background:#dc2626;padding:24px;text-align:center;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.8);text-transform:uppercase;margin-bottom:6px;">OptiAISEO Alert</div>
      <h1 style="font-size:20px;font-weight:800;margin:0;color:#fff;">Search visibility alert for ${domain.replace(/</g, "&lt;")}</h1>
    </div>
    <div style="padding:20px 24px;background:#111;border:1px solid #1f2937;border-top:none;">
      <p style="color:#a1a1aa;font-size:14px;margin:0 0 16px 0;">
        We detected <strong style="color:#f4f4f5;">${anomalies.length} impression drop${anomalies.length > 1 ? "s" : ""}</strong> in the last 7 days:
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #1f2937;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#0a0a0a;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Keyword</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Drop</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Page</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:24px;text-align:center;">
        <a href="${appUrl}/dashboard/sites/${siteId}/healing-log"
           style="display:inline-block;background:#10b981;color:#fff;padding:12px 28px;
                  border-radius:10px;text-decoration:none;font-size:14px;font-weight:700;">
          View healing log →
        </a>
      </div>
    </div>
    <div style="padding:16px 24px;text-align:center;">
      <p style="font-size:11px;color:#52525b;margin:0;">Sent by OptiAISEO — manage alerts in your <a href="${appUrl}/dashboard/settings" style="color:#4ade80;">settings</a>.</p>
    </div>
  </div>
</body>
</html>`;
}
