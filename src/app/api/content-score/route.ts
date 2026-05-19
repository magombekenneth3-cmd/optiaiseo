import { logger } from "@/lib/logger";
import "@/lib/server-only";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { scoreContent } from "@/lib/content-scoring";

export async function POST(req: Request) {
    try {
        const user = await getAuthUser(req as import("next/server").NextRequest);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Dynamic rate limiting based on user tier:
        // FREE: 3/min, STARTER: 10/min, PRO: 25/min, AGENCY: 60/min
        const { getEffectiveTier } = await import("@/lib/stripe/guards");
        const tier = await getEffectiveTier(user.id);
        let limit = 3;
        if (tier === "STARTER") limit = 10;
        else if (tier === "PRO") limit = 25;
        else if (tier === "AGENCY") limit = 60;

        const rateLimitResult = await checkRateLimit(`content-score:${user.id}`, limit, 60);
        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: "Too many requests. Please wait a moment." },
                { status: 429 }
            );
        }

        const body = await req.json();
        const { content, targetKeyword, additionalKeywords = [] } = body;

        if (!targetKeyword) {
            return NextResponse.json(
                { error: "targetKeyword is required" },
                { status: 400 }
            );
        }

        const keywords = [targetKeyword, ...additionalKeywords];

        try {
            const result = await scoreContent(content, keywords);
            return NextResponse.json(result);
         
         
        } catch (err: unknown) {
            logger.error("[ContentScoreAPI] Scoring failed:", { error: (err as Error)?.message || String(err) });
            // Graceful fallback: return a zero-score shape so the editor doesn't
            // crash, but include error: "scoring_failed" so the UI can show an
            // error banner instead of displaying misleading 0/100 progress bars.
            // FIX: previously the UI had no way to distinguish score=0 (truly bad
            // content) from score=0 (API failure), leading to confusing UX.
            return NextResponse.json({
                error: "scoring_failed",
                score: 0,
                subScores: {
                    wordCount: { score: 0, current: 0, targetMin: 0, targetMax: 0 },
                    exactKeywords: { score: 0, current: 0, targetMin: 0, targetMax: 0 },
                    nlpTerms: { score: 0, covered: [], missing: [] },
                    headings: { score: 0, covered: [], missing: [] },
                    readability: { score: 0, gradeLevel: 0 },
                },
                competitors: [],
                topOpportunities: ["Content scoring failed — SERP API may be unavailable. Try again shortly."],
                entities: [],
                keywordDensity: {},
                sentiment: "Error",
                readabilityScore: 0,
            });
         
        }
     
    } catch (error: unknown) {
        logger.error("[ContentScoreAPI] Error:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
