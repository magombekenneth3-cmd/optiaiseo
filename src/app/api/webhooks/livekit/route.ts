export const dynamic = "force-dynamic";
// =============================================================================
// LIVEKIT WEBHOOK HANDLER
// POST /api/webhooks/livekit
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { rateLimit, getClientIp } from "@/lib/rate-limit/check";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
    // IP-based rate limit — legitimate LiveKit deliveries come from known IP
    // ranges; this blocks volume attacks before we do any crypto work.
    const ip = getClientIp(req);
    const limited = await rateLimit("webhook", `livekit-webhook:${ip}`);
    if (limited) return limited;

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        logger.error("[Webhook/LiveKit] LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured");
        return NextResponse.json({ error: "LiveKit not configured" }, { status: 500 });
    }

    // Verify the webhook signature — MUST read raw body for HMAC verification
    const body = await req.text();
    const authHeader = req.headers.get("authorization") ?? "";

    let event: Awaited<ReturnType<WebhookReceiver["receive"]>>;
    try {
        const receiver = new WebhookReceiver(apiKey, apiSecret);
        event = await receiver.receive(body, authHeader);
    } catch (err: unknown) {
        logger.warn("[Webhook/LiveKit] Signature verification failed", {
            error: (err as Error)?.message ?? String(err),
        });
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Process the verified event
    try {
        await handleLiveKitEvent(event);
    } catch (err: unknown) {
        logger.error("[Webhook/LiveKit] Failed to process event", {
            eventName: event.event,
            error: (err as Error)?.message ?? String(err),
        });
        // Always return 200 so LiveKit doesn't retry — we log the failure internally
    }

    return NextResponse.json({ received: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleLiveKitEvent(event: any): Promise<void> {
    const eventName: string = event.event ?? "unknown";
    logger.info(`[Webhook/LiveKit] Event: ${eventName}`, { room: event.room?.name });

    switch (eventName) {
        case "room_finished": {
            // Room ended — log session end for analytics
            const roomName: string | undefined = event.room?.name;
            if (roomName?.startsWith("voice-")) {
                const userId = roomName.replace("voice-", "");
                logger.info("[Webhook/LiveKit] Voice session ended", { userId, roomName });
                // Optional: update session log or billing record
                await prisma.user
                    .findUnique({ where: { id: userId }, select: { id: true } })
                    .catch(() => null); // non-critical — don't throw
            }
            break;
        }

        case "participant_left": {
            const identity: string | undefined = event.participant?.identity;
            logger.info("[Webhook/LiveKit] Participant left", {
                room: event.room?.name,
                identity,
            });
            break;
        }

        default:
            // Unhandled event types are silently acknowledged
            logger.debug(`[Webhook/LiveKit] Unhandled event: ${eventName}`);
    }
}
