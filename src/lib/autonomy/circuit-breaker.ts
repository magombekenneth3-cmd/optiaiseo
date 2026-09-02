/**
 * Durable Circuit Breaker — Per site+channel failure isolation.
 *
 * State machine: CLOSED → OPEN → HALF_OPEN → CLOSED
 *
 * - CLOSED:    Normal operation. Count consecutive failures.
 * - OPEN:      All autonomous executions for this channel blocked.
 *              Timer running until nextAttemptAt.
 * - HALF_OPEN: Allow exactly ONE execution (probe) to test recovery.
 *              halfOpenProbeInFlight prevents 20 workers from all probing.
 *
 * All state transitions use atomic SQL to prevent race conditions.
 *
 * Scope: site + execution channel (e.g., site:123/wordpress).
 * A broken WordPress integration does NOT shut down GitHub/GSC/IndexNow.
 */

import { logger } from "@/lib/logger";

// ── Types ───────────────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitChannel = "wordpress" | "github" | "gsc" | "indexnow";

export const CIRCUIT_CHANNELS: readonly CircuitChannel[] = [
  "wordpress",
  "github",
  "gsc",
  "indexnow",
] as const;

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Duration in ms before allowing a half-open probe */
  halfOpenAfterMs: number;
  /** Consecutive successes in half-open before closing */
  successThreshold: number;
}

export interface CircuitCheckResult {
  state: CircuitState;
  allowed: boolean;
  isProbe: boolean; // true if this execution is the half-open recovery probe
  reason?: string;
}

// ── Default Config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,           // 3 consecutive failures → OPEN
  halfOpenAfterMs: 30 * 60_000,  // 30 min → allow probe
  successThreshold: 2,           // 2 successes in half-open → CLOSE
};

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Checks the circuit breaker state for a site+channel.
 *
 * Returns:
 * - CLOSED:    allowed=true, isProbe=false
 * - OPEN (timer not elapsed): allowed=false
 * - OPEN (timer elapsed):     transitions to HALF_OPEN, allowed=true, isProbe=true
 *                              (only if halfOpenProbeInFlight is false)
 * - HALF_OPEN (probe in flight): allowed=false
 * - HALF_OPEN (no probe):        allowed=true, isProbe=true
 */
export async function checkCircuitBreaker(
  siteId: string,
  channel: CircuitChannel,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): Promise<CircuitCheckResult> {
  const { prisma } = await import("@/lib/prisma");

  return prisma.$transaction(async (tx: any): Promise<CircuitCheckResult> => {
    // Upsert: create the breaker if it doesn't exist
    let breaker = await tx.circuitBreaker.findUnique({
      where: { siteId_channel: { siteId, channel } },
    });

    if (!breaker) {
      breaker = await tx.circuitBreaker.create({
        data: { siteId, channel, state: "CLOSED" },
      });
    }

    const state = breaker.state as CircuitState;

    // ── CLOSED → always allowed
    if (state === "CLOSED") {
      return { state: "CLOSED" as CircuitState, allowed: true, isProbe: false };
    }

    // ── OPEN → check if timer elapsed
    if (state === "OPEN") {
      const now = new Date();

      if (breaker.nextAttemptAt && now >= breaker.nextAttemptAt) {
        // Timer elapsed — try to become the half-open probe
        const updated = await tx.circuitBreaker.updateMany({
          where: {
            id: breaker.id,
            state: "OPEN",
            halfOpenProbeInFlight: false,
          },
          data: {
            state: "HALF_OPEN",
            halfOpenProbeInFlight: true,
            consecutiveSuccesses: 0,
          },
        });

        if (updated.count > 0) {
          logger.info("[CircuitBreaker] OPEN → HALF_OPEN (probe acquired)", {
            siteId,
            channel,
          });
          return { state: "HALF_OPEN" as CircuitState, allowed: true, isProbe: true };
        }

        // Another worker already claimed the probe
        return {
          state: "OPEN" as CircuitState,
          allowed: false,
          isProbe: false,
          reason: `Circuit OPEN for ${channel} — probe already in flight`,
        };
      }

      // Timer not yet elapsed
      return {
        state: "OPEN" as CircuitState,
        allowed: false,
        isProbe: false,
        reason: `Circuit OPEN for ${channel} — next probe at ${breaker.nextAttemptAt?.toISOString()}`,
      };
    }

    // ── HALF_OPEN → allow only if no probe in flight
    if (state === "HALF_OPEN") {
      if (breaker.halfOpenProbeInFlight) {
        return {
          state: "HALF_OPEN" as CircuitState,
          allowed: false,
          isProbe: false,
          reason: `Circuit HALF_OPEN for ${channel} — probe in flight`,
        };
      }

      // Claim the probe slot
      const updated = await tx.circuitBreaker.updateMany({
        where: {
          id: breaker.id,
          state: "HALF_OPEN",
          halfOpenProbeInFlight: false,
        },
        data: { halfOpenProbeInFlight: true },
      });

      if (updated.count > 0) {
        return { state: "HALF_OPEN" as CircuitState, allowed: true, isProbe: true };
      }

      return {
        state: "HALF_OPEN" as CircuitState,
        allowed: false,
        isProbe: false,
        reason: `Circuit HALF_OPEN for ${channel} — probe claimed by another worker`,
      };
    }

    // Fail closed for unknown states
    return {
      state: "CLOSED" as CircuitState,
      allowed: false,
      isProbe: false,
      reason: `Unknown circuit state: ${state}`,
    };
  });
}

