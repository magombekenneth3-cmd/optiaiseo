// =============================================================================
// ANALYSIS LOCK — Token-based renewable lease
//
// Provides distributed per-site analysis protection using a renewable lease
// pattern instead of a fixed-TTL lock.
//
// Key properties:
// - Lock value = unique runId token (not a static string)
// - Lease renewal via Lua script (atomic check-and-extend)
// - Conditional release via Lua script (only if token matches)
// - 2-minute initial TTL, auto-renewed by background heartbeat
// - If the holder crashes, lease expires and another run can proceed
// =============================================================================

import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/** Initial lease TTL — short enough that crashed holders don't block long */
export const LEASE_TTL_SECONDS = 120;

/** Heartbeat interval — renew at half the TTL to avoid expiry during operations */
export const HEARTBEAT_INTERVAL_MS = (LEASE_TTL_SECONDS / 2) * 1000; // 60s

const KEY_PREFIX = "site_analysis_lock:";

// ── Lua Scripts ─────────────────────────────────────────────────────────────

/**
 * Conditional release: only delete if the current value matches our token.
 * Prevents releasing a lock that was acquired by another run after ours expired.
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
 * Prevents extending a lock that was acquired by another run.
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
 * Acquire an exclusive analysis lease for a site.
 *
 * @param siteId - The site to lock
 * @param token - Unique token (typically the orchestrator runId)
 * @returns true if the lease was acquired, false if another analysis holds it.
 *
 * Fails open if Redis is unavailable to avoid blocking in environments
 * without Redis (development, CI).
 */
export async function acquireAnalysisLock(
  siteId: string,
  token: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  const key = `${KEY_PREFIX}${siteId}`;
  const acquired = await redis.set(key, token, { nx: true, ex: LEASE_TTL_SECONDS });

  if (acquired) {
    logger.info("[AnalysisLock] Lease acquired", { siteId, token, ttl: LEASE_TTL_SECONDS });
  }

  return !!acquired;
}

/**
 * Renew the analysis lease.
 *
 * Called by the heartbeat timer to prevent the lease from expiring
 * during long-running analysis. Only extends if we still hold the lease.
 *
 * @returns true if renewed, false if lease was lost (another run took over)
 */
export async function renewAnalysisLease(
  siteId: string,
  token: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  const key = `${KEY_PREFIX}${siteId}`;

  try {
    const result = await redis.eval(
      RENEW_SCRIPT,
      [key],
      [token, LEASE_TTL_SECONDS],
    );
    const renewed = result === 1;

    if (!renewed) {
      logger.warn("[AnalysisLock] Lease renewal failed — lock lost", { siteId, token });
    }

    return renewed;
  } catch (err: unknown) {
    logger.error("[AnalysisLock] Lease renewal error", {
      siteId,
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * Release the analysis lease — conditional on token match.
 *
 * If our lease expired and another run acquired the lock, this is a no-op.
 * Never blindly deletes.
 */
export async function releaseAnalysisLock(
  siteId: string,
  token: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const key = `${KEY_PREFIX}${siteId}`;

  try {
    const result = await redis.eval(
      RELEASE_SCRIPT,
      [key],
      [token],
    );

    if (result === 1) {
      logger.info("[AnalysisLock] Lease released", { siteId, token });
    } else {
      logger.warn("[AnalysisLock] Lease release skipped — token mismatch", { siteId, token });
    }
  } catch (err: unknown) {
    logger.warn("[AnalysisLock] Failed to release lease (TTL will expire)", {
      siteId,
      error: (err as Error).message,
    });
  }
}

/**
 * Check if a site currently has an active analysis lease.
 *
 * Lightweight check for the API — does not reveal who holds the lock.
 */
export async function isAnalysisLocked(siteId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const value = await redis.get(`${KEY_PREFIX}${siteId}`);
    return value !== null;
  } catch {
    return false;
  }
}

/**
 * Force-expire a stale lock for a specific site.
 *
 * Used by the stale-run cleanup cron when an AgentRun has been RUNNING
 * for longer than the maximum allowed time.
 */
export async function forceExpireAnalysisLock(siteId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(`${KEY_PREFIX}${siteId}`);
    logger.info("[AnalysisLock] Force-expired stale lock", { siteId });
  } catch (err: unknown) {
    logger.warn("[AnalysisLock] Failed to force-expire lock", {
      siteId,
      error: (err as Error).message,
    });
  }
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export interface LeaseHeartbeat {
  /** Stop the heartbeat interval. Must be called in finally blocks. */
  stop: () => void;
  /** Whether the lease has been lost. Check before each phase. */
  isLost: () => boolean;
}

/**
 * Start a background heartbeat that auto-renews the analysis lease.
 *
 * Runs every HEARTBEAT_INTERVAL_MS (60s by default — half the lease TTL).
 * On each tick:
 *   1. Renews the Redis lease (atomic Lua check-and-extend)
 *   2. Updates AgentRun.lastHeartbeatAt in PostgreSQL
 *
 * If renewal fails (lease lost to another run), calls onLost() and stops.
 *
 * @param siteId - The site being analyzed
 * @param token - The lock token (orchestrator runId)
 * @param runId - The AgentRun ID to update lastHeartbeatAt on
 * @param onLost - Callback invoked when the lease is lost
 * @returns LeaseHeartbeat with stop() and isLost()
 */
export function startLeaseHeartbeat(
  siteId: string,
  token: string,
  runId: string,
  onLost: () => void,
): LeaseHeartbeat {
  let lost = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || lost) return;

    const renewed = await renewAnalysisLease(siteId, token);

    if (!renewed) {
      lost = true;
      stopped = true;
      clearInterval(intervalId);
      logger.error("[LeaseHeartbeat] Lease lost — aborting orchestration", { siteId, token });
      onLost();
      return;
    }

    // Update lastHeartbeatAt in DB (fire-and-forget, non-blocking)
    try {
      const { prisma } = await import("@/lib/prisma");
      await prisma.agentRun.update({
        where: { id: runId },
        data: { lastHeartbeatAt: new Date() },
      });
    } catch (err: unknown) {
      // Non-fatal — the Redis lease is the authoritative signal
      logger.warn("[LeaseHeartbeat] Failed to update lastHeartbeatAt", {
        runId,
        error: (err as Error)?.message,
      });
    }
  };

  const intervalId = setInterval(tick, HEARTBEAT_INTERVAL_MS);

  // Run first heartbeat immediately (updates lastHeartbeatAt right away)
  void tick();

  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        clearInterval(intervalId);
        logger.info("[LeaseHeartbeat] Heartbeat stopped", { siteId, token });
      }
    },
    isLost: () => lost,
  };
}
