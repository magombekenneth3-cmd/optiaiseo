import crypto from "crypto";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { fetchGSCKeywords, normaliseSiteUrl } from "@/lib/gsc";
import { getUserGscToken } from "@/lib/gsc/token";
import { callGemini } from "@/lib/gemini/client";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { TTL } from "@/lib/constants/ttl";

export type QuerySource = "gsc" | "competitor" | "ai_inferred" | "manual";

export interface DiscoveredQuery {
  keyword: string;
  source: QuerySource;
  hasAiActivity: boolean;
  alreadyCited: boolean;
  competitorCited?: string;
  snippet?: string;
}

export interface DiscoveryResult {
  siteId: string;
  domain: string;
  discovered: DiscoveredQuery[];
  inserted: string[];
  alreadyTracked: string[];
  skippedNoActivity: number;
  warnings: string[];
}

interface SiteRow {
  id: string;
  domain: string;
  userId: string;
  coreServices: string | null;
  niche: string | null;
  user: { gscConnected: boolean };
}

interface Candidate {
  keyword: string;
  source: QuerySource;
}

const MAX_CANDIDATES = 50;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

// Gap 3: cap spot-checks at 10 hot candidates to keep discovery under 2 min.
// Remaining candidates are inserted as isActive:false and activated by the
// background Inngest weekly cron on subsequent runs.
const SPOT_CHECK_LIMIT = 10;

// Reuse the shared TTL constant — same 6 h value, named for intent clarity.
const SPOT_CHECK_TTL = TTL.PERPLEXITY_S;

export async function discoverQueriesForSite(
  siteId: string,
  options: {
    maxCandidates?: number;
    skipGsc?: boolean;
    skipCompetitors?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<DiscoveryResult> {
  const {
    maxCandidates = MAX_CANDIDATES,
    skipGsc = false,
    skipCompetitors = false,
    dryRun = false,
  } = options;

  const warnings: string[] = [];

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      domain: true,
      userId: true,
      coreServices: true,
      niche: true,
      user: { select: { gscConnected: true } },
    },
  });

  if (!site) throw new Error(`Site ${siteId} not found`);

  const result: DiscoveryResult = {
    siteId,
    domain: site.domain,
    discovered: [],
    inserted: [],
    alreadyTracked: [],
    skippedNoActivity: 0,
    warnings,
  };

  const existing = await prisma.seedKeyword.findMany({
    where: { siteId },
    select: { keyword: true },
  });
  const existingSet = new Set(existing.map((k) => k.keyword.toLowerCase()));

  const candidates = await gatherCandidates(site, {
    skipGsc: skipGsc || !site.user.gscConnected,
    skipCompetitors,
    maxCandidates,
    warnings,
  });

  if (candidates.length === 0) {
    warnings.push("No candidates found from any source.");
    return result;
  }

  logger.info("[QueryDiscovery] Candidates gathered", {
    siteId,
    domain: site.domain,
    count: candidates.length,
  });

  // Gap 3: sort candidates by intent tier so high-citation-likelihood queries
  // are spot-checked first. Informational + commercial queries are far more
  // likely to generate AI citations than navigational ones.
  const INTENT_TIER: Record<string, number> = {
    informational: 0, commercial: 0, problem: 1, comparison: 1, navigational: 2,
  };
  const prioritisedCandidates = [...candidates].sort(
    (a, b) =>
      (INTENT_TIER[inferIntent(a.keyword)] ?? 1) -
      (INTENT_TIER[inferIntent(b.keyword)] ?? 1)
  );
  const hotCandidates  = prioritisedCandidates.slice(0, SPOT_CHECK_LIMIT);
  const coldCandidates = prioritisedCandidates.slice(SPOT_CHECK_LIMIT);

  // Insert cold candidates immediately as isActive:false so they exist in the
  // DB and can be activated by the next weekly Inngest cron without losing them.
  if (!dryRun && coldCandidates.length > 0) {
    for (const cold of coldCandidates) {
      const kwLower = cold.keyword.toLowerCase();
      if (!existingSet.has(kwLower)) {
        try {
          await prisma.seedKeyword.upsert({
            where: { siteId_keyword: { siteId, keyword: cold.keyword } },
            create: {
              siteId,
              keyword: cold.keyword,
              intent: inferIntent(cold.keyword),
              notes: "Deferred — pending spot-check on next run",
              source: cold.source,
              discoveredAt: new Date(),
            },
            update: {},
          });
          existingSet.add(kwLower);
        } catch { /* skip duplicates */ }
      }
    }
    logger.info("[QueryDiscovery] Cold candidates deferred", {
      siteId, count: coldCandidates.length,
    });
  }

  const spotResults = await runSpotChecks(hotCandidates, site.domain);

  for (const spot of spotResults) {

    const kwLower = spot.keyword.toLowerCase();

    if (!spot.hasAiActivity) {
      result.skippedNoActivity++;
      continue;
    }

    result.discovered.push(spot);

    if (existingSet.has(kwLower)) {
      result.alreadyTracked.push(spot.keyword);
      continue;
    }

    if (!dryRun) {
      try {
        await prisma.seedKeyword.upsert({
          where: { siteId_keyword: { siteId, keyword: spot.keyword } },
          create: {
            siteId,
            keyword: spot.keyword,
            intent: inferIntent(spot.keyword),
            notes: buildNote(spot),
            source: spot.source,
            discoveredAt: new Date(),
          },
          update: {
            source: spot.source,
            discoveredAt: new Date(),
          },
        });
        result.inserted.push(spot.keyword);
        existingSet.add(kwLower);
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        if (!msg.includes("Unique constraint")) {
          warnings.push(`Failed to insert "${spot.keyword}": ${msg}`);
          logger.warn("[QueryDiscovery] Upsert failed", { keyword: spot.keyword, error: msg });
        }
      }
    } else {
      result.inserted.push(spot.keyword);
    }
  }

  logger.info("[QueryDiscovery] Run complete", {
    siteId,
    domain: site.domain,
    discovered: result.discovered.length,
    inserted: result.inserted.length,
    alreadyTracked: result.alreadyTracked.length,
    skipped: result.skippedNoActivity,
    warnings: warnings.length,
  });

  return result;
}

