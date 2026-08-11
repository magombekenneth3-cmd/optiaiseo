import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { probeLlmDirectSearch, DirectProbeModel } from "@/lib/gsov/llm-direct-probe";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { query, targetDomain, models } = body as {
            query: string;
            targetDomain: string;
            models?: DirectProbeModel[];
        };

        if (!query || !targetDomain) {
            return NextResponse.json({ error: "Missing required query or targetDomain" }, { status: 400 });
        }

        const probeSummary = await probeLlmDirectSearch(query, targetDomain, models);

        return NextResponse.json({
            success: true,
            summary: probeSummary,
        });
    } catch (err: unknown) {
        const error = err instanceof Error ? err.message : "LLM direct probe execution failed";
        return NextResponse.json({ error }, { status: 500 });
    }
}
