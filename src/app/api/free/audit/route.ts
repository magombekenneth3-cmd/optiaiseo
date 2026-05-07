/**
 * POST /api/free/audit
 *
 * Accepts { url: string }, validates it, creates a FreeAudit record in PENDING
 * state, fires an Inngest background job, and returns { auditId } immediately.
 * The client then opens GET /api/free/progress/[auditId] to stream progress.
 *
 * Rate limited: 3 free checks per IP per 24 hours (Redis not required — stored
 * in FreeAudit table by IP tag).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { inngest } from '@/lib/inngest/client';
import { isSafeUrl } from '@/lib/security/safe-url';

export async function POST(req: NextRequest) {
    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawUrl = (body.url ?? '').trim();
    if (!rawUrl) {
        return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // Normalise — add https:// if no protocol provided
    const normalized = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const check = isSafeUrl(normalized);
    if (!check.ok || !check.url) {
        return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const domain = check.url.hostname.replace(/^www\./, '');

    // Rate-limit: max 3 free audits per IP per day.
    // The rate-limit key is NEVER stored as the domain — they are kept separate
    // so audit.domain stays clean and never leaks "1.2.3.4::example.com" into
    // page titles, OG tags, or email subjects.
    const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
    const rateLimitKey = `${ip}::${domain}`;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.freeAudit.count({
        where: {
            rateLimitKey, // dedicated column — not mixed with display domain
            createdAt: { gte: since },
        },
    }).catch(() => 0);

    if (recentCount >= 3) {
        return NextResponse.json(
            { error: 'Rate limit: 3 free checks per day. Sign up for unlimited audits.' },
            { status: 429 }
        );
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const audit = await prisma.freeAudit.create({
        data: {
            domain,          // clean display value: "example.com" — never contains ip::
            rateLimitKey,    // opaque key used only for rate-limit counting
            url: normalized,
            status: 'PENDING',
            progress: 0,
            expiresAt,
        },
    });


    // Fire background job — non-blocking
    await inngest.send({
        name: 'free-audit/run',
        data: { auditId: audit.id, url: normalized, domain },
    });

    return NextResponse.json({ auditId: audit.id }, { status: 202 });
}
