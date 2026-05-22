import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { extractRoot } from "@/lib/competitors/filters";

const CATEGORY_CACHE_TTL_S = 7 * 24 * 3600;

let _redis: import("ioredis").Redis | null = null;
async function getCategoryRedis(): Promise<import("ioredis").Redis | null> {
    if (_redis) return _redis;
    if (!process.env.REDIS_URL) return null;
    try {
        const { default: Redis } = await import("ioredis");
        _redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
        return _redis;
    } catch {
        return null;
    }
}

export const CategoryProfileSchema = z.object({
  category: z.string().describe("The high-level industry category (e.g., 'Telecommunications', 'SaaS', 'Healthcare')"),
  subcategory: z.string().describe("The specific service or product subcategory (e.g., 'Fiber Internet Providers', 'SEO Software')"),
  geo: z.string().describe("The primary geographic market. Use 'Global' if not location-specific. (e.g., 'Uganda', 'New York', 'Global')"),
  audience: z.array(z.string()).describe("List of target audience segments (e.g., ['Enterprise', 'Small Business'])"),
  features: z.array(z.string()).describe("Key features or services offered (e.g., ['Unlimited Data', 'Free Router'])"),
});

export type CategoryProfile = z.infer<typeof CategoryProfileSchema>;

export async function detectCategory(
  domain: string,
  signals: { title?: string; description?: string; bodyText?: string }
): Promise<CategoryProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing");

  const contentToHash = `${domain}|${signals.title || ""}|${signals.description || ""}|${signals.bodyText?.slice(0, 500) || ""}`;
  const hash = crypto.createHash("sha256").update(contentToHash).digest("hex");
  const cacheKey = `category-ai:${hash}`;

  const r = await getCategoryRedis();
  if (r) {
      try {
          const cached = await r.get(cacheKey);
          if (cached) return JSON.parse(cached) as CategoryProfile;
      } catch { /* non-fatal */ }
  }

  const textChunk = signals.bodyText?.slice(0, 3000) || "";

  const { object } = await generateObject({
    model: anthropic("claude-3-haiku-20240307"),
    schema: CategoryProfileSchema,
    prompt: `
    Analyze this business website and classify it into a market category.

    Domain: ${domain}
    Title: ${signals.title || "N/A"}
    Description: ${signals.description || "N/A"}
    Content Snippet:
    ${textChunk}
    `,
  });

  if (r) {
      try { await r.setex(cacheKey, CATEGORY_CACHE_TTL_S, JSON.stringify(object)); } catch { /* non-fatal */ }
  }

  return object;
}

export async function upsertMarketCategory(profile: CategoryProfile) {
  // Try to find an existing category that matches the subcategory and geo perfectly
  const existing = await prisma.marketCategory.findFirst({
    where: {
      subcategory: profile.subcategory,
      geo: profile.geo,
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.marketCategory.create({
    data: {
      category: profile.category,
      subcategory: profile.subcategory,
      geo: profile.geo,
      audience: profile.audience,
      features: profile.features,
    }
  });
}
