import { inngest } from '../client';
import prisma from '@/lib/prisma';
import { isSafeUrl } from '@/lib/security/safe-url';
import { logger } from '@/lib/logger';

interface WhiteLabel {
    embedKey?: string;
    webhookUrl?: string;
}

interface LeadCapturedEvent {
    embedKey: string;
    email: string;
    domain: string;
    score: number;
    topIssues: string[];
    capturedAt: string;
}

export const fireLeadWebhookJob = inngest.createFunction(
    {
        id: 'fire-lead-webhook',
        name: 'Fire Embed Lead Webhook',
        retries: 3,
        concurrency: { limit: 5, key: 'global-lead-webhook' },
    
        triggers: [{ event: 'embed/lead.captured' }],
    },
    async ({ event }) => {
        const data = event.data as LeadCapturedEvent;

        const user = await prisma.user.findFirst({
            where: { whiteLabel: { path: ['embedKey'], equals: data.embedKey } },
            select: { whiteLabel: true },
        });

        const wl = (user?.whiteLabel ?? {}) as WhiteLabel;
        const webhookUrl = wl.webhookUrl;

        if (!webhookUrl) return { skipped: true, reason: 'No webhook configured' };

        const guard = isSafeUrl(webhookUrl);
        if (!guard.ok) {
            logger.error('[LeadWebhook] Blocked SSRF attempt — stored webhookUrl failed isSafeUrl', {
                embedKey: data.embedKey,
                reason: guard.error,
            });
            return { skipped: true, reason: 'Webhook URL is not a safe public endpoint' };
        }

        const payload = {
            email:      data.email,
            domain:     data.domain,
            score:      data.score,
            topIssues:  data.topIssues,
            capturedAt: data.capturedAt,
            agencyKey:  data.embedKey,
        };

        const res = await fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'OptiAISEO-Webhook/1.0' },
            body:    JSON.stringify(payload),
            signal:  AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
            throw new Error(`Webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
        }

        return { delivered: true, status: res.status };
    }
);
