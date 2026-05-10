import { logger } from "@/lib/logger";
import { GoogleGenAI } from "@google/genai";
import { AI_MODELS } from "@/lib/constants/ai-models";


export interface FactCheck {
    fact: string;
    expectedValue: string;
    actualValue?: string;
    status: "verified" | "hallucination" | "unknown";
    model: string;
}

export interface FactVerificationResult {
    score: number; // 0-100
    checks: FactCheck[];
}

/**
 * Verifies key brand facts against Gemini's internal knowledge.
 * All fact checks run in parallel via Promise.all() to minimise audit latency.
 */
export async function verifyBrandFacts(domain: string, facts: { label: string; value: string }[]): Promise<FactVerificationResult> {
    if (!process.env.GEMINI_API_KEY || facts.length === 0) {
        return { score: 0, checks: [] };
    }

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Run all fact verifications in parallel — each is an independent check
        const checkResults = await Promise.all(
            facts.map(async (fact): Promise<FactCheck> => {
                const prompt = `
                Context: You are verifying brand facts for a Knowledge Graph.
                Brand/Domain: ${domain}
                Question: What is the ${fact.label} of ${domain}?
                
                I have a source that claims the value is: "${fact.value}".
                
                Compare this to your internal knowledge. If you don't know, say "unknown".
                If you have a different value, provide it.
                
                Respond in JSON:
                {
                    "known": boolean,
                    "value": "string or unknown",
                    "matches": boolean,
                    "explanation": "short explanation"
                }
            `;

                try {
                    const result = await ai.models.generateContent({
                        model: AI_MODELS.GEMINI_FLASH,
                        contents: prompt,
                        config: { responseMimeType: "application/json" }
                    });

                    const text = result.text?.trim() || "{}";
                    const cleanJson = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
                    const data = JSON.parse(cleanJson);

                    let status: FactCheck["status"] = "unknown";
                    if (data.known) {
                        status = data.matches ? "verified" : "hallucination";
                    }

                    return {
                        fact: fact.label,
                        expectedValue: fact.value,
                        actualValue: data.value,
                        status,
                        model: "Gemini"
                    };
                } catch {
                    return {
                        fact: fact.label,
                        expectedValue: fact.value,
                        status: "unknown",
                        model: "Gemini"
                    };
                }
            })
        );

        const verifiedCount = checkResults.filter(c => c.status === "verified").length;
        const score = Math.round((verifiedCount / facts.length) * 100);

        return { score, checks: checkResults };
     
     
    } catch (error: unknown) {
        logger.error("[Fact-Verification] Failed:", { error: (error as Error)?.message || String(error) });
        return { score: 0, checks: [] };
    }
}
