import { prisma } from "@/lib/prisma";
import { isSafeUrl } from "@/lib/security/safe-url";
import { logger } from "@/lib/logger";
import { createHmac } from "crypto";

export type WhiteLabelWebhookEvent =
  | "audit.completed"
  | "aeo.completed"
  | "backlinks.alerts_detected";

export interface WhiteLabelWebhookPayload {
  event: WhiteLabelWebhookEvent;
  siteId: string;
  domain: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function fireWhiteLabelWebhook(
  userId: string,
  payload: WhiteLabelWebhookPayload,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { whiteLabel: true },
  });

  const wl = (user?.whiteLabel as Record<string, string | undefined>) ?? {};
  const webhookUrl = wl.webhookUrl;

  if (!webhookUrl) return;

  const guard = isSafeUrl(webhookUrl);
  if (!guard.ok) {
    logger.warn("[WhiteLabelWebhook] Stored URL failed safety check", {
      userId,
      error: guard.error,
    });
    return;
  }

  const body = JSON.stringify(payload);
  const secret = process.env.WEBHOOK_SIGNING_SECRET ?? process.env.NEXTAUTH_SECRET ?? "default";
  const signature = signPayload(body, secret);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OptiAISEO-Signature": `sha256=${signature}`,
        "X-OptiAISEO-Event": payload.event,
        "User-Agent": "OptiAISEO-Webhook/1.0",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn("[WhiteLabelWebhook] Delivery failed", {
        userId,
        event: payload.event,
        status: res.status,
      });
    } else {
      logger.info("[WhiteLabelWebhook] Delivered", {
        userId,
        event: payload.event,
      });
    }
  } catch (err) {
    logger.warn("[WhiteLabelWebhook] Network error", {
      userId,
      event: payload.event,
      error: String(err),
    });
  }
}
