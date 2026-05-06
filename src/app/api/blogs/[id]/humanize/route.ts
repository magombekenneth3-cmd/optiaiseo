export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: "OPENAI_API_KEY is not configured" },
                { status: 500 }
            );
        }

        const user = await getAuthUser(req);
        if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // SECURITY: rate limit AI humanization — 10 calls/min per IP
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
        const rl = await checkRateLimit(`blog-humanize:${ip}`, 10, 60);
        if (!rl.allowed) {
            return NextResponse.json({ error: "Too many requests — please wait before retrying" }, { status: 429 });
        }

        const { id } = await params;

        const blog = await prisma.blog.findUnique({
            where: { id },
            include: { site: { select: { userId: true } } },
        });

        if (!blog || blog.site.userId !== user.id) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        // Author context passed from the client as a JSON header
        let authorName = "";
        let authorBio = "";
        try {
            const ctx = req.headers.get("x-author-context");
            if (ctx) {
                const parsed = JSON.parse(ctx);
                authorName = parsed.authorName ?? "";
                authorBio = parsed.authorBio ?? "";
            }
        } catch {
            // header absent or malformed — proceed without author context
        }

        const systemPrompt = `You are a professional editor humanizing AI-written SEO content.
Rewrite in the first-person voice of ${authorName || "the author"}.
${authorBio ? `Author bio: ${authorBio}` : ""}

Rules:
- Keep ALL facts, statistics, numbers, and headings identical — do not invent or remove data
- Remove AI-typical phrases: "delve into", "it's worth noting", "in conclusion", "furthermore", "moreover"
- Add conversational transitions and natural paragraph rhythm
- Use contractions naturally (I've, you'll, it's) where they fit
- Maintain the same approximate word count (within ±10%)
- Return only the rewritten content — no preamble, no explanation, no markdown fences`;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: AI_MODELS.OPENAI_PRIMARY, // gpt-4o
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: blog.content },
                ],
                max_tokens: 4096,
                temperature: 0.7,
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!res.ok) {
            const errText = await res.text();
            logger.error("[Humanize] OpenAI error", { status: res.status, body: errText });
            return NextResponse.json(
                { error: "AI rewrite failed — please try again" },
                { status: 502 }
            );
        }

        const data = await res.json();
        const humanized: string = data.choices?.[0]?.message?.content ?? blog.content;

        await prisma.blog.update({
            where: { id },
            data: {
                content: sanitizeHtml(humanized),
                // Append _HUMANIZED so the UI can show "Humanized by GPT-4o"
                // pipelineType is a plain String in schema — safe to mutate
                pipelineType: blog.pipelineType.replace(/_HUMANIZED$/, "") + "_HUMANIZED",
            },
        });

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("[Humanize] Unexpected error", { error: msg });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
