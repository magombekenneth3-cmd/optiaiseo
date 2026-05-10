
import { isSafeUrl } from "@/lib/security/safe-url";

export type WebhookEventType =
  | "gsov_drop"
  | "citation_detected"
  | "aeo_score_drop"
  | "healing_queued"
  | "audit_complete"
  | "blog_published"
  | "rank_drop"
  | "rank_win";

export interface WebhookPayload {
  event: WebhookEventType;
  siteId: string;
  domain: string;
  timestamp: string;           // ISO 8601
  summary: string;           // one-line human description
  details: Record<string, string | number | boolean | null>;
  dashboardUrl?: string;
}


const SLACK_COLORS: Record<WebhookEventType, string> = {
  gsov_drop:         "#ef4444",   // red
  aeo_score_drop:    "#f97316",   // orange
  healing_queued:    "#f59e0b",   // amber
  citation_detected: "#10b981",   // emerald
  audit_complete:    "#3b82f6",   // blue
  blog_published:    "#8b5cf6",   // purple
  rank_drop:         "#ef4444",   // red
  rank_win:          "#16a34a",   // green
};

function buildSlackBody(payload: WebhookPayload): object {
  const color = SLACK_COLORS[payload.event] ?? "#6b7280";
  const fields = Object.entries(payload.details)
    .slice(0, 8)
    .map(([k, v]) => ({
      type: "mrkdwn",
      text: `*${k}*\n${v ?? "—"}`,
    }));

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*AISEO · ${payload.domain}*\n${payload.summary}`,
            },
          },
          ...(fields.length > 0
            ? [{ type: "section", fields }]
            : []),
          ...(payload.dashboardUrl
            ? [{
              type: "actions",
              elements: [{
                type: "button",
                text: { type: "plain_text", text: "Open Dashboard →" },
                url: payload.dashboardUrl,
                style: "primary",
              }],
            }]
            : []),
          {
            type: "context",
            elements: [{
              type: "mrkdwn",
              text: `<!date^${Math.floor(Date.now() / 1000)}^{date_short_pretty} {time}|${payload.timestamp}>`,
            }],
          },
        ],
      },
    ],
  };
}


export async function dispatchWebhooks(
  site: { id: string; domain: string; slackWebhookUrl?: string | null; zapierWebhookUrl?: string | null },
  payload: Omit<WebhookPayload, "siteId" | "domain" | "timestamp">,
): Promise<void> {
  const full: WebhookPayload = {
    ...payload,
    siteId: site.id,
    domain: site.domain,
    timestamp: new Date().toISOString(),
    dashboardUrl: payload.dashboardUrl
      ?? `${process.env.NEXTAUTH_URL ?? "https://optiaiseo.online"}/dashboard?siteId=${site.id}`,
  };

  const sends: Promise<void>[] = [];

  if (site.slackWebhookUrl) {
    sends.push(
      (async () => {
        try {
          const guard = isSafeUrl(site.slackWebhookUrl!);
          if (!guard.ok) {
            console.warn(`[Webhook/Slack] Blocked unsafe URL for ${site.domain}: ${guard.error}`);
            return;
          }
          const res = await fetch(site.slackWebhookUrl!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildSlackBody(full)),
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) {
            console.warn(`[Webhook/Slack] Non-OK response ${res.status} for ${site.domain}`);
          }
        } catch (err) {
          console.warn(`[Webhook/Slack] Delivery failed for ${site.domain}:`, (err as Error)?.message);
        }
      })()
    );
  }

  if (site.zapierWebhookUrl) {
    sends.push(
      (async () => {
        try {
          const guard = isSafeUrl(site.zapierWebhookUrl!);
          if (!guard.ok) {
            console.warn(`[Webhook/Zapier] Blocked unsafe URL for ${site.domain}: ${guard.error}`);
            return;
          }
          const res = await fetch(site.zapierWebhookUrl!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(full),
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) {
            console.warn(`[Webhook/Zapier] Non-OK response ${res.status} for ${site.domain}`);
          }
        } catch (err) {
          console.warn(`[Webhook/Zapier] Delivery failed for ${site.domain}:`, (err as Error)?.message);
        }
      })()
    );
  }

  if (sends.length > 0) await Promise.allSettled(sends);
}
