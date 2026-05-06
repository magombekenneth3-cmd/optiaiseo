import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { fetchSerp } from "@/lib/serp/serp-features";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_3_FLASH } from "@/lib/constants/ai-models";

type SnippetFormat = "paragraph" | "list" | "table" | "none";

function classifySnippet(text: string): SnippetFormat {
    if (!text) return "none";
    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length >= 3) return "list";
    if (text.includes("|") || text.includes("\t")) return "table";
    return "paragraph";
}

const PROMPTS: Record<SnippetFormat, (kw: string, current: string) => string> = {
    paragraph: (kw, current) =>
        `Write a featured snippet paragraph for the keyword "${kw}".
Rules: exactly 40–55 words. Start the first sentence with "${kw}". No fluff. No "in this article". Be direct and authoritative.
Current Google snippet to beat: "${current}"
Return ONLY the paragraph text, no HTML, no quotes.`,

    list: (kw, current) =>
        `Write a featured snippet list for "${kw}".
Rules: one intro sentence (max 12 words), then 6–8 list items, each under 8 words.
Current Google snippet to beat: "${current}"
Return ONLY plain text — intro sentence, then each item on its own line starting with "- ".`,

    table: (kw, current) =>
        `Write a featured snippet comparison table for "${kw}".
Rules: 3 columns, 5–7 rows, simple plain-text headers. Use | to separate columns.
Current Google snippet to beat: "${current}"
Return ONLY the pipe-delimited table.`,

    none: (kw) =>
        `Write a featured snippet paragraph for "${kw}" — there is currently no featured snippet, so you're creating one from scratch.
Rules: exactly 40–55 words. Start with "${kw}". Direct and authoritative. No fluff.
Return ONLY the paragraph text.`,
};

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getAuthUser(req);
    if (!user?.email)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const blog = await prisma.blog.findFirst({
        where: { id, site: { user: { email: user!.email } } },
        select: { targetKeywords: true },
    });
    if (!blog)
        return NextResponse.json({ error: "Not found" }, { status: 404 });

    const keyword = blog.targetKeywords?.[0];
    if (!keyword)
        return NextResponse.json({ error: "No target keyword" }, { status: 400 });

    const serp = await fetchSerp(keyword);
    const answerBox = serp?.answerBox as Record<string, string> | undefined;
    const currentSnippet = answerBox?.answer ?? answerBox?.snippet ?? "";
    const format = classifySnippet(currentSnippet);

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const prompt = PROMPTS[format](keyword, currentSnippet);

    const response = await ai.models.generateContent({
        model: GEMINI_3_FLASH,
        contents: prompt,
        config: { temperature: 0.3, maxOutputTokens: 500 },
    });

    const optimizedBlock = response.text?.trim() ?? "";

    const insertionGuidance =
        format === "list"
            ? `Place this block as an HTML <ul> immediately after your first H2 that mentions "${keyword}".`
            : format === "table"
            ? `Convert this to an HTML <table> and place it after your intro paragraph.`
            : `Place this paragraph as the very first paragraph under your H1, before any other content.`;

    return NextResponse.json({
        keyword,
        format,
        currentSnippet: currentSnippet || null,
        optimizedBlock,
        insertionGuidance,
    });
}
