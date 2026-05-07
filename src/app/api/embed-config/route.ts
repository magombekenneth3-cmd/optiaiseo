/**
 * GET /api/embed-config?key=AGENCY_KEY
 *
 * Returns public widget configuration for an agency embed key.
 * Used by embed.js to personalise headline, button label, and logo.
 * No auth required — data is non-sensitive (display config only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';



interface WhiteLabel {
    embedKey?: string;
    headline?: string;
    buttonLabel?: string;
    logoUrl?: string;
    primaryColor?: string;
    redirectUrl?: string;
    webhookUrl?: string;
}

export async function GET(req: NextRequest) {
    const key = req.nextUrl.searchParams.get('key');
    if (!key) {
        return NextResponse.json({ error: 'Missing key' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
        where: { whiteLabel: { path: ['embedKey'], equals: key } },
        select: { whiteLabel: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'Invalid embed key' }, { status: 404 });
    }

    const wl = (user.whiteLabel ?? {}) as WhiteLabel;

    // Only expose public display fields — never expose webhookUrl etc.
    return NextResponse.json(
        {
            headline: wl.headline ?? "What's your SEO score?",
            buttonLabel: wl.buttonLabel ?? 'Free SEO Score',
            logoUrl: wl.logoUrl ?? null,
            primaryColor: wl.primaryColor ?? '#10b981',
        },
        {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
                'Access-Control-Allow-Origin': '*',
            },
        }
    );
}
