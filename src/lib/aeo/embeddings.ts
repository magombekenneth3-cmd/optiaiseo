import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import { cachedEmbedding } from "./response-cache";

/**
 * Utility for generating embeddings and calculating semantic similarity
 * using Gemini and standard cosine similarity.
 */

// Lazy singleton — only instantiated when called at runtime, not at module load.
// This prevents Next.js build from crashing when GEMINI_API_KEY is not set.
let _genAI: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
    if (!_genAI) {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        _genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return _genAI;
}

/**
 * Generates a vector embedding for a given text.
 */
async function _getEmbedding(text: string): Promise<number[]> {
    if (!process.env.GEMINI_API_KEY) return [];

    try {
        const result = await getGenAI().models.embedContent({
            model: "text-embedding-004",
            contents: text,
        });
        return result.embeddings?.[0]?.values || [];
     
     
    } catch (error: unknown) {
        logger.error("[Embeddings] Failed to generate embedding:", { error: (error as Error)?.message || String(error) });
        return [];
    }
}

/**
 * Calculates cosine similarity between two vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Checks if two strings are semantically similar above a certain threshold.
 */
export async function getEmbedding(text: string): Promise<number[]> {
    return cachedEmbedding(text, _getEmbedding);
}

export async function areSemanticallySimilar(textA: string, textB: string, threshold = 0.85): Promise<boolean> {
    const [embA, embB] = await Promise.all([getEmbedding(textA), getEmbedding(textB)]);
    const similarity = cosineSimilarity(embA, embB);
    return similarity >= threshold;
}
