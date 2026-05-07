import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { extractRoot } from "@/lib/competitors/filters";

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

  // Create a hash to check if we've analyzed exactly this content before
  const contentToHash = `${domain}|${signals.title || ""}|${signals.description || ""}|${signals.bodyText?.slice(0, 500) || ""}`;
  const hash = crypto.createHash("sha256").update(contentToHash).digest("hex");

  // Optional: We could cache this hash in Redis or a DB table to prevent re-running AI on identical inputs.
  // For now, we always run it to ensure the Engine gets fresh data.

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
