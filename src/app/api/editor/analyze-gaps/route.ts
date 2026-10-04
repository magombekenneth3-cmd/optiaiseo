import { logger } from "@/lib/logger";
import "@/lib/server-only";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import type { GapAnalysisResponse, IdentifiedGap } from "@/lib/editor/gap-types";

export const dynamic = "force-dynamic";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

const Body = z.object({
    content: z.string().min(50).max(100000),
    targetKeyword: z.string().max(200).optional().default(""),
});

const SYSTEM = `You are a senior SEO strategist and editor. Analyze the draft for SEO gaps (search intent, keyword placement, entity/definition coverage, heading hierarchy, answer-ready passages) and readability gaps (long sentences, passive voice, filler, jargon, rhythm).
Return 4-8 high-impact gaps. For each, "originalSnippet" MUST be copied verbatim (1-3 consecutive sentences) from the draft. "suggestedReplacement" rewrites that snippet to fix the issue in the author's tone.
Reply with JSON only, no code fences:
{"seoScore":0-100,"readabilityScore":0-100,"overallSummary":"1-2 sentences","gaps":[{"id":"gap-1","type":"seo"|"readability","severity":"critical"|"warning"|"opportunity","category":"short label","title":"short issue","explanation":"why it matters","originalSnippet":"verbatim","suggestedReplacement":"rewrite","impact":"expected benefit"}]}
Keep the whole reply under 1500 words.`;

export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await checkRateLimit(`gap-analysis:${user.id}`, 10, 60);
    if (!rl.allowed) return NextResponse.json({ error: "Too many analyses — wait a minute and try again." }, { status: 429 });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Draft must be at least 50 characters." }, { status: 422 });
    const { content, targetKeyword } = parsed.data;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "AI analysis is not configured (LOVABLE_API_KEY missing)." }, { status: 500 });

    const upstream = await fetch(GATEWAY_URL, {
        method: "POST",
        signal: req.signal,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Lovable-API-Key": apiKey,
            "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
            model: MODEL,
            stream: true,
            store: false,
            reasoning: { effort: "low" },
            instructions: SYSTEM,
            input: `Target keyword: ${targetKeyword || "not specified"}\n\nDraft:\n${content.slice(0, 20000)}`,
        }),
    });

    if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        logger.error("[GapAnalysis] gateway error", { status: upstream.status, text });
        const msg =
            upstream.status === 402 ? "AI credits are exhausted — add credits to continue." :
            upstream.status === 429 ? "AI is busy — try again in a moment." :
            "AI analysis failed. Please try again.";
        return NextResponse.json({ error: msg }, { status: upstream.status });
    }

    // Consume the SSE stream server-side and accumulate the output text.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    let refused = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                try {
                    const ev = JSON.parse(data);
                    if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
                    if (ev.type === "response.refusal.delta") refused = true;
                } catch { /* partial / non-JSON frame */ }
            }
        }
    }

    if (refused || !out.trim()) {
        return NextResponse.json({ error: "The AI could not analyze this draft." }, { status: 422 });
    }

    try {
        const json = JSON.parse(out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim());
        const gaps: IdentifiedGap[] = (Array.isArray(json.gaps) ? json.gaps : [])
            .filter((g: IdentifiedGap) => typeof g?.originalSnippet === "string" && g.originalSnippet.trim() && content.includes(g.originalSnippet))
            .map((g: IdentifiedGap, i: number) => ({ ...g, id: `gap-${i + 1}` }));
        const clamp = (n: unknown) => (typeof n === "number" ? Math.round(Math.min(100, Math.max(0, n))) : 0);
        const payload: GapAnalysisResponse = {
            seoScore: clamp(json.seoScore),
            readabilityScore: clamp(json.readabilityScore),
            overallSummary: String(json.overallSummary ?? ""),
            gaps,
        };
        return NextResponse.json(payload);
    } catch (err) {
        logger.error("[GapAnalysis] parse failed", { error: String(err) });
        return NextResponse.json({ error: "AI returned an unreadable result. Please try again." }, { status: 502 });
    }
}