/**
 * Records a successful execution for a site+channel.
 *
 * - CLOSED: resets consecutiveFailures to 0
 * - HALF_OPEN: increments consecutiveSuccesses.
 *   If >= successThreshold → CLOSE the circuit.
 */
export async function recordSuccess(
  siteId: string,
  channel: CircuitChannel,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await prisma.$transaction(async (tx: any) => {
    const breaker = await tx.circuitBreaker.findUnique({
      where: { siteId_channel: { siteId, channel } },
    });

    if (!breaker) return;

    const state = breaker.state as CircuitState;

    if (state === "CLOSED") {
      await tx.circuitBreaker.update({
        where: { id: breaker.id },
        data: {
          consecutiveFailures: 0,
          lastSuccessAt: new Date(),
        },
      });
    } else if (state === "HALF_OPEN") {
      const newSuccesses = breaker.consecutiveSuccesses + 1;

      if (newSuccesses >= config.successThreshold) {
        // Recovery confirmed → CLOSE
        await tx.circuitBreaker.update({
          where: { id: breaker.id },
          data: {
            state: "CLOSED",
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            halfOpenProbeInFlight: false,
            lastSuccessAt: new Date(),
            openedAt: null,
            nextAttemptAt: null,
          },
        });

        logger.info("[CircuitBreaker] HALF_OPEN → CLOSED (recovery confirmed)", {
          siteId,
          channel,
          successesNeeded: config.successThreshold,
        });
      } else {
        await tx.circuitBreaker.update({
          where: { id: breaker.id },
          data: {
            consecutiveSuccesses: newSuccesses,
            halfOpenProbeInFlight: false, // Allow next probe
            lastSuccessAt: new Date(),
          },
        });
      }
    }
  });
}

/**
 * Records a failed execution for a site+channel.
 *
 * - CLOSED: increments consecutiveFailures.
 *   If >= failureThreshold → OPEN the circuit.
 * - HALF_OPEN: immediately OPEN the circuit again.
 */
export async function recordFailure(
  siteId: string,
  channel: CircuitChannel,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  await prisma.$transaction(async (tx: any) => {
    // Upsert the breaker
    let breaker = await tx.circuitBreaker.findUnique({
      where: { siteId_channel: { siteId, channel } },
    });

    if (!breaker) {
      breaker = await tx.circuitBreaker.create({
        data: { siteId, channel, state: "CLOSED" },
      });
    }

    const state = breaker.state as CircuitState;
    const now = new Date();
    const nextAttemptAt = new Date(now.getTime() + config.halfOpenAfterMs);

    if (state === "CLOSED") {
      const newFailures = breaker.consecutiveFailures + 1;

      if (newFailures >= config.failureThreshold) {
        // Threshold reached → OPEN
        await tx.circuitBreaker.update({
          where: { id: breaker.id },
          data: {
            state: "OPEN",
            consecutiveFailures: newFailures,
            consecutiveSuccesses: 0,
            lastFailureAt: now,
            openedAt: now,
            nextAttemptAt,
            halfOpenProbeInFlight: false,
          },
        });

        logger.warn("[CircuitBreaker] CLOSED → OPEN (threshold reached)", {
          siteId,
          channel,
          failures: newFailures,
          nextProbeAt: nextAttemptAt.toISOString(),
        });
      } else {
        await tx.circuitBreaker.update({
          where: { id: breaker.id },
          data: {
            consecutiveFailures: newFailures,
            lastFailureAt: now,
          },
        });
      }
    } else if (state === "HALF_OPEN") {
      // Probe failed → back to OPEN
      await tx.circuitBreaker.update({
        where: { id: breaker.id },
        data: {
          state: "OPEN",
          consecutiveFailures: breaker.consecutiveFailures + 1,
          consecutiveSuccesses: 0,
          lastFailureAt: now,
          openedAt: now,
          nextAttemptAt,
          halfOpenProbeInFlight: false,
        },
      });

      logger.warn("[CircuitBreaker] HALF_OPEN → OPEN (probe failed)", {
        siteId,
        channel,
        nextProbeAt: nextAttemptAt.toISOString(),
      });
    }
  });
}
