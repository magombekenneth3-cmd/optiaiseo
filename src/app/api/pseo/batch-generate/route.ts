import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { generatePseoBatch, PseoBatchRequest } from "@/lib/pseo/generator";

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as PseoBatchRequest;

        if (!body.pattern || !Array.isArray(body.dataset) || body.dataset.length === 0) {
            return NextResponse.json(
                { error: "Pattern string and dataset array are required." },
                { status: 400 }
            );
        }

        const siteDomain = body.siteDomain || "example.com";
        const result = await generatePseoBatch({
            pattern: body.pattern,
            dataset: body.dataset,
            siteId: body.siteId || "default-site",
            siteDomain,
            authorName: body.authorName || "OptiAISEO Engine",
        });

        logger.info("[pSEO/API] Batch generated successfully", {
            pattern: body.pattern,
            count: result.totalGenerated,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: unknown) {
        logger.error("[pSEO/API] Batch generation failed:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json(
            { error: "Failed to generate pSEO batch." },
            { status: 500 }
        );
    }
}
