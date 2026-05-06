/**
 * GET /api/free/og/[auditId]
 *
 * Dynamically generates a 1200×630 Open Graph score card image using
 * Next.js ImageResponse. No auth required.
 */

import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';

function scoreColor(score: number): string {
    if (score >= 80) return '#10b981'; // emerald
    if (score >= 50) return '#f59e0b'; // amber
    return '#ef4444';                  // red
}

function scoreGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ auditId: string }> }
) {
    const { auditId } = await params;

    const audit = await prisma.freeAudit
        .findUnique({
            where: { id: auditId },
            select: { domain: true, overallScore: true, categoryScores: true, topRecs: true },
        })
        .catch(() => null);

    const domain = audit?.domain ?? 'your site';
    const score = audit?.overallScore ?? 0;
    const grade = scoreGrade(score);
    const color = scoreColor(score);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cats = (audit?.categoryScores ?? {}) as any;

    const bars: { label: string; value: number }[] = [
        { label: 'On-Page', value: cats.onPage ?? 0 },
        { label: 'Technical', value: cats.technical ?? 0 },
        { label: 'Content', value: cats.contentQuality ?? 0 },
    ];

    return new ImageResponse(
        (
            <div
                style={{
                    width: '1200px',
                    height: '630px',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    fontFamily: 'system-ui, sans-serif',
                    color: 'white',
                    padding: '64px',
                    position: 'relative',
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '40px' }}>
                    <div style={{ fontSize: '18px', color: '#94a3b8', fontWeight: 600 }}>
                        OptiAISEO — Free SEO Audit
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '80px', alignItems: 'center', flex: 1 }}>
                    {/* Score circle */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                        <div
                            style={{
                                width: '200px',
                                height: '200px',
                                borderRadius: '50%',
                                border: `8px solid ${color}`,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: `${color}18`,
                                boxShadow: `0 0 60px ${color}40`,
                            }}
                        >
                            <div style={{ fontSize: '72px', fontWeight: 900, color, lineHeight: 1 }}>
                                {grade}
                            </div>
                            <div style={{ fontSize: '22px', color: '#94a3b8', marginTop: '4px' }}>
                                {score}/100
                            </div>
                        </div>
                        <div style={{ fontSize: '16px', color: '#64748b', textAlign: 'center' }}>
                            SEO Score
                        </div>
                    </div>

                    {/* Right column */}
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '24px' }}>
                        <div style={{ fontSize: '38px', fontWeight: 800, lineHeight: 1.2 }}>
                            {domain}
                        </div>

                        {/* Category bars */}
                        {bars.map((bar) => (
                            <div key={bar.label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: '#94a3b8' }}>
                                    <span>{bar.label}</span>
                                    <span style={{ color: scoreColor(bar.value), fontWeight: 700 }}>{bar.value}/100</span>
                                </div>
                                <div style={{ height: '10px', background: '#1e293b', borderRadius: '5px', overflow: 'hidden', border: '1px solid #334155' }}>
                                    <div
                                        style={{
                                            height: '100%',
                                            width: `${bar.value}%`,
                                            background: scoreColor(bar.value),
                                            borderRadius: '5px',
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '32px', color: '#475569', fontSize: '14px' }}>
                    <span>www.optiaiseo.online</span>
                    <span>Get your free audit → www.optiaiseo.online/free</span>
                </div>
            </div>
        ),
        { width: 1200, height: 630 }
    );
}
