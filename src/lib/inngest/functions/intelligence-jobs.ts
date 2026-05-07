import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { detectCategory, upsertMarketCategory } from "@/lib/intelligence/category-ai";
import { fetchSiteText } from "@/lib/competitors/scraper";
import { generateMarketQueries, fetchMarketSources, isListArticleOrDirectory } from "@/lib/intelligence/discovery-engine";
import { extractEntitiesFromHtml, deduplicateEntities } from "@/lib/intelligence/entity-extraction";
import { scoreCompetitors, CandidateCompetitor } from "@/lib/intelligence/scoring-model";

/**
 * 1. Category Detection Job
 * Triggers when a new site is added or needs a refresh.
 */
export const detectCategoryJob = inngest.createFunction(
  { 
    id: "intelligence-detect-category", 
    name: "Detect Market Category",
    triggers: [{ event: "intelligence/detect.category" }],
  },
  async ({ event, step }) => {
    const { siteId } = event.data;

    const site = await step.run("fetch-site", async () => {
      return prisma.site.findUnique({ where: { id: siteId } });
    });

    if (!site) throw new Error("Site not found");

    const html = await step.run("fetch-homepage", async () => {
      return fetchSiteText(site.domain, 10000);
    });

    const profile = await step.run("run-category-ai", async () => {
      return detectCategory(site.domain, { bodyText: html || "" });
    });

    const category = await step.run("upsert-category", async () => {
      return upsertMarketCategory(profile);
    });

    await step.run("link-site-to-category", async () => {
      await prisma.site.update({
        where: { id: site.id },
        data: { marketCategoryId: category.id },
      });
    });

    // Cascade trigger: Discover market for this category
    await step.sendEvent("trigger-discovery", {
      name: "intelligence/discover.market",
      data: { marketCategoryId: category.id },
    });

    return { success: true, categoryId: category.id, profile };
  }
);

/**
 * 2. Market Discovery Job
 * Triggers after category detection to build the competitor graph.
 */
export const discoverMarketJob = inngest.createFunction(
  { 
    id: "intelligence-discover-market", 
    name: "Discover Market Competitors",
    triggers: [{ event: "intelligence/discover.market" }],
  },
  async ({ event, step }) => {
    const { marketCategoryId } = event.data;

    const category = await step.run("fetch-category", async () => {
      return prisma.marketCategory.findUnique({ where: { id: marketCategoryId } });
    });

    if (!category) throw new Error("Category not found");

    const profile = {
      category: category.category,
      subcategory: category.subcategory,
      geo: category.geo,
      audience: category.audience,
      features: category.features,
    };

    const queries = await step.run("generate-queries", async () => {
      return generateMarketQueries(profile);
    });

    const serpResults = await step.run("fetch-serp", async () => {
      return fetchMarketSources(queries);
    });

    const sources = serpResults.filter(isListArticleOrDirectory);

    // Naive parallel fetch of top sources to extract entities
    const rawEntities = await step.run("extract-entities", async () => {
      const allEntities: CandidateCompetitor[] = [];
      for (const source of sources.slice(0, 5)) { // limit to top 5 listicles to save costs
        try {
          const res = await fetch(source.link, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) continue;
          const html = await res.text();
          const extracted = await extractEntitiesFromHtml(html, category.subcategory, category.geo);
          
          for (const e of extracted) {
            allEntities.push({
              ...e,
              domain: source.link, // naive tracking
              sourceUrls: [source.link],
              geoMatch: false,
              serviceMatch: true, // assume true if in listicle
              isListArticleOrAggregator: false,
            });
          }
        } catch (e) {
          console.warn(`Failed to extract from ${source.link}`);
        }
      }
      return allEntities;
    });

    // Deduplicate and Score
    const scored = await step.run("score-competitors", async () => {
      // deduplicate entities
      const mergedMap = new Map<string, CandidateCompetitor>();
      for (const e of rawEntities) {
        const key = e.name.toLowerCase();
        if (mergedMap.has(key)) {
          const existing = mergedMap.get(key)!;
          if (!existing.sourceUrls.includes(e.sourceUrls[0])) {
            existing.sourceUrls.push(e.sourceUrls[0]);
          }
        } else {
          mergedMap.set(key, { ...e, sourceUrls: [...e.sourceUrls] });
        }
      }

      const deduplicated = Array.from(mergedMap.values());
      const ranked = scoreCompetitors(deduplicated, category.geo);
      return ranked.filter(r => r.score >= 3.0).slice(0, 10); // Keep top 10 real competitors
    });

    // Persist to Graph
    await step.run("save-graph", async () => {
      for (const comp of scored) {
        await prisma.competitor.upsert({
          where: {
             // Fake composite key for upserting global competitors
             // Note: Currently unique constraint is [siteId, domain]. We need to handle this carefully.
             id: "dummy-bypass"
          },
          create: {
            marketCategoryId: category.id,
            domain: new URL(comp.sourceUrls[0] || "https://unknown.com").hostname,
            name: comp.name,
            score: comp.score,
          },
          update: {
            score: comp.score,
          }
        }).catch(async () => {
          // Fallback if unique constraint fails: just create it without siteId checking
          // This happens because prisma expects siteId to be part of the unique key
          await prisma.competitor.create({
            data: {
              marketCategoryId: category.id,
              domain: new URL(comp.sourceUrls[0] || "https://unknown.com").hostname,
              name: comp.name,
              score: comp.score,
            }
          });
        });
      }
    });

    return { success: true, competitors: scored };
  }
);
