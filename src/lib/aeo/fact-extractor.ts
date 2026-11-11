import { logger } from "@/lib/logger";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { submitUrlForIndexing } from "@/lib/indexer";
import { AI_MODELS } from "@/lib/constants/ai-models";
import { callGemini } from "@/lib/gemini/client";


const factSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        facts: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    factType: {
                        type: Type.STRING,
                        enum: ["PRICING", "LOCATION", "FOUNDER", "SERVICE_OFFERING", "BRAND_CLAIM"]
                    },
                    value: { type: Type.STRING },
                    verified: { type: Type.BOOLEAN }
                },
                required: ["factType", "value", "verified"]
            }
        }
    },
    required: ["facts"]
};

/**
 * Extracts high-value brand facts from blog content using Gemini.
 * These facts feed the Knowledge Graph to ensure LLMs have accurate data.
 */
export async function extractFactsFromContent(siteId: string, content: string, sourceUrl?: string) {
    if (!process.env.GEMINI_API_KEY && !process.env.DEEPSEEK_API_KEY) return [];

    try {
        const prompt = `
            Analyze this 2026-standard blog content and extract definitive brand facts.
            Only extract facts that are stated clearly. Do not hallucinate.
            
            Focus Areas:
            - PRICING: Specific prices, tiers, or cost structures.
            - LOCATION: Physical addresses, cities, or regions served.
            - FOUNDER: Names of people who started or lead the brand.
            - SERVICE_OFFERING: Core products or digital services mentioned.
            - BRAND_CLAIM: Specific unique value propositions or statistics (e.g., "500% ROI").

            Respond in JSON format: { "facts": [{ "factType": "PRICING"|"LOCATION"|"FOUNDER"|"SERVICE_OFFERING"|"BRAND_CLAIM", "value": string, "verified": boolean }] }

            Content to Analyze:
            ${content.substring(0, 10000)}
        `;

        let rawText = "";
        if (process.env.GEMINI_API_KEY) {
            try {
                const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                const response = await ai.models.generateContent({
                    model: AI_MODELS.GEMINI_PRO,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: factSchema
                    }
                });
                rawText = response.text ?? "";
            } catch {
                rawText = await callGemini(prompt, {
                    model: AI_MODELS.GEMINI_PRO,
                    responseFormat: "json",
                });
            }
        } else {
            rawText = await callGemini(prompt, {
                model: AI_MODELS.GEMINI_PRO,
                responseFormat: "json",
            });
        }

        if (!rawText) throw new Error("Gemini returned empty text.");
        const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
        const data = JSON.parse(cleaned);
        const facts = data.facts || [];

        // Save to DB
        if (facts.length > 0) {
             
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await Promise.all(facts.map((fact: any) =>
                prisma.brandFact.create({
                    data: {
                        siteId,
                        factType: fact.factType,
                        value: fact.value,
                        sourceUrl,
                        verified: fact.verified
                    }
                })
            ));

            // Real-Time Propagation: Ping Google Indexing API for the KG Feed
            const site = await prisma.site.findUnique({ where: { id: siteId } });
            if (site) {
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${site.domain}`;
                const kgFeedUrl = `${baseUrl}/api/kg-feed?domain=${site.domain}`;
                await submitUrlForIndexing(siteId, kgFeedUrl, "FACT_EXTRACTED", site.userId);
            }
        }

         
        return facts;
     
    } catch (error: unknown) {
        logger.error("[FactExtractor] Error extracting facts:", { error: (error as Error)?.message || String(error) });
        return [];
    }
}
