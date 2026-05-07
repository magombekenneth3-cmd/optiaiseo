export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import { NextResponse } from 'next/server';
import { inngest } from '@/lib/inngest/client';
import { isCronAuthorized } from '@/lib/cron-auth';

// This API route acts as the webhook for the Weekly Cron Job.
// It should be secured in production using a secret token verify header 
// (e.g., from Vercel Cron).

export async function GET(request: Request) {
    if (!isCronAuthorized(request)) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        logger.debug('[Cron/Audit] Initiating weekly audit fan-out...');

        // Dynamic import of Prisma to avoid edge runtime issues if applicable
        const { prisma } = await import('@/lib/prisma');

        const sites = await prisma.site.findMany({
            select: { id: true, domain: true },
            where: { user: { subscriptionTier: { in: ['PRO', 'AGENCY'] } } },
        });

        // Fan out entirely via Inngest events instead of running synchronously
        const events = sites.map((site: { id: string }) => ({
            name: "audit.run" as const,
            data: { siteId: site.id }
        }));

        if (events.length > 0) {
            await inngest.send(events);
        }

        return NextResponse.json({
            success: true,
            message: `Queued audit jobs for ${sites.length} sites.`,
            queued: sites.length
        });
     
     
    } catch (error: unknown) {
        logger.error('[Cron/Audit] Failed to fan out audits:', { error: (error as Error)?.message || String(error) });
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
