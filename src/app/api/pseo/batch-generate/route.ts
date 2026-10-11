import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { inngest } from "@/lib/inngest/client";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { assertSiteAccess } from "@/lib/auth/require-user";

/**
 * POST /api/pseo/batch-generate
 *
 * Security: previously unauthenticated — anyone could enqueue LLM generation
 * against an arbitrary siteId/domain. Now requires an authenticated user with
 * EDIT access to the target site; the domain is taken from the site record,
 * never from the request body, and batch size is bounded.
 */

const MAX_BATCH_ROWS = 200;

const BatchRequestSchema = z.object({
    siteId: z.string().trim().min(1).max(50),
    pattern: z.string().trim().min(1).max(500),
    dataset: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_BATCH_ROWS),
    authorName: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = BatchRequestSchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            { error: `siteId, pattern and a dataset of 1-${MAX_BATCH_ROWS} rows are required.` },
            { status: 400 },
        );
    }
    const body = parsed.data;

    const site = await assertSiteAccess(body.siteId, user.id, "EDIT");
    if (!site) {
        return NextResponse.json({ error: "Site not found or unauthorized" }, { status: 404 });
    }

    try {
        const batchJobId = `pseo-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // Dispatch background processing event to Inngest
        await inngest.send({
            name: "pseo/batch.requested",
            data: {
                pattern: body.pattern,
                dataset: body.dataset,
                siteId: site.id,
                siteDomain: site.domain,
                authorName: body.authorName || "OptiAISEO Engine",
                batchJobId,
            },
        });

        logger.info("[pSEO/API] Dispatched async batch generation job", {
            batchJobId,
            siteId: site.id,
            rowCount: body.dataset.length,
        });

        return NextResponse.json({
            success: true,
            status: "ACCEPTED",
            batchJobId,
            totalQueued: body.dataset.length,
            message: "Batch generation job accepted and processing asynchronously in background."
        }, { status: 202 });
    } catch (error: unknown) {
        logger.error("[pSEO/API] Batch dispatch failed:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json(
            { error: "Failed to queue pSEO batch job." },
            { status: 500 }
        );
    }
}
