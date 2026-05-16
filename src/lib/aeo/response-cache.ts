import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import type { MentionResult } from "./multi-model";
import type { PerplexityCitationResult } from "./perplexity-citation-check";
import { TTL } from "@/lib/constants/ttl";
import { evictPrefixIfOverBudget } from "@/lib/cache/eviction";

function hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function mentionKey(model: string, domain: string, coreServices?: string | null): string {
    const svcHash = hash(coreServices ?? "");
    return `aeo:mention:${model}:${domain}:${svcHash}`;
}

function perplexityKey(query: string, domain: string): string {
    return `aeo:perplexity:${hash(query)}:${domain}`;
}

function questionsKey(domain: string, coreServices?: string | null): string {
    const svcHash = hash(coreServices ?? "");
    return `aeo:questions:${domain}:${svcHash}`;
}

function embeddingKey(text: string): string {
    return `aeo:embedding:${hash(text)}`;
}

async function redisGet<T>(key: string): Promise<T | null> {
    try {
        const raw = await redis.get(key);
        if (raw === null || raw === undefined) return null;
        return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
    } catch {
        return null;
    }
}

async function redisSet(key: string, value: unknown, ttl: number): Promise<void> {
    try {
        await redis.set(key, JSON.stringify(value), { ex: ttl });
    } catch (err: unknown) {
        logger.warn("[Cache] Redis set failed", { key, error: (err as Error)?.message });
    }
}

let _writeCounter = 0;
const EVICTION_CHECK_INTERVAL = 100;

function maybeEvictAsync(prefix: string): void {
    _writeCounter++;
    if (_writeCounter % EVICTION_CHECK_INTERVAL !== 0) return;
    evictPrefixIfOverBudget(prefix).catch(() => undefined);
}

export async function cachedMentionCheck(
    model: string,
    domain: string,
    coreServices: string | null | undefined,
    fn: (domain: string, coreServices?: string | null) => Promise<MentionResult>
): Promise<MentionResult & { fromCache?: boolean }> {
    const key = mentionKey(model, domain, coreServices);
    const cached = await redisGet<MentionResult>(key);
    if (cached) {
        logger.debug("[Cache] mention hit", { model, domain });
        return { ...cached, fromCache: true };
    }
    const result = await fn(domain, coreServices);
    await redisSet(key, result, TTL.MENTION_S);
    maybeEvictAsync("aeo:mention:");
    return { ...result, fromCache: false };
}

export async function cachedPerplexityCheck(
    query: string,
    domain: string,
    fn: (query: string, domain: string) => Promise<PerplexityCitationResult>
): Promise<PerplexityCitationResult> {
    const key = perplexityKey(query, domain);
    const cached = await redisGet<PerplexityCitationResult>(key);
    if (cached) {
        logger.debug("[Cache] perplexity hit", { query: query.slice(0, 50), domain });
        return cached;
    }
    const result = await fn(query, domain);
    await redisSet(key, result, TTL.PERPLEXITY_S);
    maybeEvictAsync("aeo:perplexity:");
    return result;
}

export async function cachedQuestions(
    domain: string,
    coreServices: string | null | undefined,
    fn: () => Promise<string[]>
): Promise<string[]> {
    const key = questionsKey(domain, coreServices);
    const cached = await redisGet<string[]>(key);
    if (cached) {
        logger.debug("[Cache] questions hit", { domain });
        return cached;
    }
    const result = await fn();
    await redisSet(key, result, TTL.QUESTIONS_S);
    return result;
}

export async function cachedEmbedding(
    text: string,
    fn: (text: string) => Promise<number[]>
): Promise<number[]> {
    const key = embeddingKey(text);
    const cached = await redisGet<number[]>(key);
    if (cached) {
        logger.debug("[Cache] embedding hit", { textLen: text.length });
        return cached;
    }
    const result = await fn(text);
    if (result.length > 0) await redisSet(key, result, TTL.EMBEDDING_S);
    maybeEvictAsync("aeo:embedding:");
    return result;
}

export async function bustDomainCache(domain: string, coreServices?: string | null): Promise<void> {
    const models = ["Gemini", "Perplexity", "ChatGPT", "Claude", "Grok", "Copilot"];
    const keys = [
        ...models.map((m) => mentionKey(m, domain, coreServices)),
        questionsKey(domain, coreServices),
        `aeo:multi:${domain}:${coreServices ?? ""}`,
    ];
    try {
        await Promise.all(keys.map((k) => redis.del(k)));
        logger.info("[Cache] Domain cache busted", { domain, keys: keys.length });
    } catch (err: unknown) {
        logger.warn("[Cache] Bust failed", { domain, error: (err as Error)?.message });
    }
}

const STATS_CACHE_KEY = "aeo:cache:stats";

async function scanCount(prefix: string): Promise<number> {
    let count = 0;
    let cursor = 0;
    do {
        try {
            const res = await (redis as unknown as {
                scan(cursor: number, options: { match: string; count: number }): Promise<[string, string[]]>;
            }).scan(cursor, { match: `${prefix}*`, count: 200 });
            cursor = parseInt(res[0], 10);
            count += res[1].length;
        } catch {
            break;
        }
    } while (cursor !== 0);
    return count;
}

export async function getCacheStats(): Promise<{
    available: boolean;
    estimatedKeys: number;
    breakdown: { mentions: number; perplexity: number; questions: number; embeddings: number };
}> {
    try {
        const statsRaw = await redisGet<{
            available: boolean;
            estimatedKeys: number;
            breakdown: { mentions: number; perplexity: number; questions: number; embeddings: number };
        }>(STATS_CACHE_KEY);
        if (statsRaw) return statsRaw;

        const [mentions, perplexity, questions, embeddings] = await Promise.all([
            scanCount("aeo:mention:"),
            scanCount("aeo:perplexity:"),
            scanCount("aeo:questions:"),
            scanCount("aeo:embedding:"),
        ]);

        const breakdown = { mentions, perplexity, questions, embeddings };
        const result = {
            available: true,
            estimatedKeys: Object.values(breakdown).reduce((a, b) => a + b, 0),
            breakdown,
        };

        await redisSet(STATS_CACHE_KEY, result, TTL.CACHE_STATS_S);
        return result;
    } catch {
        return {
            available: false,
            estimatedKeys: 0,
            breakdown: { mentions: 0, perplexity: 0, questions: 0, embeddings: 0 },
        };
    }
}
