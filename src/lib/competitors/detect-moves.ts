import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

interface Alert {
    competitor: string;
    keyword: string;
    delta: number;
    newPos: number;
    oldPos: number;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
    return arr.reduce<Record<string, T[]>>((acc, item) => {
        const k = key(item);
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
    }, {});
}

export async function detectCompetitorMoves(siteId: string): Promise<Alert[]> {
    const competitors = await prisma.competitor.findMany({
        where: { siteId },
        include: {
            keywords: {
                orderBy: { fetchedAt: "desc" },
                take: 20,
            },
        },
    });

    const alerts: Alert[] = [];

    for (const comp of competitors) {
        const byKeyword = groupBy(comp.keywords, (k) => k.keyword);

        for (const [kw, snaps] of Object.entries(byKeyword)) {
            if (snaps.length < 2) continue;
            if (!snaps[0].position || !snaps[1].position) continue;

            const delta = snaps[1].position - snaps[0].position;

            if (Math.abs(delta) >= 3) {
                alerts.push({
                    competitor: comp.domain,
                    keyword: kw,
                    delta,
                    newPos: snaps[0].position,
                    oldPos: snaps[1].position,
                });
            }
        }
    }

    return alerts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export async function filterUnsentAlerts(siteId: string, alerts: Alert[]): Promise<Alert[]> {
    const unsent: Alert[] = [];

    for (const alert of alerts) {
        try {
            await prisma.competitorAlertLog.create({
                data: {
                    siteId,
                    competitor: alert.competitor,
                    keyword: alert.keyword,
                    delta: alert.delta,
                    oldPos: alert.oldPos,
                    newPos: alert.newPos,
                },
            });
            unsent.push(alert);
        } catch {
            logger.debug("[Competitors/Alerts] Skipping already-alerted move", {
                siteId,
                competitor: alert.competitor,
                keyword: alert.keyword,
            });
        }
    }

    return unsent;
}

export function renderCompetitorAlertEmail(alerts: Alert[], domain: string): string {
    const rows = alerts
        .slice(0, 10)
        .map(
            (a) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:10px 14px;font-weight:600;">${a.competitor}</td>
          <td style="padding:10px 14px;">${a.keyword}</td>
          <td style="padding:10px 14px;">${a.oldPos}</td>
          <td style="padding:10px 14px;">${a.newPos}</td>
          <td style="padding:10px 14px;font-weight:700;color:${a.delta > 0 ? "#16a34a" : "#dc2626"};">
            ${a.delta > 0 ? "+" : ""}${a.delta}
          </td>
        </tr>`
        )
        .join("");

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1e293b;}
.header{background:#000;color:#fff;padding:24px;text-align:center;}
table{width:100%;border-collapse:collapse;font-size:0.9rem;margin:1rem 0;}
th{padding:10px 14px;background:#f8fafc;text-align:left;font-weight:700;color:#475569;}
.footer{padding:16px;text-align:center;color:#94a3b8;font-size:12px;}</style>
</head><body>
<div class="header"><h1 style="margin:0;font-size:1.2rem;">🔔 Competitor Move Alert</h1>
<p style="margin:4px 0 0;opacity:.7;">${domain}</p></div>
<div style="padding:20px;">
<p>${alerts.length} competitor position change${alerts.length > 1 ? "s" : ""} detected in the last 24 hours.</p>
<table><thead><tr>
  <th>Competitor</th><th>Keyword</th><th>Old Pos</th><th>New Pos</th><th>Change</th>
</tr></thead><tbody>${rows}</tbody></table>
<p style="text-align:center;margin-top:1.5rem;">
  <a href="${process.env.NEXTAUTH_URL}/dashboard" style="background:#000;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">View Dashboard</a>
</p></div>
<div class="footer"><p>Manage alerts in <a href="${process.env.NEXTAUTH_URL}/dashboard/settings">Settings</a></p></div>
</body></html>`;
}
