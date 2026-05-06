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
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGscOpportunities } from '@/lib/keywords/gsc-opportunities';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
    const user = await getAuthUser(req as import('next/server').NextRequest);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain')?.trim();

    if (!domain) {
        return NextResponse.json({ error: 'Missing required query param: domain' }, { status: 400 });
    }

    try {
        const opportunities = await getGscOpportunities(user!.id, domain);

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
