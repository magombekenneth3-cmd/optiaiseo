export const dynamic = "force-dynamic";
export const config = { api: { bodyParser: { sizeLimit: "512kb" } } };

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildGroundedContext } from "@/lib/prompt-context/build-site-context";

const ImproveSchema = z.object({
    issues: z
        .array(z.string().max(500))
        .max(20)
        .optional()
        .default([]),
    scoreData: z
        .object({
            wordCount:       z.object({ current: z.number(), targetMin: z.number(), targetMax: z.number() }).optional(),
            keywords:        z.object({ current: z.number(), targetMin: z.number() }).optional(),
            readabilityGrade: z.number().optional(),
            missingTerms:    z.array(z.string().max(100)).max(30).optional(),
            missingHeadings: z.array(z.string().max(200)).max(20).optional(),
        })
        .optional(),
});

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey });
        const user = await getAuthUser(req);
        if (!user?.email) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // SECURITY: rate limit AI generation — 10 calls/min per authenticated user IP
        const rl = await checkRateLimit(`blog-improve:${user.id}`, 10, 60);
        if (!rl.allowed) {
            return NextResponse.json({ error: "Too many requests — please wait before retrying" }, { status: 429 });
        }

        const { id } = await params;

        let rawBody: unknown;
        try {
            rawBody = await req.json();
        } catch {
            return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const parsed = ImproveSchema.safeParse(rawBody);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request body", details: parsed.error.flatten() },
                { status: 422 }
            );
        }

        const { issues, scoreData } = parsed.data;

        if (issues.length === 0 && !scoreData) {
            return NextResponse.json({ error: "No issues to fix — content looks good" }, { status: 400 });
        }

        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

        const blog = await prisma.blog.findFirst({
            where: { id, site: { userId: user!.id } },
            include: { site: true },
        });
        if (!blog) return NextResponse.json({ error: "Blog not found" }, { status: 404 });

        const groundedCtx = await buildGroundedContext(blog.siteId);

        const issueList = issues.length > 0
            ? issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")
            : "No specific issues provided — generally improve quality, readability, and SEO.";

        const scoreContext = scoreData ? `
Current content score context:
- Word Count: current=${scoreData.wordCount?.current ?? "?"}, target ${scoreData.wordCount?.targetMin ?? "?"}–${scoreData.wordCount?.targetMax ?? "?"}
- Keyword Usage: current=${scoreData.keywords?.current ?? "?"}, target ~${scoreData.keywords?.targetMin ?? "?"}
- Readability grade level: ${scoreData.readabilityGrade ?? "unknown"} (target 8–10)
- Missing semantic terms: ${scoreData.missingTerms?.join(", ") || "none"}
- Missing headings: ${scoreData.missingHeadings?.join(", ") || "none"}
` : "";

        const contentIsTruncated = blog.content.length > 28000;
        const contentForPrompt = blog.content.substring(0, 28000);

        const prompt = `You are an expert SEO content editor${groundedCtx ? ` working for ${groundedCtx.data.domain}` : ""}.
${groundedCtx?.contextBlock ?? ""}

Your task is to improve the following HTML blog post to better meet SEO content scoring requirements.
${contentIsTruncated ? `\nWARNING: The content was truncated from ${blog.content.length} characters to 28000 for processing. Preserve ALL content you receive and do not add a premature ending.\n` : ""}
TARGET KEYWORD: ${blog.targetKeywords?.[0] || "not specified"}

ISSUES TO FIX:
${issueList}
${scoreContext}
IMPORTANT RULES:
1. Keep ALL existing HTML structure, tags, classes, figure tags, images, schema scripts, and CTAs intact
2. Do NOT remove or change <script> tags, <figure> tags, image attributes, or CTA sections
3. Improve readability: target grade level 8–10, use shorter sentences and simpler words where possible
4. Naturally work in the target keyword and any missing semantic terms mentioned in the issues
5. Fix heading structure as described in the issues (add missing headings, not remove existing ones)
6. Do NOT change the fundamental meaning or claims of the article
7. Return ONLY the improved HTML content — no explanations, no markdown code fences, just the raw HTML

CURRENT CONTENT:
${contentForPrompt}`;

        const response = await ai.models.generateContent({
            model: AI_MODELS.GEMINI_PRO,
            contents: prompt,
            config: { temperature: 0.2, maxOutputTokens: 16384 },
        });

        const improvedContent = response.text?.trim();
        if (!improvedContent) {
            return NextResponse.json({ error: "AI returned empty response" }, { status: 500 });
        }

        const cleaned = improvedContent
            .replace(/^```html\n?/i, "")
            .replace(/^```\n?/i, "")
            .replace(/\n?```$/i, "")
            .trim();

        if (cleaned.length < contentForPrompt.length * 0.5) {
            return NextResponse.json(
                { error: "AI output was too short — content may have been lost. Please try again." },
                { status: 500 }
            );
        }

        const countTags = (html: string, tag: string) =>
            (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
        const origScripts = countTags(contentForPrompt, "script");
        const origFigures = countTags(contentForPrompt, "figure");
        const newScripts = countTags(cleaned, "script");
        const newFigures = countTags(cleaned, "figure");

        const warnings: string[] = [];
        if (origScripts > 0 && newScripts < origScripts) warnings.push(`${origScripts - newScripts} <script> tag(s) were dropped`);
        if (origFigures > 0 && newFigures < origFigures) warnings.push(`${origFigures - newFigures} <figure> tag(s) were dropped`);

        return NextResponse.json({
            content: cleaned,
            ...(contentIsTruncated && { truncated: true, originalLength: blog.content.length }),
            ...(warnings.length > 0 && { warnings }),
        });

    } catch (err: unknown) {
        logger.error("[Blog AI Improve] Error:", { error: (err as Error)?.message || String(err) });
        return NextResponse.json(
            { error: "Failed to improve content" },
            { status: 500 }
        );
    }
}
