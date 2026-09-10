// =============================================================================
// AUDIT LOCK — Token-based renewable lease for SEO audits
//
// Mirrors the analysis-lock.ts pattern:
// - Lock value = unique auditId token (not a static "1")
// - Lease renewal via Lua script (atomic check-and-extend)
// - Conditional release via Lua script (only if token matches)
// - 2-minute initial TTL, auto-renewed by background heartbeat
// - If the holder crashes, lease expires and another run can proceed
// =============================================================================

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/** Initial lease TTL — short enough that crashed holders don't block long */
export const AUDIT_LEASE_TTL_SECONDS = 120;

/** Heartbeat interval — renew at half the TTL to avoid expiry during operations */
export const AUDIT_HEARTBEAT_INTERVAL_MS = (AUDIT_LEASE_TTL_SECONDS / 2) * 1000; // 60s

/**
 * Build the Redis key for a given user + site audit lock.
 * The key includes both userId and siteId to scope correctly.
 */
export function auditLockKey(userId: string, siteId: string): string {
    return `audit-lock:${userId}:${siteId}`;
}

// ── Lua Scripts ─────────────────────────────────────────────────────────────

/**
 * Conditional release: only delete if the current value matches our token.
 * Prevents releasing a lock that was acquired by another audit after ours expired.
 */
const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

/**
 * Lease renewal: only extend TTL if the current value matches our token.
 * Prevents extending a lock that was acquired by another audit.
 */
const RENEW_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("EXPIRE", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Acquire an exclusive audit lease.
 *
 * @param lockKey - The Redis key (from auditLockKey())
 * @param token - Unique token (typically the auditId)
 * @returns true if the lease was acquired, false if another audit holds it.
 *
 * Fails open if Redis is unavailable to avoid blocking in environments
 * without Redis (development, CI).
 */
export async function acquireAuditLease(
    lockKey: string,
    token: string,
): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true;

    try {
        const acquired = await redis.set(lockKey, token, { nx: true, ex: AUDIT_LEASE_TTL_SECONDS });

        if (acquired) {
            logger.info("[AuditLock] Lease acquired", { lockKey, token, ttl: AUDIT_LEASE_TTL_SECONDS });
        }

        return !!acquired;
    } catch (err: unknown) {
        logger.warn("[AuditLock] Redis unavailable — proceeding without lock", {
            lockKey,
            error: (err as Error)?.message,
        });
        return true;
    }
}

/**
 * Renew the audit lease.
 *
 * Called by the heartbeat timer to prevent the lease from expiring
 * during long-running multi-page audits. Only extends if we still hold the lease.
 *
 * @returns true if renewed, false if lease was lost (another audit took over)
 */
export async function renewAuditLease(
    lockKey: string,
    token: string,
): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return true;

    try {
        const result = await redis.eval(
            RENEW_SCRIPT,
            [lockKey],
            [token, AUDIT_LEASE_TTL_SECONDS],
        );
        const renewed = result === 1;

        if (!renewed) {
            logger.warn("[AuditLock] Lease renewal failed — lock lost", { lockKey, token });
        }

        return renewed;
    } catch (err: unknown) {
        logger.error("[AuditLock] Lease renewal error", {
            lockKey,
            error: (err as Error).message,
        });
        return false;
    }
}

/**
 * Release the audit lease — conditional on token match.
 *
 * If our lease expired and another audit acquired the lock, this is a no-op.
 * Never blindly deletes.
 */
export async function releaseAuditLease(
    lockKey: string,
    token: string,
): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    try {
        const result = await redis.eval(
            RELEASE_SCRIPT,
            [lockKey],
            [token],
        );

        if (result === 1) {
            logger.info("[AuditLock] Lease released", { lockKey, token });
        } else {
            logger.warn("[AuditLock] Lease release skipped — token mismatch (another audit owns it)", {
                lockKey,
                token,
            });
        }
    } catch (err: unknown) {
        logger.warn("[AuditLock] Failed to release lease (TTL will expire)", {
            lockKey,
            error: (err as Error).message,
        });
    }
}

/**
 * Check the current owner of an audit lock.
 *
 * @returns The token (auditId) of the current holder, or null if no lock exists.
 */
export async function getAuditLockOwner(lockKey: string): Promise<string | null> {
    const redis = getRedis();
    if (!redis) return null;

    try {
        return await redis.get<string>(lockKey);
    } catch {
        return null;
    }
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export interface AuditLeaseHeartbeat {
    /** Stop the heartbeat interval. Must be called in finally blocks. */
    stop: () => void;
    /** Whether the lease has been lost. */
    isLost: () => boolean;
}

/**
 * Start a background heartbeat that auto-renews the audit lease.
 *
 * Runs every AUDIT_HEARTBEAT_INTERVAL_MS (60s by default — half the lease TTL).
 * On each tick, renews the Redis lease (atomic Lua check-and-extend).
 *
 * If renewal fails (lease lost to another audit), calls onLost() and stops.
 *
 * @param lockKey - The Redis key for the audit lock
 * @param token - The lock token (auditId)
 * @param onLost - Callback invoked when the lease is lost
 * @returns AuditLeaseHeartbeat with stop() and isLost()
 */
export function startAuditLeaseHeartbeat(
    lockKey: string,
    token: string,
    onLost?: () => void,
): AuditLeaseHeartbeat {
    let lost = false;
    let stopped = false;

    const tick = async () => {
        if (stopped || lost) return;

        const renewed = await renewAuditLease(lockKey, token);

        if (!renewed) {
            lost = true;
            stopped = true;
            clearInterval(intervalId);
            logger.error("[AuditLeaseHeartbeat] Lease lost — another audit took over", { lockKey, token });
            onLost?.();
            return;
        }
    };

    const intervalId = setInterval(tick, AUDIT_HEARTBEAT_INTERVAL_MS);

    // Run first heartbeat immediately
    void tick();

    return {
        stop: () => {
            if (!stopped) {
                stopped = true;
                clearInterval(intervalId);
            }
        },
        isLost: () => lost,
    };
}
