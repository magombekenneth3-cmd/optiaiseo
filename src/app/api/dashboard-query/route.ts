export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import prisma from "@/lib/prisma";
import { z } from "zod";

// ── Filter schema produced by Gemini ─────────────────────────────────────────
const FilterSchema = z.object({
    entity: z.enum(["audits", "keywords", "aeoReports", "blogs", "competitors", "rankSnapshots"]),
    filters: z.record(z.string(), z.unknown()).optional(),
    orderBy: z.record(z.string(), z.enum(["asc", "desc"])).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    summary: z.string(),
});

type Filter = z.infer<typeof FilterSchema>;

// ── Entity → Prisma query builder ────────────────────────────────────────────
async function runEntityQuery(siteId: string, filter: Filter) {
    const { entity, orderBy, limit } = filter;
    const take = limit ?? 20;
    const order = orderBy && Object.keys(orderBy).length > 0
        ? orderBy as Record<string, "asc" | "desc">
        : undefined;

    switch (entity) {
        case "audits":
            return prisma.audit.findMany({
                where: { siteId },
                orderBy: order ?? { runTimestamp: "desc" },
                take,
                select: {
                    id: true,
                    categoryScores: true,
                    fixStatus: true,
                    lcp: true, cls: true, inp: true,
                    runTimestamp: true,
                },
            });

        case "keywords":
            return prisma.rankSnapshot.findMany({
                where: { siteId },
                orderBy: order ?? { recordedAt: "desc" },
                take,
                select: {
                    id: true, keyword: true, position: true,
                    device: true, recordedAt: true,
                },
            });

        case "aeoReports":
            return prisma.aeoReport.findMany({
                where: { siteId },
                orderBy: order ?? { createdAt: "desc" },
                take,
                select: {
                    id: true, score: true, grade: true,
                    citationScore: true, createdAt: true,
                },
            });

        case "blogs":
            return prisma.blog.findMany({
                where: { siteId },
                orderBy: order ?? { createdAt: "desc" },
                take,
                select: {
                    id: true, title: true, status: true,
                    targetKeywords: true, publishedAt: true, createdAt: true,
                },
            });

        case "competitors":
            return prisma.competitor.findMany({
                where: { siteId },
                orderBy: order ?? { addedAt: "desc" },
                take,
                select: {
                    id: true, domain: true, addedAt: true,
                    keywords: { select: { keyword: true, position: true }, take: 5 },
                },
            });

        case "rankSnapshots":
            return prisma.rankSnapshot.findMany({
                where: { siteId },
                orderBy: order ?? { recordedAt: "desc" },
                take,
                select: {
                    id: true, keyword: true, position: true,
                    device: true, recordedAt: true,
                },
            });

        default:
            return [];
    }
}

// ── Gemini NL→Filter conversion ──────────────────────────────────────────────
async function nlToFilter(query: string): Promise<Filter> {
    const { callGemini } = await import("@/lib/gemini");

    const systemPrompt = `You are a database query interpreter for an SEO dashboard.
Convert the user's natural language question into a structured JSON query object.

Available entities and their key fields:
- audits: categoryScores (JSON), fixStatus, lcp, cls, inp, runTimestamp
- keywords: keyword, position (Int), device ("desktop"|"mobile"|"seed"), recordedAt
- aeoReports: platform ("ChatGPT"|"Perplexity"|"Claude"|"GoogleAIO"), query, appeared (Boolean), position (Int), createdAt
- blogs: title, status ("DRAFT"|"LIVE"|"QUEUED"), targetKeywords, publishedAt, createdAt
- competitors: domain, addedAt
- rankSnapshots: keyword, position, device, recordedAt

Return ONLY a valid JSON object matching this schema (no markdown):
{
  "entity": "<entity name>",
  "filters": {},
  "orderBy": { "<field>": "asc" | "desc" },
  "limit": <1-50>,
  "summary": "<plain English interpretation of what the user asked>"
}

Rules:
- Keywords "dropped" → orderBy position desc (higher number = lower rank)
- "Last week" → filter recordedAt >= 7 days ago (omit from filters, use in summary)
- "Schema markup" → entity=audits, summary mentions schema category
- "No schema" → audits where categoryScores.schema is low
- Always include a clear, user-friendly "summary" field
- Default limit: 20`;

    const text = await callGemini(`${systemPrompt}\n\nUser query: "${query}"`, {
        maxOutputTokens: 512,
        temperature: 0.1,
    });

    const jsonMatch = text?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return FilterSchema.parse(parsed);
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    const user = await getAuthUser(req);
    if (!user)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { query, siteId } = body as { query?: string; siteId?: string };

    if (!query?.trim() || !siteId)
        return NextResponse.json({ error: "Missing query or siteId" }, { status: 400 });

    // Verify site ownership
    const site = await prisma.site.findFirst({
        where: { id: siteId, userId: user.id },
        select: { id: true },
    });
    if (!site)
        return NextResponse.json({ error: "Site not found" }, { status: 404 });

    try {
        const filter = await nlToFilter(query);
        const data = await runEntityQuery(siteId, filter);
        return NextResponse.json({ data, summary: filter.summary, entity: filter.entity });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Query failed: ${msg}` }, { status: 500 });
    }
}
