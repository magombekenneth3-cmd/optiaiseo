import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { detectContentDecay } from "@/lib/gsc/decay-detector";
import { reoptimizeDecayedPost } from "@/lib/gsc/decay-reoptimizer";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { siteId, autoFix = false, thresholdPercent = 15 } = body as {
            siteId: string;
            autoFix?: boolean;
            thresholdPercent?: number;
        };

        if (!siteId) {
            return NextResponse.json({ error: "Missing required siteId" }, { status: 400 });
        }

        const decayedPosts = await detectContentDecay(siteId, thresholdPercent);
        const reoptimizedResults = [];

        if (autoFix && decayedPosts.length > 0) {
            for (const post of decayedPosts) {
                const fixRes = await reoptimizeDecayedPost(post.blogId);
                reoptimizedResults.push(fixRes);
            }
        }

        return NextResponse.json({
            success: true,
            totalDecayed: decayedPosts.length,
            decayedPosts,
            reoptimizedResults,
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "Content decay audit failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
