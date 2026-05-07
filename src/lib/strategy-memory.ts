/**
 * Win 9: Strategy Memory — helpers for reading/writing Aria session memories.
 * Import this in livekit-agent.ts and any route that fires key user events.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

export type MemoryType =
    | "accepted_fix"
    | "dismissed_suggestion"
    | "user_goal"
    | "session_summary"
    | "tracked_metric"
    | "completed_action";

export interface MemoryEntry {
    memoryType: MemoryType;
    content: string;
    metadata?: Record<string, unknown>;
    expiresAt?: Date;
}

// ── Write a single memory ─────────────────────────────────────────────────────
export async function saveMemory(
    userId: string,
    siteId: string,
    entry: MemoryEntry
): Promise<void> {
    try {
        await prisma.strategyMemory.create({
            data: {
                userId,
                siteId,
                memoryType: entry.memoryType,
                content: entry.content,
                metadata: entry.metadata !== undefined
                    ? (entry.metadata as Prisma.InputJsonValue)
                    : undefined,
                expiresAt: entry.expiresAt ?? null,
            },
        });
    } catch (e: unknown) {
        logger.warn("[StrategyMemory] Failed to save memory", { error: (e as Error)?.message });
    }
}

// ── Load the last N memories for a user+site (within 30 days) ─────────────────
export async function loadMemories(
    userId: string,
    siteId: string,
    limit = 25
): Promise<{ memoryType: string; content: string; createdAt: Date }[]> {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const now = new Date();

    return prisma.strategyMemory.findMany({
        where: {
            userId,
            siteId,
            createdAt: { gte: since },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { memoryType: true, content: true, createdAt: true },
    });
}

// ── Format memories as a system-prompt section ────────────────────────────────
export function formatMemoriesForPrompt(
    memories: { memoryType: string; content: string; createdAt: Date }[]
): string {
    if (memories.length === 0) return "";

    const lines = memories
        .reverse() // chronological order
        .map(m => {
            const date = m.createdAt.toISOString().split("T")[0];
            return `[${m.memoryType.toUpperCase().replace(/_/g, " ")} - ${date}] ${m.content}`;
        });

    return `## What you remember about this user\n\n${lines.join("\n")}\n`;
}

// ── Summarise a session using Gemini Flash ────────────────────────────────────
export async function summariseSession(
    transcript: Array<{ role: "user" | "assistant"; text: string }>
): Promise<string | null> {
    if (transcript.length < 4) return null; // too short to summarise

    try {
        const { callGemini } = await import("@/lib/gemini");
        const dialogue = transcript
            .map(t => `${t.role === "user" ? "User" : "Aria"}: ${t.text}`)
            .join("\n");

        const prompt = `You are summarising an SEO strategy conversation for future reference.
In 2-3 plain English sentences, summarise:
1. What the user asked about or wanted to improve
2. What was recommended or agreed upon
3. Any specific actions the user committed to

Conversation:
${dialogue.substring(0, 4000)}

Summary (2-3 sentences only, no bullet points):`;

        const text = await callGemini(prompt, { maxOutputTokens: 256, temperature: 0.3 });
        return text?.trim() ?? null;
    } catch {
        return null;
    }
}
