import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkKgFeedLimit } from "@/lib/rate-limit";
import { buildKnowledgeGraph } from "@/lib/aeo/kg-builder";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain");

    if (!domain) {
        return NextResponse.json({ error: "Domain parameter required" }, { status: 400 });
    }

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id || !session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized. A valid session is required." }, { status: 401 });
        }

        const tier = (session!.user as { subscriptionTier?: string }).subscriptionTier || "FREE";
        const limitCheck = await checkKgFeedLimit(session!.user!.id, tier ?? "FREE");

        if (!limitCheck.allowed) {
            return NextResponse.json(
                { error: `Rate limit exceeded. You have used all your KG feed generations for this period.` },
                { status: 429 }
            );
        }

        const kg = await buildKnowledgeGraph(domain);

        if (!kg) {
            return NextResponse.json({ error: "Site not found or Knowledge Graph unavailable" }, { status: 404 });
        }

        return NextResponse.json(kg, {
            headers: {
                "Content-Type": "application/ld+json",
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
            }
        });
     
     
    } catch (error: unknown) {
        logger.error("[KG Feed] Error:", { error: (error as Error)?.message || String(error) });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
