import { callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";

export interface GeoFitnessSignals {
  domain: string;
  hasPricingPage: boolean;
  hasUseCasePage: boolean;
  hasAggregateRating: boolean;
  hasCaseStudies: boolean;
  hasComparisonPages: boolean;
  hasFreeTrial: boolean;
  hasTestimonials: boolean;
  /** Overall GEO fitness score 0-100 */
  geoScore: number;
}

const GEO_SIGNALS: Array<keyof Omit<GeoFitnessSignals, "domain" | "geoScore">> = [
  "hasPricingPage",
  "hasUseCasePage",
  "hasAggregateRating",
  "hasCaseStudies",
  "hasComparisonPages",
  "hasFreeTrial",
  "hasTestimonials",
];

/**
 * Scan a competitor's homepage for GEO fitness signals.
 * Uses Gemini to classify signals from page content — no browser execution.
 */
export async function profileCompetitorGeo(
  domain: string,
): Promise<GeoFitnessSignals | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  let pageText = "";
  let schemaHtml = "";
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OptiAISEO-Bot/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    schemaHtml = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi)?.join(" ") ?? "";
    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch (err) {
    logger.warn("[GeoProfile] Failed to fetch", { domain, error: (err as Error)?.message });
    return null;
  }

  const hasAggregateRating = schemaHtml.includes("AggregateRating");

  const prompt = `You are a GEO (Generative Engine Optimization) analyst. Examine this homepage content.

DOMAIN: ${domain}
PAGE CONTENT:
---
${pageText}
---

Determine whether the following signals are present. Look for links, CTAs, or section headings that indicate these page types exist on the site.

Respond ONLY in this exact JSON format:
{
  "hasPricingPage": <boolean — pricing page link or pricing section exists>,
  "hasUseCasePage": <boolean — "who it's for", use cases, or industries page exists>,
  "hasCaseStudies": <boolean — case studies or success stories with specific numbers exist>,
  "hasComparisonPages": <boolean — "[brand] vs [competitor]" or alternatives pages exist>,
  "hasFreeTrial": <boolean — free trial, free plan, or free tier is offered>,
  "hasTestimonials": <boolean — customer quotes or testimonials are present>
}`;

  try {
    const analysis = await callGeminiJson<Omit<GeoFitnessSignals, "domain" | "geoScore" | "hasAggregateRating">>(
      prompt,
      { model: "gemini-2.0-flash", temperature: 0.1, maxOutputTokens: 300 },
    );

    const signals: GeoFitnessSignals = {
      domain,
      hasPricingPage: analysis.hasPricingPage ?? false,
      hasUseCasePage: analysis.hasUseCasePage ?? false,
      hasAggregateRating,
      hasCaseStudies: analysis.hasCaseStudies ?? false,
      hasComparisonPages: analysis.hasComparisonPages ?? false,
      hasFreeTrial: analysis.hasFreeTrial ?? false,
      hasTestimonials: analysis.hasTestimonials ?? false,
      geoScore: 0,
    };

    // Score: each signal = ~14 points (7 signals, 100 points total)
    const trueCount = GEO_SIGNALS.filter(k => signals[k]).length;
    signals.geoScore = Math.round((trueCount / GEO_SIGNALS.length) * 100);

    return signals;
  } catch (err) {
    logger.warn("[GeoProfile] Gemini analysis failed", { domain, error: (err as Error)?.message });
    return null;
  }
}

const SIGNAL_LABELS: Record<keyof Omit<GeoFitnessSignals, "domain" | "geoScore">, string> = {
  hasPricingPage: "Pricing page",
  hasUseCasePage: "Use-case page",
  hasAggregateRating: "Star rating schema",
  hasCaseStudies: "Case studies",
  hasComparisonPages: "Comparison pages",
  hasFreeTrial: "Free trial",
  hasTestimonials: "Testimonials",
};

/**
 * Compare the client's GEO fitness against all their tracked competitors.
 * Returns a ranked list with gap signals highlighted.
 */
export function buildGeoComparisonReport(
  clientProfile: GeoFitnessSignals,
  competitorProfiles: GeoFitnessSignals[],
): {
  clientScore: number;
  competitors: Array<GeoFitnessSignals & { gaps: string[] }>;
  topGaps: string[];
} {
  const competitors = competitorProfiles
    .sort((a, b) => b.geoScore - a.geoScore)
    .map(comp => {
      const gaps = GEO_SIGNALS
        .filter(k => comp[k] && !clientProfile[k])
        .map(k => SIGNAL_LABELS[k]);
      return { ...comp, gaps };
    });

  const topGaps = [...new Set(competitors.flatMap(c => c.gaps))].slice(0, 5);

  return {
    clientScore: clientProfile.geoScore,
    competitors,
    topGaps,
  };
}
