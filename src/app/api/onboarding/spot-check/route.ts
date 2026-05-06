import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { isSafeUrl } from "@/lib/security/safe-url";
import { callGemini } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { redis } from "@/lib/redis";
import crypto from "crypto";

export const maxDuration = 30;

interface SpotFinding {
  keyword: string;
  competitorCited?: string;
  snippet: string;
  alreadyCited: boolean;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawUrl = (body.url ?? "").trim();
  if (!rawUrl) {
    return NextResponse.json({ finding: null }, { status: 200 });
  }

  const normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const check = isSafeUrl(normalized);
  if (!check.ok || !check.url) {
    return NextResponse.json({ finding: null }, { status: 200 });
  }

  const domain = check.url.hostname.replace(/^www\./, "");
  const domainBase = domain.split(".")[0].toLowerCase();
  const cacheKey = `onboarding:spot:${sha256(domain)}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
      return NextResponse.json({ finding: parsed });
    }
  } catch { /* non-fatal */ }

  const prompt = `A potential customer is evaluating a website at ${domain}. They searched for a question that this domain likely wants to rank for.

Your task:
1. Pick ONE realistic search query (4–8 words) that a potential customer of ${domain} would type into an AI assistant.
2. Answer that query in 2–3 sentences, as if you were an AI assistant. Mention specific tools, websites, or companies that are well-known for this topic.

Return ONLY this JSON (no markdown):
{
  "keyword": "the search query you picked",
  "answer": "your 2-3 sentence answer",
  "mentionedDomains": ["brands", "or", "domains", "you", "mentioned"]
}`;

  let finding: SpotFinding | null = null;

  try {
    const raw = await callGemini(prompt, {
      model: AI_MODELS.GEMINI_FLASH,
      maxOutputTokens: 400,
      temperature: 0.3,
      responseFormat: "json",
      timeoutMs: 20000,
      maxRetries: 2,
    });

    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(clean);

    const answer: string = typeof parsed.answer === "string" ? parsed.answer : "";
    const mentionedDomains: string[] = Array.isArray(parsed.mentionedDomains)
      ? parsed.mentionedDomains.filter((d: unknown): d is string => typeof d === "string")
      : [];
    const keyword: string = typeof parsed.keyword === "string" ? parsed.keyword : "";

    if (!keyword || answer.length < 30) {
      return NextResponse.json({ finding: null });
    }

    const answerLower = answer.toLowerCase();
    const alreadyCited =
      answerLower.includes(domainBase) ||
      answerLower.includes(domain.toLowerCase()) ||
      mentionedDomains.some(
        (d) =>
          d.toLowerCase().includes(domainBase) ||
          d.toLowerCase().includes(domain.toLowerCase())
      );

    const competitorCited = mentionedDomains.find(
      (d) =>
        !d.toLowerCase().includes(domainBase) &&
        !d.toLowerCase().includes(domain.toLowerCase())
    );

    finding = {
      keyword,
      snippet: answer.slice(0, 220),
      alreadyCited,
      competitorCited: competitorCited ?? undefined,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(finding), { ex: 60 * 60 * 12 });
    } catch { /* non-fatal */ }
  } catch { /* Gemini unavailable — degrade gracefully, onboarding still proceeds */ }

  return NextResponse.json({ finding });
}

function sha256(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}
