// =============================================================================
// Competitor detection engine — Redis-backed cache
//
// Survives serverless cold starts (Vercel/AWS Lambda) unlike in-process Maps.
// Falls back to in-process Maps if Redis is unavailable (dev/CI).
//
// Keys:
//   "comp:fp:{domain}"          → BusinessFingerprint   (TTL 24h)
//   "comp:verify:{sha256hash}"  → VerificationVerdict[] (TTL 1h)
// =============================================================================

import type { BusinessFingerprint, VerificationVerdict } from "./types";

const FP_TTL_SEC     = 60 * 60 * 24;   // 24 hours
const VERIFY_TTL_SEC = 60 * 60;         // 1 hour

// ---------------------------------------------------------------------------
// Redis client (lazy — never imported at module level to avoid breaking CI)
// ---------------------------------------------------------------------------

async function getRedis() {
    try {
        const { redis } = await import("@/lib/redis");
        return redis;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// SHA-256 helper for cache key hashing
// ---------------------------------------------------------------------------

async function sha256Short(input: string): Promise<string> {
    try {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
        return Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 32);
    } catch {
        // Fallback: cheap hash for environments without WebCrypto (e.g. old Node)
        let h = 0;
        for (let i = 0; i < input.length; i++) {
            h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
        }
        return Math.abs(h).toString(16).padStart(8, "0");
    }
}

// ---------------------------------------------------------------------------
// In-process fallback (used in dev / when Redis is unavailable)
// ---------------------------------------------------------------------------

const FP_TTL_MS     = FP_TTL_SEC     * 1000;
const VERIFY_TTL_MS = VERIFY_TTL_SEC * 1000;

interface CacheEntry<T> { value: T; expiresAt: number; }
const _fpMap:     Map<string, CacheEntry<BusinessFingerprint>>  = new Map();
const _verifyMap: Map<string, CacheEntry<VerificationVerdict[]>> = new Map();

// ---------------------------------------------------------------------------
// Fingerprint cache
// ---------------------------------------------------------------------------

export async function getFingerprintCache(domain: string): Promise<BusinessFingerprint | null> {
    const key = `comp:fp:${domain}`;
    const r = await getRedis();

    if (r) {
        try {
            const raw = await r.get<BusinessFingerprint>(key);
            if (raw) return raw;
        } catch { /* fall through to in-process */ }
    }

    // In-process fallback
    const entry = _fpMap.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.value;
    _fpMap.delete(key);
    return null;
}

export async function setFingerprintCache(domain: string, value: BusinessFingerprint): Promise<void> {
    const key = `comp:fp:${domain}`;
    const r = await getRedis();

    if (r) {
        try {
            await r.set(key, value, { ex: FP_TTL_SEC });
            return;
        } catch { /* fall through */ }
    }

    _fpMap.set(key, { value, expiresAt: Date.now() + FP_TTL_MS });
}

// ---------------------------------------------------------------------------
// Verification cache (key is a SHA-256 hash of the domain list + service labels)
// ---------------------------------------------------------------------------

export async function getVerificationCache(rawKey: string): Promise<VerificationVerdict[] | null> {
    const hash = await sha256Short(rawKey);
    const key  = `comp:verify:${hash}`;
    const r    = await getRedis();

    if (r) {
        try {
            const raw = await r.get<VerificationVerdict[]>(key);
            if (raw) return raw;
        } catch { /* fall through */ }
    }

    const entry = _verifyMap.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.value;
    _verifyMap.delete(key);
    return null;
}

export async function setVerificationCache(rawKey: string, value: VerificationVerdict[]): Promise<void> {
    const hash = await sha256Short(rawKey);
    const key  = `comp:verify:${hash}`;
    const r    = await getRedis();

    if (r) {
        try {
            await r.set(key, value, { ex: VERIFY_TTL_SEC });
            return;
        } catch { /* fall through */ }
    }

    _verifyMap.set(key, { value, expiresAt: Date.now() + VERIFY_TTL_MS });
}

// ---------------------------------------------------------------------------
// Cache stats (for logging)
// ---------------------------------------------------------------------------

export function getCacheStats() {
    return {
        fingerprints:  _fpMap.size,
        verifications: _verifyMap.size,
    };
}
