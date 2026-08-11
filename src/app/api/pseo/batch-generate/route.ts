import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { inngest } from "@/lib/inngest/client";
import { PseoBatchRequest } from "@/lib/pseo/generator";

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as PseoBatchRequest;

        if (!body.pattern || !Array.isArray(body.dataset) || body.dataset.length === 0) {
            return NextResponse.json(
                { error: "Pattern string and dataset array are required." },
                { status: 400 }
            );
        }

        const batchJobId = `pseo-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const siteDomain = body.siteDomain || "example.com";

        // Dispatch background processing event to Inngest
        await inngest.send({
            name: "pseo/batch.requested",
            data: {
                ...body,
                siteDomain,
                siteId: body.siteId || "default-site",
                authorName: body.authorName || "OptiAISEO Engine",
                batchJobId,
            }
        });

        logger.info("[pSEO/API] Dispatched async batch generation job", {
            batchJobId,
            pattern: body.pattern,
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
