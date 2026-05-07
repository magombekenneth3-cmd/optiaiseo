/**
 * POST /api/aeo/mention-flag
 *
 * Gap 2 — user-flagged brand mention correction.
 * Creates a MentionCorrectionLog row so we can build a correction dataset
 * and feed it back into detection calibration.
 *
 * Body: {
 *   siteId:       string
 *   keyword:      string
 *   modelName:    string
 *   correctValue: boolean  // true = brand WAS cited, false = was NOT cited
 *   rawSnippet?:  string   // first 500 chars of the model response
 * }
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: {
        siteId: string;
        keyword: string;
        modelName?: string;
        correctValue: boolean;
        rawSnippet?: string;
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { siteId, keyword, modelName, correctValue, rawSnippet } = body;

    if (!siteId || typeof keyword !== "string" || typeof correctValue !== "boolean") {
        return NextResponse.json(
            { error: "Missing required fields: siteId, keyword, correctValue" },
            { status: 400 },
        );
    }

    // Ownership check — only the site owner may flag detections
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true },
    });
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    try {
        await prisma.mentionCorrectionLog.create({
            data: {
                siteId,
                keyword: keyword.trim().toLowerCase(),
                modelName: (modelName ?? "gemini").toLowerCase(),
                correctValue,
                rawSnippet: rawSnippet ? rawSnippet.slice(0, 500) : null,
            },
        });

        logger.info("[MentionFlag] Correction logged", {
            siteId,
            keyword,
            correctValue,
        });

        return NextResponse.json({ success: true });
    } catch (err) {
        logger.error("[MentionFlag] Failed to create correction log", {
            error: (err as Error)?.message,
        });
        return NextResponse.json({ error: "Failed to save flag" }, { status: 500 });
    }
}
