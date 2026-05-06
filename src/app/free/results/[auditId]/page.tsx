/**
 * /free/results/[auditId]
 *
 * Publicly accessible result page (no login required).
 * Shows: score card, category bars, top 3 recs free, rest gated behind email.
 * Full OG meta tags for rich social preview.
 * Mobile-optimised: 120px score circle, stacked bars, Web Share API.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import FreeResultClient from './FreeResultClient';

interface Props {
    params: Promise<{ auditId: string }>;
}

function scoreGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { auditId } = await params;
    const appUrl = process.env.NEXTAUTH_URL ?? 'https://www.optiaiseo.online';

    const audit = await prisma.freeAudit
        .findUnique({
            where: { id: auditId },
            select: { domain: true, overallScore: true, topRecs: true, expiresAt: true },
        })
        .catch(() => null);

    if (!audit || audit.expiresAt < new Date()) {
        return { title: 'Audit Expired | OptiAISEO' };
    }

    const score = audit.overallScore ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topRec = ((audit.topRecs as any[])?.[0]?.recommendation as string | undefined) ?? 'Get actionable SEO improvements for your site.';
    const ogImageUrl = `${appUrl}/api/free/og/${auditId}`;

    return {
        title: `${audit.domain} SEO Score: ${score}/100 | OptiAISEO`,
        description: topRec,
        openGraph: {
            title: `${audit.domain} SEO Score: ${score}/100`,
            description: topRec,
            images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `SEO Score Card for ${audit.domain}` }],
            url: `${appUrl}/free/results/${auditId}`,
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title: `${audit.domain} SEO Score: ${score}/100`,
            description: topRec,
            images: [ogImageUrl],
        },
        alternates: { canonical: `${appUrl}/free/results/${auditId}` },
    };
}

export default async function FreeResultPage({ params }: Props) {
    const { auditId } = await params;

    const audit = await prisma.freeAudit
        .findUnique({
            where: { id: auditId },
            select: {
                id: true,
                domain: true,
                url: true,
                overallScore: true,
                categoryScores: true,
                topRecs: true,
                allRecs: true,
                status: true,
                expiresAt: true,
                createdAt: true,
            },
        })
        .catch(() => null);

    if (!audit) notFound();
    if (audit.expiresAt < new Date()) {
        return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
            <div className="text-center">
                <p className="text-4xl mb-4">⏳</p>
                <h1 className="text-xl font-bold text-foreground mb-2">Audit Expired</h1>
                <p className="text-muted-foreground text-sm mb-6">This report is older than 7 days.</p>
                <a
                    href="/free/seo-checker"
                    className="btn-brand px-6 py-3 rounded-xl text-sm"
                >
                    Run a New Free Audit
                </a>
            </div>
        </div>
        );
    }

    return (
        <FreeResultClient
            auditId={audit.id}
            domain={audit.domain}
            url={audit.url}
            overallScore={audit.overallScore ?? 0}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            categoryScores={(audit.categoryScores as any) ?? {}}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            topRecs={(audit.topRecs as any[]) ?? []}
            totalRecCount={Array.isArray(audit.allRecs) ? audit.allRecs.length : 0}
            grade={scoreGrade(audit.overallScore ?? 0)}
            createdAt={audit.createdAt.toISOString()}
        />
    );
}
