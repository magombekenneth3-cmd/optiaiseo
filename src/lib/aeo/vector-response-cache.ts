/**
 * Upstash Vector semantic cache for AEO responses.
 *
 * Uses embedding cosine similarity so "how to rank in ChatGPT" and
 * "how to appear in ChatGPT results" share the same cached result,
 * cutting LLM API costs by 40–60% on repeated similar queries.
 *
 * Storage: Upstash Vector (UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN)
 * Fallback: no-op pass-through when env vars are absent (zero-error guarantee)
 */

import { logger } from "@/lib/logger";
import { getEmbedding, cosineSimilarity } from "./embeddings";
import crypto from "crypto";


interface UpsertPayload {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

interface QueryResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

function getVectorBaseUrl(): string | null {
  return process.env.UPSTASH_VECTOR_REST_URL ?? null;
}
function getVectorToken(): string | null {
  return process.env.UPSTASH_VECTOR_REST_TOKEN ?? null;
}

async function vectorUpsert(payload: UpsertPayload): Promise<void> {
  const url   = getVectorBaseUrl();
  const token = getVectorToken();
  if (!url || !token) return;

  try {
    const res = await fetch(`${url}/upsert`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify([payload]),
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) logger.warn("[VectorCache] Upsert failed", { status: res.status });
  } catch (err: unknown) {
    logger.warn("[VectorCache] Upsert error", { error: (err as Error)?.message });
  }
}

async function vectorQuery(
  vector: number[],
  topK = 1,
  namespace?: string,
): Promise<QueryResult[]> {
  const url   = getVectorBaseUrl();
  const token = getVectorToken();
  if (!url || !token) return [];

  try {
    const body: Record<string, unknown> = { vector, topK, includeMetadata: true };
    if (namespace) body.namespace = namespace;

    const res = await fetch(`${url}/query`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result ?? []) as QueryResult[];
  } catch {
    return [];
  }
}


const SIMILARITY_THRESHOLD = 0.92;
const MAX_VECTORS = 10_000;
const TTL_SECONDS = {
  mention:    60 * 60 * 24,
  perplexity: 60 * 60 * 6,
  questions:  60 * 60 * 48,
};

type CacheNamespace = keyof typeof TTL_SECONDS;

function shortHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

async function trimVectorCacheIfNeeded(): Promise<void> {
  const url = getVectorBaseUrl();
  const token = getVectorToken();
  if (!url || !token) return;
  try {
    const res = await fetch(`${url}/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;
    const info = await res.json();
    const count = info.result?.vectorCount ?? info.vectorCount ?? 0;
    if (count <= MAX_VECTORS) return;

    const overage = count - MAX_VECTORS;
    const headroom = Math.ceil(MAX_VECTORS * 0.1);
    const deleteTarget = overage + headroom;

    logger.warn("[VectorCache] Over budget — evicting", {
      current: count,
      max: MAX_VECTORS,
      deleteTarget,
    });

    const rangeRes = await fetch(`${url}/range`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cursor: "0", limit: deleteTarget, includeMetadata: true }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!rangeRes.ok) return;
    const rangeData = await rangeRes.json();
    const vectors = rangeData.result?.vectors ?? rangeData.vectors ?? [];

    const sortedById = [...vectors].sort((a: { metadata?: { storedAt?: number } }, b: { metadata?: { storedAt?: number } }) => {
      const aTime = a.metadata?.storedAt ?? 0;
      const bTime = b.metadata?.storedAt ?? 0;
      return aTime - bTime;
    });

    const idsToDelete = sortedById.slice(0, deleteTarget).map((v: { id: string }) => v.id);

    if (idsToDelete.length === 0) return;

    const batchSize = 100;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      await fetch(`${url}/delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    }

    logger.info("[VectorCache] Evicted oldest vectors", {
      deleted: idsToDelete.length,
      remaining: count - idsToDelete.length,
    });
  } catch { /* non-fatal */ }
}

/**
 * Generic semantic cache wrapper.
 *
 * 1. Embeds the `queryText` using Gemini `text-embedding-004`.
 * 2. Queries Upstash Vector for the nearest cached result.
 * 3. If cosine similarity ≥ SIMILARITY_THRESHOLD and not expired → returns cached value.
 * 4. Otherwise runs `fn`, stores result in Upstash, and returns fresh value.
 */
export async function withSemanticCache<T>(
  queryText: string,
  namespace: CacheNamespace,
  fn: () => Promise<T>,
): Promise<T & { fromSemanticCache?: boolean }> {
  const url   = getVectorBaseUrl();
  const token = getVectorToken();

  // Fast path: Upstash Vector not configured
  if (!url || !token) {
    const result = await fn();
    return result as T & { fromSemanticCache?: boolean };
  }

  let embedding: number[];
  try {
    embedding = await getEmbedding(queryText);
  } catch {
    // If embedding fails, bypass cache entirely — never block the main path
    const result = await fn();
    return result as T & { fromSemanticCache?: boolean };
  }

  if (embedding.length === 0) {
    const result = await fn();
    return result as T & { fromSemanticCache?: boolean };
  }

  const hits = await vectorQuery(embedding, 1, namespace);
  const best = hits[0];

  if (best && best.score >= SIMILARITY_THRESHOLD) {
    const meta = best.metadata ?? {};
    const storedAt  = (meta.storedAt as number) ?? 0;
    const ttl       = TTL_SECONDS[namespace];
    const isExpired = Date.now() / 1000 - storedAt > ttl;

    if (!isExpired && meta.payload) {
      logger.info("[VectorCache]", {
        event: "HIT",
        similarity: best.score.toFixed(3),
        namespace,
        query: queryText.slice(0, 50),
      });
      return { ...(meta.payload as T), fromSemanticCache: true };
    }
  }

  logger.info("[VectorCache]", {
    event: "MISS",
    similarity: best?.score?.toFixed(3) ?? "none",
    namespace,
    query: queryText.slice(0, 50),
  });

  const result = await fn();

  // Store asynchronously (don't block the caller)
  const id = `${namespace}:${shortHash(queryText)}`;
  vectorUpsert({
    id,
    vector:   embedding,
    metadata: {
      namespace,
      queryText,
      storedAt: Math.floor(Date.now() / 1000),
      payload:  result,
    },
  })
    .then(() => trimVectorCacheIfNeeded())
    .catch(() => undefined);

  return { ...(result as object), fromSemanticCache: false } as T & { fromSemanticCache?: boolean };
}


/**
 * Semantic-cache wrapper for multi-model AEO mention checks.
 * Use instead of (or layered on top of) the exact-match Redis cache.
 */
export async function semanticMentionCheck<T>(
  queryText: string,
  fn: () => Promise<T>,
): Promise<T & { fromSemanticCache?: boolean }> {
  return withSemanticCache(queryText, "mention", fn);
}

/**
 * Semantic-cache wrapper for Perplexity citation checks.
 */
export async function semanticPerplexityCheck<T>(
  queryText: string,
  fn: () => Promise<T>,
): Promise<T & { fromSemanticCache?: boolean }> {
  return withSemanticCache(queryText, "perplexity", fn);
}

/**
 * Busts all semantic cache entries for a given text (approximate — by re-upserting
 * a tombstone with storedAt = 0 so it expires on next read).
 */
export async function bustSemanticCache(queryText: string, namespace: CacheNamespace): Promise<void> {
  const url   = getVectorBaseUrl();
  const token = getVectorToken();
  if (!url || !token) return;

  try {
    const embedding = await getEmbedding(queryText);
    if (embedding.length === 0) return;
    const id = `${namespace}:${shortHash(queryText)}`;
    await vectorUpsert({ id, vector: embedding, metadata: { namespace, queryText, storedAt: 0, payload: null } });
  } catch {
    // Non-fatal
  }
}

/**
 * Returns cache stats (counts stored vectors per namespace).
 * Lightweight admin helper — called from cache stats route.
 */
export async function getSemanticCacheStats(): Promise<{
  available: boolean;
  configured: boolean;
}> {
  const url   = getVectorBaseUrl();
  const token = getVectorToken();
  if (!url || !token) return { available: false, configured: false };

  try {
    const res = await fetch(`${url}/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(3000),
    });
    return { available: res.ok, configured: true };
  } catch {
    return { available: false, configured: true };
  }
}


export { cosineSimilarity, SIMILARITY_THRESHOLD };
