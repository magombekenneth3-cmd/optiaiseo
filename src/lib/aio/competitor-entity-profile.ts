import { callGeminiJson } from "@/lib/gemini/client";
import { extractBrandIdentity } from "@/lib/aeo/brand-utils";
import { logger } from "@/lib/logger";

export interface EntityProfile {
  domain: string;
  /** Whether Gemini knows this brand */
  geminiKnown: boolean;
  geminiConfidence: number;
  /** sameAs URLs found in their Organization JSON-LD */
  sameAsUrls: string[];
  /** Known authority sources present in sameAs */
  authoritySourcesPresent: Array<"wikipedia" | "wikidata" | "linkedin" | "crunchbase" | "twitter" | "facebook">;
  /** Whether they have an llms.txt file */
  hasLlmsTxt: boolean;
  /** Whether they have a /about page link in the nav */
  hasAboutPage: boolean;
  /** 0-100 entity completeness score */
  entityScore: number;
}

const AUTHORITY_SOURCES: Record<EntityProfile["authoritySourcesPresent"][number], string> = {
  wikipedia: "wikipedia.org",
  wikidata: "wikidata.org",
  linkedin: "linkedin.com",
  crunchbase: "crunchbase.com",
  twitter: "twitter.com",
  facebook: "facebook.com",
};

export async function profileCompetitorEntity(domain: string): Promise<EntityProfile | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const identity = extractBrandIdentity(domain);

  // Run checks in parallel: Gemini entity check + homepage scrape
  const [geminiResult, homepageData] = await Promise.allSettled([
    checkEntityWithGemini(identity.displayName, domain),
    scrapeEntitySignals(domain),
  ]);

  const gemini = geminiResult.status === "fulfilled"
    ? geminiResult.value
    : { known: false, confidence: 0 };

  const homepage = homepageData.status === "fulfilled" ? homepageData.value : null;

  const sameAsUrls = homepage?.sameAsUrls ?? [];
  const authoritySourcesPresent = (
    Object.entries(AUTHORITY_SOURCES) as Array<[EntityProfile["authoritySourcesPresent"][number], string]>
  )
    .filter(([, urlFragment]) => sameAsUrls.some(u => u.includes(urlFragment)))
    .map(([key]) => key);

  // Score: Gemini known (30) + each authority source (10 each, max 40) + llmsTxt (15) + aboutPage (15)
  const authorityScore = Math.min(40, authoritySourcesPresent.length * 10);
  const entityScore = Math.round(
    (gemini.known ? 30 : 0) +
    authorityScore +
    (homepage?.hasLlmsTxt ? 15 : 0) +
    (homepage?.hasAboutPage ? 15 : 0),
  );

  return {
    domain,
    geminiKnown: gemini.known,
    geminiConfidence: gemini.confidence,
    sameAsUrls,
    authoritySourcesPresent,
    hasLlmsTxt: homepage?.hasLlmsTxt ?? false,
    hasAboutPage: homepage?.hasAboutPage ?? false,
    entityScore,
  };
}

async function checkEntityWithGemini(
  brandName: string,
  domain: string,
): Promise<{ known: boolean; confidence: number }> {
  const prompt = `Act as an AI knowledge base. Do you have knowledge of this brand?
Brand: ${brandName}
Website: ${domain}

Respond ONLY in JSON:
{ "known": <boolean>, "confidence": <number 0-100> }`;

  try {
    const result = await callGeminiJson<{ known: boolean; confidence: number }>(
      prompt,
      { model: "gemini-2.0-flash", temperature: 0.1, maxOutputTokens: 100 },
    );
    return { known: result.known ?? false, confidence: result.confidence ?? 0 };
  } catch {
    return { known: false, confidence: 0 };
  }
}

async function scrapeEntitySignals(domain: string): Promise<{
  sameAsUrls: string[];
  hasLlmsTxt: boolean;
  hasAboutPage: boolean;
} | null> {
  try {
    const [homepageRes, llmsTxtRes] = await Promise.allSettled([
      fetch(`https://${domain}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://${domain}/llms.txt`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    const hasLlmsTxt =
      llmsTxtRes.status === "fulfilled" &&
      llmsTxtRes.value.ok &&
      (llmsTxtRes.value.headers.get("content-type") ?? "").includes("text");

    if (homepageRes.status !== "fulfilled" || !homepageRes.value.ok) {
      return { sameAsUrls: [], hasLlmsTxt, hasAboutPage: false };
    }

    const html = await homepageRes.value.text();

    // Extract sameAs URLs from all JSON-LD blocks
    const sameAsUrls: string[] = [];
    const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const obj = JSON.parse(m[1].trim()) as Record<string, unknown>;
        const extract = (node: unknown): void => {
          if (!node || typeof node !== "object") return;
          const n = node as Record<string, unknown>;
          if (Array.isArray(n["sameAs"])) {
            n["sameAs"].forEach(u => typeof u === "string" && sameAsUrls.push(u));
          } else if (typeof n["sameAs"] === "string") {
            sameAsUrls.push(n["sameAs"]);
          }
          if (Array.isArray(n["@graph"])) n["@graph"].forEach(extract);
        };
        extract(obj);
      } catch { /* skip malformed */ }
    }

    // Heuristic: /about link in nav
    const hasAboutPage = /<a[^>]+href=["'][^"']*\/about[/"']/i.test(html);

    return { sameAsUrls, hasLlmsTxt, hasAboutPage };
  } catch (err) {
    logger.warn("[EntityProfile] Scrape failed", { domain, error: (err as Error)?.message });
    return null;
  }
}

export function buildEntityGaps(
  client: EntityProfile,
  competitors: EntityProfile[],
): string[] {
  const gaps: string[] = [];
  const compAuthority = new Set(competitors.flatMap(c => c.authoritySourcesPresent));

  if (!client.geminiKnown && competitors.some(c => c.geminiKnown)) {
    gaps.push("Gemini does not know your brand — competitors are recognised");
  }
  if (!client.hasLlmsTxt && competitors.some(c => c.hasLlmsTxt)) {
    gaps.push("No llms.txt — competitors have one");
  }
  if (!client.hasAboutPage && competitors.some(c => c.hasAboutPage)) {
    gaps.push("No /about page detected — competitors have one");
  }
  for (const source of compAuthority) {
    if (!client.authoritySourcesPresent.includes(source)) {
      gaps.push(`Missing ${source} in sameAs schema — competitors are listed there`);
    }
  }
  return gaps;
}
