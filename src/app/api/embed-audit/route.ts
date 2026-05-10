import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getFullAuditEngine } from "@/lib/seo-audit";
import { Resend } from "resend";
import { isSafeUrl } from "@/lib/security/safe-url";

const MAX_DAILY = 100;

// Critical fix: user-supplied `url` is now validated through isSafeUrl() before
// being passed to engine.runAudit(). Previously any URL (including internal
// addresses like http://169.254.169.254/latest/meta-data/) could be submitted
// via the embed widget, making this an unauthenticated SSRF endpoint.

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { url, leadEmail, embedKey } = body as {
        url?: string;
        leadEmail?: string;
        embedKey?: string;
    };

    if (!url || !embedKey)
        return NextResponse.json({ error: "Missing url or embedKey" }, { status: 400 });

    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const safeCheck = isSafeUrl(normalized);
    if (!safeCheck.ok || !safeCheck.url) {
        return NextResponse.json({ error: safeCheck.error ?? "Invalid URL" }, { status: 400 });
    }
    const targetUrl = safeCheck.url.href;

    const owner = await prisma.user.findFirst({
        where: { whiteLabel: { path: ["embedKey"], equals: embedKey } },
        select: { id: true, email: true, name: true, subscriptionTier: true, whiteLabel: true },
    });
    if (!owner)
        return NextResponse.json({ error: "Invalid embed key" }, { status: 403 });

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const useCount = await prisma.embedLead.count({
        where: { embedKey, createdAt: { gte: today } },
    });
    if (useCount >= MAX_DAILY)
        return NextResponse.json({ error: "Daily limit reached. Please try again tomorrow." }, { status: 429 });

    let scores: Record<string, number> = {};
    const domain = safeCheck.url.hostname;
    try {
        const engine = getFullAuditEngine();
        const result = await engine.runAudit(targetUrl);
        scores = result.categories.reduce(
            (acc: Record<string, number>, c: { id: string; score: number }) => {
                acc[c.id] = c.score;
                return acc;
            },
            {}
        );
    } catch {
        scores = { error: -1 };
    }

    if (leadEmail) {
        await prisma.embedLead.create({
            data: { ownerId: owner.id, email: leadEmail, domain, scores, embedKey },
        });

        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
            try {
                const resend = new Resend(resendKey);
                await resend.emails.send({
                    from: `OptiAISEO <notifications@${process.env.RESEND_FROM_DOMAIN}>`,
                    to: owner.email!,
                    subject: `New SEO lead from your widget — ${domain}`,
                    html: `
                    <p>Hi ${owner.name ?? "there"},</p>
                    <p>A new visitor analysed their site through your OptiAISEO embed widget:</p>
                    <ul>
                        <li><strong>Domain:</strong> ${domain}</li>
                        <li><strong>Email:</strong> ${leadEmail}</li>
                        <li><strong>Scores:</strong> ${JSON.stringify(scores)}</li>
                    </ul>
                    <p>View your leads in <a href="https://optiaiseo.online/dashboard/settings?tab=embed">your Agency settings</a>.</p>
                    `.trim(),
                });
            } catch {
                // Non-fatal — lead still saved
            }
        }
    }

    const response = NextResponse.json({ scores, domain });
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    return response;
}