async function gatherCandidates(
  site: SiteRow,
  opts: {
    skipGsc: boolean;
    skipCompetitors: boolean;
    maxCandidates: number;
    warnings: string[];
  }
): Promise<Candidate[]> {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  const add = (keyword: string, source: QuerySource) => {
    const key = keyword.toLowerCase().trim();
    if (!key || seen.has(key) || candidates.length >= opts.maxCandidates) return;
    seen.add(key);
    candidates.push({ keyword: keyword.trim(), source });
  };

  if (!opts.skipGsc) {
    try {
      const accessToken = await getUserGscToken(site.userId);
      const siteUrl = normaliseSiteUrl(site.domain);
      const rows = await fetchGSCKeywords(accessToken, siteUrl, 30, 200);
      rows
        .filter((r) => r.impressions >= 20)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 30)
        .forEach((r) => add(r.keyword, "gsc"));
      logger.debug("[QueryDiscovery] GSC candidates", { domain: site.domain, count: candidates.length });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? String(err);
      if (msg === "GSC_NOT_CONNECTED" || msg === "GSC_REFRESH_TOKEN_MISSING") {
        opts.warnings.push("GSC not connected — skipping GSC candidates.");
      } else {
        opts.warnings.push(`GSC pull failed: ${msg}`);
        logger.warn("[QueryDiscovery] GSC pull failed", { domain: site.domain, error: msg });
      }
    }
  }

  if (!opts.skipCompetitors && candidates.length < opts.maxCandidates) {
    try {
      const rows = await prisma.competitorKeyword.findMany({
        where: { competitor: { siteId: site.id }, dataSource: "estimated" },
        orderBy: { searchVolume: "desc" },
        take: 25,
        select: { keyword: true },
      });
      rows.forEach((r) => add(r.keyword, "competitor"));
      logger.debug("[QueryDiscovery] Competitor candidates", { domain: site.domain, count: rows.length });
    } catch (err: unknown) {
      opts.warnings.push(`Competitor pull failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  if (candidates.length < 5) {
    try {
      const inferred = await inferQueriesFromDomain(site.domain, site.coreServices, site.niche);
      inferred.forEach((kw) => add(kw, "ai_inferred"));
      logger.debug("[QueryDiscovery] AI-inferred candidates", { domain: site.domain, count: inferred.length });
    } catch (err: unknown) {
      opts.warnings.push(`AI inference failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  return candidates.slice(0, opts.maxCandidates);
}

async function inferQueriesFromDomain(
  domain: string,
  coreServices: string | null,
  niche: string | null
): Promise<string[]> {
  const prompt = `You are an expert SEO and AEO strategist.

Given this website domain: ${domain}
${coreServices ? `Core services: ${coreServices}.` : ""}
${niche ? `Industry niche: ${niche}.` : ""}

Generate exactly 12 search queries that a potential customer would type into Google or an AI assistant when looking for what this site offers.

Rules:
- Each query should be a realistic, natural-language search phrase (3–8 words)
- Mix informational queries with commercial queries
- Do NOT include the domain name or brand name in any query
- Do NOT include queries that are too generic

Return ONLY a JSON array of strings. No explanation, no markdown, no extra keys.`;

  const raw = await callGemini(prompt, {
    model: AI_MODELS.GEMINI_FLASH,
    maxOutputTokens: 512,
    temperature: 0.4,
    responseFormat: "json",
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
  } catch {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((q): q is string => typeof q === "string" && q.trim().length > 5)
    .map((q) => q.trim())
    .slice(0, 15);
}

async function runSpotChecks(candidates: Candidate[], domain: string): Promise<DiscoveredQuery[]> {
  const results: DiscoveredQuery[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((c) => spotCheck(c.keyword, c.source, domain)));
    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        logger.warn("[QueryDiscovery] Spot-check failed", { error: r.reason?.message ?? String(r.reason) });
      }
    }
    if (i + BATCH_SIZE < candidates.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}

async function spotCheck(keyword: string, source: QuerySource, domain: string): Promise<DiscoveredQuery> {
  const cacheKey = `discovery:spot:${sha256(keyword)}:${domain}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
      logger.debug("[QueryDiscovery] Spot-check cache hit", { keyword });
      return { ...(parsed as DiscoveredQuery), source };
    }
  } catch { /* non-fatal */ }

  const domainBase = domain.replace(/^www\./, "").split(".")[0].toLowerCase();

  const prompt = `You are a helpful AI assistant. A user asked: "${keyword}"

Please answer in 2–3 sentences. Mention any specific tools, platforms, websites, or companies that are well-known for this topic.

Return ONLY this JSON object (no markdown, no extra text):
{
  "answer": "your 2-3 sentence answer here",
  "mentionedDomains": ["any", "domains", "or", "brands", "you", "mentioned"]
}`;

  let answer = "";
  let mentionedDomains: string[] = [];
  let hasAiActivity = false;

  try {
    const raw = await callGemini(prompt, {
      model: AI_MODELS.GEMINI_FLASH,
      maxOutputTokens: 400,
      temperature: 0.2,
      responseFormat: "json",
      timeoutMs: 15000,
      maxRetries: 2,
    });

    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(clean);

    answer = typeof parsed.answer === "string" ? parsed.answer : "";
    mentionedDomains = Array.isArray(parsed.mentionedDomains)
      ? parsed.mentionedDomains.filter((d: unknown): d is string => typeof d === "string")
      : [];

    hasAiActivity = answer.length > 30 && !answer.toLowerCase().includes("i don't know");
  } catch (err: unknown) {
    logger.debug("[QueryDiscovery] Spot-check parse error", {
      keyword,
      error: (err as Error)?.message,
    });
  }

  const answerLower = answer.toLowerCase();
  const alreadyCited =
    answerLower.includes(domainBase) ||
    answerLower.includes(domain.toLowerCase()) ||
    mentionedDomains.some(
      (d) => d.toLowerCase().includes(domainBase) || d.toLowerCase().includes(domain.toLowerCase())
    );

  const competitorCited = mentionedDomains.find(
    (d) => !d.toLowerCase().includes(domainBase) && !d.toLowerCase().includes(domain.toLowerCase())
  );

  const spotResult: DiscoveredQuery = {
    keyword,
    source,
    hasAiActivity,
    alreadyCited,
    competitorCited: competitorCited ?? undefined,
    snippet: answer.slice(0, 200) || undefined,
  };

  try {
    await redis.set(cacheKey, JSON.stringify(spotResult), { ex: SPOT_CHECK_TTL });
  } catch { /* non-fatal */ }

  return spotResult;
}

function inferIntent(keyword: string): "informational" | "commercial" | "transactional" | "navigational" {
  const kw = keyword.toLowerCase();
  if (
    kw.startsWith("how ") || kw.startsWith("what ") || kw.startsWith("why ") ||
    kw.startsWith("when ") || kw.includes(" guide") || kw.includes(" tutorial") || kw.includes(" example")
  ) return "informational";
  if (
    kw.includes("buy ") || kw.includes("price") || kw.includes("pricing") || kw.includes("cost") ||
    kw.includes("free trial") || kw.includes("sign up") || kw.includes("download")
  ) return "transactional";
  if (
    kw.startsWith("best ") || kw.includes(" vs ") || kw.includes(" alternative") ||
    kw.includes(" review") || kw.includes(" tool") || kw.includes(" software") || kw.includes(" platform")
  ) return "commercial";
  return "informational";
}

function buildNote(spot: DiscoveredQuery): string {
  const sourceLabel: Record<QuerySource, string> = {
    gsc: "Found in your Google Search Console impressions",
    competitor: "Your competitor ranks for this — you don't",
    ai_inferred: "Suggested based on your domain and services",
    manual: "Added manually",
  };
  const parts = [sourceLabel[spot.source]];
  if (spot.alreadyCited) {
    parts.push("AI models already mention you for this query");
  } else if (spot.competitorCited) {
    parts.push(`AI models mention ${spot.competitorCited} instead`);
  } else {
    parts.push("AI models discuss this topic — citation opportunity");
  }
  return parts.join(". ") + ".";
}

function sha256(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
