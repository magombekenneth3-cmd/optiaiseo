import { callGeminiJson } from "@/lib/gemini/client";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import type { CompetitorContentProfile } from "@/lib/aeo/competitor-content-profile";
import type { GeoFitnessSignals } from "@/lib/geo/competitor-geo-profile";
import type { EntityProfile } from "@/lib/aio/competitor-entity-profile";

const CACHE_TTL_S = 60 * 60 * 24 * 3; // 3 days

export interface BeatCompetitorPlan {
  competitorDomain: string;
  clientDomain: string;
  /**
   * Ordered list of actions — most impactful first.
   * Max 7 items — enough to fill a weekly sprint.
   */
  actions: Array<{
    priority: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    layer: "AEO" | "SEO" | "GEO" | "AIO" | "Content";
    title: string;
    /** Why this specific action will close the gap against this competitor */
    rationale: string;
    /** Single concrete step to start today */
    firstStep: string;
    /** Estimated time to see AI citation impact */
    timeToImpact: "days" | "weeks" | "months";
    effort: "30 min" | "2 hours" | "1 day" | "1 week";
  }>;
  /** 2-sentence executive summary */
  summary: string;
  /** Estimated weeks to close the citation gap if all actions are followed */
  estimatedWeeksToClose: number;
  generatedAt: string;
}

function cacheKey(siteId: string, competitorDomain: string): string {
  return `beat-plan:${siteId}:${competitorDomain}`;
}

interface BeatPlanContext {
  siteId: string;
  clientDomain: string;
  competitorDomain: string;
  /** Gap keywords where competitor wins */
  gapKeywords: string[];
  /** From comp-profile Redis keys */
  contentProfile: CompetitorContentProfile | null;
  /** From geo-comp Redis key */
  geoProfile: GeoFitnessSignals | null;
  /** From entity-comp Redis key */
  entityProfile: EntityProfile | null;
  /** Client's own GEO profile for gap comparison */
  clientGeoProfile: GeoFitnessSignals | null;
  /** Client's own entity profile */
  clientEntityProfile: EntityProfile | null;
  /** Competitor DR gap (positive = competitor leads) */
  drGap: number | null;
}

/**
 * Generates a prioritised "Beat This Competitor" action plan using all
 * available intelligence: content profile, GEO signals, entity signals,
 * authority gap, and citation gap keywords.
 *
 * All input data comes from Redis — no live API calls for context gathering.
 * One Gemini call synthesises everything into a concrete sprint plan.
 */
