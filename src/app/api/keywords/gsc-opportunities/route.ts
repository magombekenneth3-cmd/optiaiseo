import { getAuthUser } from '@/lib/auth/get-auth-user';
/**
 * GET /api/keywords/gsc-opportunities
 *
 * Returns GSC-powered keyword opportunities for the authenticated user's
 * connected site. Requires an active google-gsc OAuth connection.
 *
 * Query params:
 *   domain (required) — the domain to fetch opportunities for
 *
 * Response:
 *   200 { opportunities: GscOpportunity[], source: 'gsc' | 'none' }
 *   400 { error: string }
 *   401 { error: string }
 *   503 { error: string, gscConnected: false }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getGscOpportunities } from '@/lib/keywords/gsc-opportunities';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req as import('next/server').NextRequest);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawDomain = searchParams.get('domain')?.trim();
    const siteId = searchParams.get('siteId')?.trim();

    if (!rawDomain && !siteId) {
        return NextResponse.json({ error: 'Missing required query param: domain or siteId' }, { status: 400 });
    }

    const normalizedDomain = rawDomain
        ? rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase()
        : undefined;

    const site = await prisma.site.findFirst({
        where: {
            userId: user.id,
            ...(siteId ? { id: siteId } : {}),
            ...(normalizedDomain
                ? {
                      OR: [
                          { domain: { equals: normalizedDomain, mode: 'insensitive' } },
                          { domain: { equals: `www.${normalizedDomain}`, mode: 'insensitive' } },
                          { domain: { equals: rawDomain, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        },
        select: { id: true, domain: true },
    });

    if (!site) {
        return NextResponse.json({ error: 'Site not found or access denied' }, { status: 404 });
    }

    try {
        const opportunities = await getGscOpportunities(user.id, site.domain, { throwOnAuthError: true });

        return NextResponse.json({
            opportunities,
            source: opportunities.length > 0 ? 'gsc' : 'none',
            count: opportunities.length,
        });
    } catch (err: unknown) {
        const message = (err as Error)?.message || 'Unknown error';

        // Surface GSC connection errors to the UI so it can prompt reconnect
        if (message === 'GSC_NOT_CONNECTED') {
            return NextResponse.json({ error: 'GSC not connected', gscConnected: false }, { status: 503 });
        }
        if (message === 'GSC_REFRESH_TOKEN_MISSING' || message === 'GSC_TOKEN_REFRESH_FAILED') {
            return NextResponse.json({ error: 'GSC token expired — please reconnect', gscConnected: false }, { status: 503 });
        }

        return NextResponse.json({ error: message }, { status: 500 });
    }
}
