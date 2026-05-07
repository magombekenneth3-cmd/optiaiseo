export const dynamic = "force-dynamic";
import { logger } from "@/lib/logger";
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmbedding, cosineSimilarity } from "@/lib/aeo/embeddings";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
    try {
        const user = await getAuthUser(req as NextRequest);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const rl = await checkRateLimit('aeo-verify:' + user!.id, 20, 86400);
        if (!rl.allowed) {
            return NextResponse.json({ error: 'Verification limit reached (20/day). Resets in 24 hours.', resetAt: rl.resetAt }, { status: 429 });
        }

        const { domain, claim } = await req.json();

        if (!domain || !claim) {
            return NextResponse.json({ error: "Domain and claim are required" }, { status: 400 });
        }

        const site = await prisma.site.findFirst({
            where: { domain, userId: user!.id },
            include: {
                brandFacts: {
                    where: { verified: true }
                }
            }
        });

         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!site || (site as any).brandFacts.length === 0) {
            return NextResponse.json({
                verified: false,
                confidence: 0,
                message: "Site not found or no verified brand facts available."
            }, { status: 404 });
        }

        // 2026 Optimization: Semantic Vector Verification
        const claimEmbedding = await getEmbedding(claim);
        if (claimEmbedding.length === 0) {
            throw new Error("Failed to generate claim embedding.");
        }
  

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await Promise.all((site as any).brandFacts.map(async (fact: any) => {
            const factEmbedding = await getEmbedding(fact.value);
            const similarity = cosineSimilarity(claimEmbedding, factEmbedding);
            return {
                fact,
                similarity
            };
        }));
  

        // Sort by similarity and find the best match
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bestMatch = results.sort((a: any, b: any) => b.similarity - a.similarity)[0];
        const threshold = 0.85;

        if (bestMatch && bestMatch.similarity >= threshold) {
            return NextResponse.json({
                verified: true,
                confidence: bestMatch.similarity,
                matchingFacts: [{
                    type: bestMatch.fact.factType,
                    value: bestMatch.fact.value,
                    sourceUrl: bestMatch.fact.sourceUrl
                }],
                message: "Claim verified against authoritative OptiAISEO Knowledge Graph via semantic similarity."
            });
        }

        return NextResponse.json({
            verified: false,
            confidence: bestMatch ? bestMatch.similarity : 0,
             
            message: "No semantically matching verified facts found in the Knowledge Graph."
        });

     
    } catch (error: unknown) {
        logger.error("[Verification API] Error:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
