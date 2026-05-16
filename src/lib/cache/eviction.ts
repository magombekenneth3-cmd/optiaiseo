import { redis, isRedisConfigured } from "@/lib/redis";
import { logger } from "@/lib/logger";

const PREFIX_BUDGETS: Record<string, number> = {
  "aeo:embedding:":   5_000,
  "aeo:mention:":     3_000,
  "aeo:perplexity:":  2_000,
  "aeo:questions:":   1_000,
  "aeo:multi:":       1_000,
};

const TOTAL_KEY_BUDGET = 15_000;

async function scanKeys(prefix: string, limit = 20_000): Promise<string[]> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    try {
      const res = await (redis as unknown as {
        scan(cursor: number, options: { match: string; count: number }): Promise<[string, string[]]>;
      }).scan(cursor, { match: `${prefix}*`, count: 500 });
      cursor = parseInt(res[0], 10);
      keys.push(...res[1]);
      if (keys.length >= limit) break;
    } catch {
      break;
    }
  } while (cursor !== 0);
  return keys;
}

async function evictOldestKeys(keys: string[], deleteCount: number): Promise<number> {
  if (deleteCount <= 0 || keys.length === 0) return 0;

  const ttls = await Promise.all(
    keys.slice(0, 5000).map(async (k) => {
      try {
        const ttl = await redis.ttl(k);
        return { key: k, ttl: ttl ?? -1 };
      } catch {
        return { key: k, ttl: -1 };
      }
    })
  );

  ttls.sort((a, b) => a.ttl - b.ttl);

  const toDelete = ttls.slice(0, deleteCount).map((t) => t.key);
  if (toDelete.length === 0) return 0;

  const batchSize = 100;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const batch = toDelete.slice(i, i + batchSize);
    try {
      const result = await redis.del(...batch);
      deleted += typeof result === "number" ? result : batch.length;
    } catch {
      /* non-fatal */
    }
  }

  return deleted;
}

export async function evictPrefixIfOverBudget(prefix: string, budget?: number): Promise<{ scanned: number; evicted: number }> {
  if (!isRedisConfigured) return { scanned: 0, evicted: 0 };

  const maxKeys = budget ?? PREFIX_BUDGETS[prefix] ?? 2_000;
  const keys = await scanKeys(prefix);
  const overage = keys.length - maxKeys;

  if (overage <= 0) {
    return { scanned: keys.length, evicted: 0 };
  }

  const headroom = Math.ceil(maxKeys * 0.1);
  const deleteCount = overage + headroom;

  const evicted = await evictOldestKeys(keys, deleteCount);

  logger.info("[Eviction]", {
    prefix,
    scanned: keys.length,
    budget: maxKeys,
    overage,
    evicted,
  });

  return { scanned: keys.length, evicted };
}

export async function runFullEvictionSweep(): Promise<{
  totalScanned: number;
  totalEvicted: number;
  prefixes: Record<string, { scanned: number; evicted: number }>;
}> {
  if (!isRedisConfigured) {
    return { totalScanned: 0, totalEvicted: 0, prefixes: {} };
  }

  const prefixes: Record<string, { scanned: number; evicted: number }> = {};
  let totalScanned = 0;
  let totalEvicted = 0;

  for (const [prefix, budget] of Object.entries(PREFIX_BUDGETS)) {
    const result = await evictPrefixIfOverBudget(prefix, budget);
    prefixes[prefix] = result;
    totalScanned += result.scanned;
    totalEvicted += result.evicted;
  }

  const allAeoKeys = await scanKeys("aeo:");
  if (allAeoKeys.length > TOTAL_KEY_BUDGET) {
    const globalOverage = allAeoKeys.length - TOTAL_KEY_BUDGET;
    const globalHeadroom = Math.ceil(TOTAL_KEY_BUDGET * 0.05);
    const globalEvicted = await evictOldestKeys(allAeoKeys, globalOverage + globalHeadroom);
    prefixes["_global"] = { scanned: allAeoKeys.length, evicted: globalEvicted };
    totalEvicted += globalEvicted;

    logger.warn("[Eviction] Global budget exceeded", {
      total: allAeoKeys.length,
      budget: TOTAL_KEY_BUDGET,
      evicted: globalEvicted,
    });
  }

  logger.info("[Eviction] Sweep complete", { totalScanned, totalEvicted });

  return { totalScanned, totalEvicted, prefixes };
}
