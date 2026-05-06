"use server";
import { executeLlmQueries } from "./llmMentions";
import { headers } from "next/headers";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

const PASS_THRESHOLD = 90;
const LLM_TIMEOUT_MS = 15000;

export async function runFreeGsoCheck(domain: string) {
    try {
        if (!domain || domain.trim().length === 0) {
            return { success: false, error: "Domain is required." };
        }

        let cleanDomain: string;
        try {
            const input = domain.trim();
            const url = new URL(input.startsWith("http") ? input : `https://${input}`);
            cleanDomain = url.hostname.replace(/^www\./, "");
        } catch {
            return { success: false, error: "Invalid domain." };
        }

        const reqHeaders = await headers();
        const rawIp = reqHeaders.get("x-forwarded-for") ?? "";
        const ip = rawIp.split(",")[0].trim() || "127.0.0.1";

        try {
            const rateCheck = await checkRateLimit(`free-gso:${ip}`, 3, 86400);
            if (!rateCheck.allowed) {
                return {
                    success: false,
                    error: "You've reached the limit of free checks. Please sign up to scan more domains.",
                };
            }
        } catch (ratelimitError: unknown) {
            logger.error("[Free GSoV] Rate limit failed:", { error: String(ratelimitError) });
            return { success: false, error: "Unable to verify rate limit. Please try again later." };
        }

        const result = await Promise.race([
            executeLlmQueries(cleanDomain, [], false),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
            ),
        ]);

        const categories = result?.checks?.categoryScores?.map?.((c: { label: string; score: number }) => ({
            label: c.label,
            passed: c.score >= PASS_THRESHOLD,
        })) ?? [];

        return {
            success: true,
            data: {
                domain: cleanDomain,
                grade: result.grade,
                mentionRate: result.mentionRate,
                excerpt: result.checks.aiExcerpt,
                categories,
            },
        };
    } catch (error: unknown) {
        logger.error("[Free GSoV] Free check failed:", { error });
        return { success: false, error: "Failed to run the free check. Please try again." };
    }
}