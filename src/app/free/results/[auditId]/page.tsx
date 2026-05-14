

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import FreeResultClient from './FreeResultClient';

interface Props {
    params: Promise<{ auditId: string }>;
}

interface Rec {
    label: string;
    recommendation: string;
    priority: 'High' | 'Medium' | 'Low';
    categoryId: string;
    finding: string;
    priorityScore: number;
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
    const appUrl = process.env.NEXTAUTH_URL ?? 'https://optiaiseo.online';

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

    const allRecs = Array.isArray(audit.allRecs) ? (audit.allRecs as unknown as Rec[]) : [];
    const totalRecCount = allRecs.length;

    const issueStats = {
        total:    totalRecCount,
        errors:   allRecs.filter(r => r.priority === 'High').length,
        warnings: allRecs.filter(r => r.priority === 'Medium').length,
        notices:  allRecs.filter(r => r.priority === 'Low').length,
    };

    const quickWins = [...allRecs]
        .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
        .slice(0, 3);

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
            totalRecCount={totalRecCount}
            grade={scoreGrade(audit.overallScore ?? 0)}
            createdAt={audit.createdAt.toISOString()}
            issueStats={issueStats}
            quickWins={quickWins}
        />
    );
}
