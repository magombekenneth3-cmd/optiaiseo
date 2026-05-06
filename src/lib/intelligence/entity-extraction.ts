import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

export interface ExtractedEntity {
  name: string;
  confidence: number;
}

export const EntityListSchema = z.object({
  companies: z.array(z.object({
    name: z.string(),
    confidence: z.number().describe("Confidence score from 0.0 to 1.0"),
  }))
});

export async function extractEntitiesFromHtml(
  html: string,
  subcategory: string,
  geo: string
): Promise<ExtractedEntity[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return heuristicFallback(html);

  // Clean HTML to save tokens (remove script, style, nav, footer, etc.)
  let cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Limit to reasonable size for extraction (e.g. first 20k characters)
  cleanText = cleanText.slice(0, 20000);

  try {
    const { object } = await generateObject({
      model: anthropic("claude-3-haiku-20240307"),
      schema: EntityListSchema,
      prompt: `
      Extract company names that offer ${subcategory} in ${geo} from this content.
      Only extract businesses. Exclude generic words, aggregator names, or review sites.
      
      Content:
      ${cleanText}
      `,
    });
    
    return object.companies.map(c => ({
      name: normalizeEntityName(c.name),
      confidence: c.confidence,
    }));
  } catch (error) {
    console.error("AI entity extraction failed, falling back to heuristic", error);
    return heuristicFallback(cleanText);
  }
}

export function heuristicFallback(text: string): ExtractedEntity[] {
  // Very naive fallback: look for Capitalized Words that might be companies
  // In a real system, we'd use compromise.js or similar NLP library.
  const matches = text.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) ?? [];
  const freq: Record<string, number> = {};
  
  for (const m of matches) {
    if (m.length > 3) {
      freq[m] = (freq[m] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .filter(([, count]) => count > 1) // appear more than once
    .map(([name, count]) => ({
      name: normalizeEntityName(name),
      confidence: Math.min(count * 0.1, 0.5), // low confidence for heuristic
    }));
}

export function normalizeEntityName(name: string): string {
  let n = name.trim();
  // Remove legal entities and generic suffixes
  n = n.replace(/\b(Inc|LLC|Ltd|Limited|Corp|Corporation|Co|Company)\.?\b/gi, "");
  n = n.replace(/[^a-zA-Z0-9\s-]/g, ""); // remove weird punctuation
  return n.trim();
}

/**
 * Deduplicates entities using string similarity (Levenshtein distance).
 */
export function deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const merged = new Map<string, ExtractedEntity>();

  for (const entity of entities) {
    const key = entity.name.toLowerCase();
    if (!key) continue;

    // Very naive grouping: if the exact lowercased key exists, or if it's a substring
    // A robust system would use embeddings or proper Levenshtein.
    let foundKey = key;
    for (const [existingKey] of merged) {
      if (existingKey.includes(key) || key.includes(existingKey)) {
        foundKey = existingKey.length < key.length ? existingKey : key; // keep the shorter root name
        break;
      }
    }

    const existing = merged.get(foundKey);
    if (existing) {
      merged.set(foundKey, {
        name: existing.name,
        confidence: Math.max(existing.confidence, entity.confidence),
      });
    } else {
      merged.set(foundKey, entity);
    }
  }

  return Array.from(merged.values());
}