export async function generateBeatCompetitorPlan(
  ctx: BeatPlanContext,
): Promise<BeatCompetitorPlan | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const key = cacheKey(ctx.siteId, ctx.competitorDomain);

  // ── Redis read ──────────────────────────────────────────────────────────────
  try {
    const cached = await redis.get<BeatCompetitorPlan>(key);
    if (cached) return cached;
  } catch {
    // Proceed
  }

  // ── Build rich context for the prompt ─────────────────────────────────────
  const gapKeywordsSample = ctx.gapKeywords.slice(0, 8).join('", "');

  const contentCtx = ctx.contentProfile
    ? `
Content profile (competitor's winning page):
- Word count: ~${ctx.contentProfile.wordCount}
- Has FAQ section: ${ctx.contentProfile.hasFaqSection}
- Has definition paragraph: ${ctx.contentProfile.hasDefinitionParagraph}
- Has original statistics: ${ctx.contentProfile.hasOriginalStats}
- Has comparison content: ${ctx.contentProfile.hasComparisonContent}
- Reading level: ${ctx.contentProfile.readingLevel}
- Schema types: ${ctx.contentProfile.schemaTypes.join(", ") || "none"}
- Content strengths: ${ctx.contentProfile.strengths.join("; ")}`
    : "";

  const geoGaps = ctx.geoProfile && ctx.clientGeoProfile
    ? (() => {
        const keys: Array<keyof Omit<GeoFitnessSignals, "domain" | "geoScore">> = [
          "hasPricingPage", "hasUseCasePage", "hasAggregateRating",
          "hasCaseStudies", "hasComparisonPages", "hasFreeTrial", "hasTestimonials",
        ];
        const labels: Record<string, string> = {
          hasPricingPage: "pricing page", hasUseCasePage: "use-case page",
          hasAggregateRating: "AggregateRating schema", hasCaseStudies: "case studies",
          hasComparisonPages: "comparison pages", hasFreeTrial: "free trial",
          hasTestimonials: "testimonials",
        };
        const gaps = keys
          .filter(k => ctx.geoProfile![k] && !ctx.clientGeoProfile![k])
          .map(k => labels[k]);
        return gaps.length > 0
          ? `\nGEO gaps (competitor has, client doesn't): ${gaps.join(", ")}`
          : "";
      })()
    : "";

  const entityGaps = ctx.entityProfile && ctx.clientEntityProfile
    ? (() => {
        const gaps: string[] = [];
        if (ctx.entityProfile.geminiKnown && !ctx.clientEntityProfile.geminiKnown)
          gaps.push("competitor is Gemini-known, client is not");
        if (ctx.entityProfile.hasLlmsTxt && !ctx.clientEntityProfile.hasLlmsTxt)
          gaps.push("competitor has llms.txt, client does not");
        const missingSameAs = ctx.entityProfile.authoritySourcesPresent
          .filter(s => !ctx.clientEntityProfile!.authoritySourcesPresent.includes(s));
        if (missingSameAs.length > 0)
          gaps.push(`missing sameAs: ${missingSameAs.join(", ")}`);
        return gaps.length > 0
          ? `\nAIO entity gaps: ${gaps.join("; ")}`
          : "";
      })()
    : "";

  const authorityCtx = ctx.drGap !== null
    ? `\nAuthority gap: competitor DR is ${ctx.drGap > 0 ? `${ctx.drGap} points higher` : `${Math.abs(ctx.drGap)} points lower — client has DR advantage`}`
    : "";

  const prompt = `You are a senior AEO/SEO strategist. Generate a prioritised action plan for a client to beat a specific competitor in AI engine citations (Perplexity, ChatGPT, Gemini, Google AI Overviews).

CLIENT DOMAIN: ${ctx.clientDomain}
COMPETITOR DOMAIN: ${ctx.competitorDomain}

INTELLIGENCE AVAILABLE:
- Keywords where competitor wins: "${gapKeywordsSample}"${contentCtx}${geoGaps}${entityGaps}${authorityCtx}

Generate a prioritised 5-7 step sprint plan. Each action must directly close a specific, identified gap. Do NOT include generic advice that applies to all sites — every action must be specific to beating THIS competitor based on the gaps above.

Respond ONLY in this exact JSON format:
{
  "summary": "<2 sentences: current state and what the client must focus on>",
  "estimatedWeeksToClose": <integer 4-26>,
  "actions": [
    {
      "priority": <1-7, 1 = highest>,
      "layer": "<AEO|SEO|GEO|AIO|Content>",
      "title": "<action title, max 10 words>",
      "rationale": "<1-2 sentences: why this closes the gap against this specific competitor>",
      "firstStep": "<single concrete thing to do today or tomorrow>",
      "timeToImpact": "<days|weeks|months>",
      "effort": "<30 min|2 hours|1 day|1 week>"
    }
  ]
}`;

  try {
    const parsed = await callGeminiJson<Omit<BeatCompetitorPlan, "competitorDomain" | "clientDomain" | "generatedAt">>(
      prompt,
      {
        model: "gemini-2.0-flash",
        temperature: 0.3,
        maxOutputTokens: 1000,
      },
    );

    const plan: BeatCompetitorPlan = {
      competitorDomain: ctx.competitorDomain,
      clientDomain: ctx.clientDomain,
      summary: parsed.summary ?? "No summary generated.",
      estimatedWeeksToClose: Math.max(4, Math.min(26, parsed.estimatedWeeksToClose ?? 12)),
      actions: (parsed.actions ?? [])
        .slice(0, 7)
        .map((a, i) => ({
          ...a,
          priority: (i + 1) as BeatCompetitorPlan["actions"][number]["priority"],
        })),
      generatedAt: new Date().toISOString(),
    };

    // ── Redis write ───────────────────────────────────────────────────────────
    try {
      await redis.set(key, plan, { ex: CACHE_TTL_S });
    } catch {
      // Non-fatal
    }

    return plan;
  } catch (err) {
    logger.warn("[BeatPlan] Gemini call failed", {
      clientDomain: ctx.clientDomain,
      competitorDomain: ctx.competitorDomain,
      error: (err as Error)?.message,
    });
    return null;
  }
}
