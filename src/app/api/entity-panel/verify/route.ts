// POST /api/entity-panel/verify
// Verifies a single brand fact against Gemini's internal knowledge.
// Rate limited: 10 verifications per user per hour (sliding window).
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_3_FLASH } from "@/lib/constants/ai-models";
import { rateLimit, checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

// ─── Limiter ──────────────────────────────────────────────────────────────────
// Uses the monthly checkRateLimit helper with a rolling hourly key so we
// don't need to add a new named limiter to burst/client.ts.

const VERIFY_LIMIT_PER_HOUR = 10;

async function checkVerifyLimit(userId: string) {
    // Rolling hourly window: key resets every 60 minutes
    const windowKey = `kg-verify:${userId}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    return checkRateLimit(windowKey, VERIFY_LIMIT_PER_HOUR, 60 * 60);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Burst guard — also apply the named api limiter
    const limited = await rateLimit("api", user.id);
    if (limited) return limited;

    // Hourly per-user cap for expensive Gemini calls
    const limitResult = await checkVerifyLimit(user.id);
    if (!limitResult.allowed) {
        return NextResponse.json(
            { error: `Verification limit reached. You can verify up to ${VERIFY_LIMIT_PER_HOUR} facts per hour.` },
            {
                status: 429,
                headers: {
                    "Retry-After": String(Math.ceil((limitResult.resetAt.getTime() - Date.now()) / 1000)),
                },
            }
        );
    }

    const body = await req.json().catch(() => null);
    if (!body)
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { factId, domain, factType, value } = body as {
        factId?: string;
        domain?: string;
        factType?: string;
        value?: string;
    };

    if (!domain || !factType || !value)
        return NextResponse.json({ error: "domain, factType, and value are required" }, { status: 400 });

    // If factId provided, verify ownership before proceeding
    if (factId) {
        const fact = await prisma.brandFact.findFirst({
            where: { id: factId },
            include: { site: { select: { userId: true } } },
        });
        if (!fact || fact.site.userId !== user.id)
            return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    }

    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: "Gemini API not configured" }, { status: 503 });
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const prompt = `You are verifying a brand fact for a Knowledge Graph.
Domain: ${domain}
Fact type: ${factType}
Claimed value: "${value}"

Based on your internal knowledge about ${domain}, is this fact accurate?
If you don't have knowledge about this domain, say so.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "known": boolean,
  "aiKnows": boolean,
  "matches": boolean,
  "actualValue": "string or null",
  "explanation": "one sentence explanation"
}`;

        const result = await ai.models.generateContent({
            model: GEMINI_3_FLASH,
            contents: prompt,
            config: { responseMimeType: "application/json" },
        });

        const text = result.text?.trim() || "{}";
        const clean = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        const data = JSON.parse(clean) as {
            known?: boolean;
            aiKnows?: boolean;
            matches?: boolean;
            actualValue?: string | null;
            explanation?: string;
        };

        const aiKnows = !!(data.known || data.aiKnows);
        const verified = aiKnows && !!data.matches;
        const verificationStatus: "verified" | "hallucination" | "unknown" = aiKnows
            ? data.matches
                ? "verified"
                : "hallucination"
            : "unknown";

        // Persist the verified flag if factId was provided
        if (factId && verified) {
            await prisma.brandFact.update({
                where: { id: factId },
                data: { verified: true },
            }).catch(() => {/* non-fatal */});
        }

        return NextResponse.json({
            verificationStatus,
            verified,
            aiKnows,
            explanation: data.explanation ?? null,
            actualValue: data.actualValue ?? null,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Verification failed: ${message}` }, { status: 500 });
    }
}
