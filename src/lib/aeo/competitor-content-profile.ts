import { callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";

export interface CompetitorContentProfile {
  domain: string;
  url: string;
  keyword: string;
  /** Approximate word count of the page */
  wordCount: number;
  /** Schema types found in JSON-LD */
  schemaTypes: string[];
  /** True if page has a dedicated FAQ section */
  hasFaqSection: boolean;
  /** True if page has a clear definition paragraph in first 200 words */
  hasDefinitionParagraph: boolean;
  /** True if page includes original statistics or data with citations */
  hasOriginalStats: boolean;
  /** True if page has a comparison section (vs table, side-by-side) */
  hasComparisonContent: boolean;
  /** Estimated reading level */
  readingLevel: "basic" | "intermediate" | "expert";
  /** Top 3 content strengths — why AI engines prefer this page */
  strengths: string[];
  profiledAt: string;
}

/**
 * Fetches a competitor's cited page and uses Gemini to profile its content
 * structure. Returns null if the page cannot be fetched or analysed.
 *
 * Deliberately lightweight — no embeddings, no vector DB.
 * Designed to run inside the existing citation gap analysis batch.
 */
export async function profileCompetitorPage(
  domain: string,
  url: string,
  keyword: string,
): Promise<CompetitorContentProfile | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract schema types from JSON-LD before stripping tags
    const schemaTypes = extractSchemaTypes(html);

    const pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);

    const wordCount = pageText.split(/\s+/).length;

    const prompt = `You are an AEO content analyst. Analyse this webpage content for the keyword "${keyword}".

PAGE CONTENT (first 5000 chars):
---
${pageText}
---

SCHEMA TYPES FOUND: ${schemaTypes.join(", ") || "none"}

Respond ONLY in this exact JSON format:
{
  "hasFaqSection": <boolean — true if there is a Q&A or FAQ section>,
  "hasDefinitionParagraph": <boolean — true if first 200 words define the core topic>,
  "hasOriginalStats": <boolean — true if page cites specific numbers, studies, or data>,
  "hasComparisonContent": <boolean — true if there is a comparison table or vs section>,
  "readingLevel": "<basic|intermediate|expert>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"]
}`;

    const analysis = await callGeminiJson<{
      hasFaqSection: boolean;
      hasDefinitionParagraph: boolean;
      hasOriginalStats: boolean;
      hasComparisonContent: boolean;
      readingLevel: "basic" | "intermediate" | "expert";
      strengths: string[];
    }>(prompt, { model: "gemini-2.0-flash", temperature: 0.1, maxOutputTokens: 400 });

    return {
      domain,
      url,
      keyword,
      wordCount,
      schemaTypes,
      hasFaqSection: analysis.hasFaqSection ?? false,
      hasDefinitionParagraph: analysis.hasDefinitionParagraph ?? false,
      hasOriginalStats: analysis.hasOriginalStats ?? false,
      hasComparisonContent: analysis.hasComparisonContent ?? false,
      readingLevel: analysis.readingLevel ?? "basic",
      strengths: (analysis.strengths ?? []).slice(0, 3),
      profiledAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn("[CompetitorProfile] Failed to profile page", {
      url,
      error: (err as Error)?.message,
    });
    return null;
  }
}

function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1].trim());
      const collect = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        const t = n["@type"];
        if (typeof t === "string") types.add(t);
        if (Array.isArray(t)) t.forEach(s => typeof s === "string" && types.add(s));
        if (Array.isArray(n["@graph"])) n["@graph"].forEach(collect);
      };
      collect(obj);
    } catch { /* skip malformed */ }
  }
  return [...types];
}
