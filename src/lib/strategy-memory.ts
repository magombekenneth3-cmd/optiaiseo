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
    | "completed_action"
    | "audit_result"
    | "aeo_result"
    | "competitor_insight"
    | "keyword_snapshot";

export interface MemoryEntry {
    memoryType: MemoryType;
    content: string;
    metadata?: Record<string, unknown>;
    expiresAt?: Date;
}

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

export async function cleanExpiredMemories(userId: string, siteId: string): Promise<number> {
    try {
        const result = await prisma.strategyMemory.deleteMany({
            where: {
                userId,
                siteId,
                expiresAt: { lt: new Date() },
            },
        });
        return result.count;
    } catch {
        return 0;
    }
}

export function formatMemoriesForPrompt(
    memories: { memoryType: string; content: string; createdAt: Date }[]
): string {
    if (memories.length === 0) return "";

    const groups: Record<string, string[]> = {};
    for (const m of [...memories].reverse()) {
        const date = m.createdAt.toISOString().split("T")[0];
        const key = m.memoryType.toUpperCase().replace(/_/g, " ");
        if (!groups[key]) groups[key] = [];
        groups[key].push(`[${date}] ${m.content}`);
    }

    const sections = Object.entries(groups)
        .map(([type, entries]) => `### ${type}\n${entries.join("\n")}`)
        .join("\n\n");

    return `## What you remember about this user\n\nUse these memories to personalise your responses. Reference past conversations, track progress on goals, and avoid repeating advice already given.\n\n${sections}\n`;
}

export async function summariseSession(
    transcript: Array<{ role: "user" | "assistant"; text: string }>
): Promise<string | null> {
    if (transcript.length < 4) return null;

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

export async function saveToolResult(
    userId: string,
    siteId: string,
    toolName: string,
    result: Record<string, unknown>
): Promise<void> {
    const typeMap: Record<string, MemoryType> = {
        runSiteAudit: "audit_result",
        runOnPageAudit: "audit_result",
        runFullAeoAudit: "aeo_result",
        checkCompetitor: "competitor_insight",
        getKeywordRankings: "keyword_snapshot",
        triggerAutoFix: "completed_action",
        detectAndHeal: "completed_action",
    };

    const memoryType = typeMap[toolName];
    if (!memoryType) return;

    let content = "";
    const domain = (result.domain as string) ?? "";

    switch (toolName) {
        case "runSiteAudit":
        case "runOnPageAudit":
            content = `Audited ${domain}: score ${result.overallScore ?? result.score}/100. ${result.criticalIssueCount ?? 0} critical issues.`;
            break;
        case "runFullAeoAudit":
            content = `AEO audit ${domain}: grade ${result.grade}, score ${result.score}/100. ${result.highImpactFailCount ?? 0} high-impact failures.`;
            break;
        case "checkCompetitor":
            content = `Compared ${result.myDomain} (score ${result.myScore}) vs ${result.competitorDomain} (score ${result.competitorScore}). Winner: ${result.winner}.`;
            break;
        case "getKeywordRankings":
            content = `Keyword snapshot for ${domain}: ${result.totalKeywords ?? 0} keywords, ${result.page1Count ?? 0} on page 1.`;
            break;
        case "triggerAutoFix":
            content = `Auto-fix PR created for ${domain}: ${result.filePath ?? "unknown file"}. PR: ${result.prUrl ?? "pending"}.`;
            break;
        case "detectAndHeal":
            content = `Healing triggered for ${domain}: ${result.actionsExecuted ?? 0} actions executed.`;
            break;
        default:
            return;
    }

    if (!content) return;

    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);

    await saveMemory(userId, siteId, {
        memoryType,
        content,
        metadata: { toolName, ...result },
        expiresAt: thirtyDays,
    });
}
