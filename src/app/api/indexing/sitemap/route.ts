import { getAuthUser } from "@/lib/auth/get-auth-user";
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { requireTiers, guardErrorToResult } from '@/lib/stripe/guards';
import { prisma } from '@/lib/prisma';
import { safeFetch } from '@/lib/api/safe-fetch';

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user!.id)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Paid gate
    const dbUser = await prisma.user.findUnique({
        where: { id: user!.id },
        select: { subscriptionTier: true, trialEndsAt: true },
    });
    try {
        await requireTiers(user!.id, ['PRO', 'AGENCY']);
    } catch (err) {
        return NextResponse.json({ error: guardErrorToResult(err).error }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const sitemapUrl: unknown = body?.sitemapUrl;

    if (!sitemapUrl || typeof sitemapUrl !== 'string') {
        return NextResponse.json({ error: 'Missing sitemapUrl' }, { status: 400 });
    }

    // SSRF guard — validates protocol, blocks private IPs, localhost, and
    // internal hostnames. Also validates any redirect destination before
    // following it, preventing redirect-to-internal-address attacks.
    const result = await safeFetch(sitemapUrl, {
        headers: { 'User-Agent': 'OptiAISEO-Bot/1.0' },
        timeoutMs: 10_000,
    });

    if (!result.ok) {
        return NextResponse.json(
            { error: result.error ?? 'Failed to fetch sitemap' },
            { status: result.status === undefined ? 400 : 502 },
        );
    }

    const xml = result.text!;

    // Extract all <loc> tags
    const urls = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
        .map(m => m[1].trim())
        .filter(u => u.startsWith('https://') || u.startsWith('http://'))
        .slice(0, 500); // cap at 500 per import

    return NextResponse.json({ urls, count: urls.length });
}
