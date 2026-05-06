/**
 * GET /api/free/progress/[auditId]
 *
 * Server-Sent Events stream that polls FreeAudit.status every 2 s and pushes
 * progress events to the client until status is DONE or FAILED.
 *
 * Event format (newline-delimited):
 *   data: {"progress":40,"step":"Analysing technical setup...","status":"RUNNING"}
 *
 * On completion:
 *   data: {"progress":100,"step":"Done","status":"DONE","redirectTo":"/free/results/[id]"}
 *
 * No auth required — auditId is a cuid (unguessable).
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { rateLimit, getClientIp } from '@/lib/rate-limit/check';

export const runtime = 'nodejs';
// Allow long-lived SSE connections (max 60 s on Edge/Vercel hobby; increase on Pro)
export const maxDuration = 90;

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 44; // 44 × 2 s ≈ 88 s — gives cold Railway containers room to finish

function sseChunk(payload: Record<string, unknown>): Uint8Array {
    return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ auditId: string }> }
) {
    const ip = getClientIp(req);
    const limited = await rateLimit("auditProgress", ip);
    if (limited) return limited;

    const { auditId } = await params;

    if (!auditId || typeof auditId !== 'string') {
        return new Response('Missing auditId', { status: 400 });
    }

    const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable Nginx buffering
        'Access-Control-Allow-Origin': '*',
    };

    let polls = 0;

    const stream = new ReadableStream({
        async start(controller) {
            const send = (payload: Record<string, unknown>) => {
                try {
                    controller.enqueue(sseChunk(payload));
                } catch {
                    // client disconnected — swallow
                }
            };

            const finish = (payload: Record<string, unknown>) => {
                send(payload);
                try { controller.close(); } catch { /* already closed */ }
            };

            const initial = await prisma.freeAudit
                .findUnique({ where: { id: auditId }, select: { status: true, progress: true, currentStep: true } })
                .catch(() => null);

            if (!initial) {
                finish({ status: 'FAILED', error: 'Audit not found', progress: 0 });
                return;
            }

            if (initial.status === 'DONE') {
                finish({ status: 'DONE', progress: 100, step: 'Complete', redirectTo: `/free/results/${auditId}` });
                return;
            }
            if (initial.status === 'FAILED') {
                finish({ status: 'FAILED', progress: 0, step: 'Failed', error: 'Audit failed' });
                return;
            }

            // Poll every POLL_INTERVAL_MS
            const poll = async () => {
                if (polls++ >= MAX_POLLS) {
                    finish({ status: 'FAILED', progress: 0, step: 'Timed out', error: 'Audit is taking too long — please try again.' });
                    return;
                }

                const row = await prisma.freeAudit
                    .findUnique({
                        where: { id: auditId },
                        select: { status: true, progress: true, currentStep: true },
                    })
                    .catch(() => null);

                if (!row) {
                    finish({ status: 'FAILED', error: 'Audit not found', progress: 0 });
                    return;
                }

                const payload: Record<string, unknown> = {
                    status: row.status,
                    progress: row.progress ?? 0,
                    step: row.currentStep ?? 'Processing...',
                };

                if (row.status === 'DONE') {
                    finish({ ...payload, progress: 100, step: 'Complete ✓', redirectTo: `/free/results/${auditId}` });
                    return;
                }

                if (row.status === 'FAILED') {
                    finish({ ...payload, step: 'Failed', error: 'Audit could not complete' });
                    return;
                }

                send(payload);
                setTimeout(poll, POLL_INTERVAL_MS);
            };

            setTimeout(poll, 500);
        },
    });

    return new Response(stream, { headers });
}
