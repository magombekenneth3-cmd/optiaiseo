/**
 * Operation Execution Heartbeat
 *
 * Periodically renews the execution lease while a worker is legitimately
 * executing a MutationOperation. If renewal fails, the worker has lost
 * ownership and MUST stop all mutation work.
 *
 * Design:
 *   lease:      60s   (existing claimExecution default)
 *   heartbeat:  20s   (renews well before expiry)
 *   recovery:   2min  (reconciler window, > lease duration)
 *
 * Usage:
 *   const heartbeat = startOperationHeartbeat(operationId, workerId);
 *   try {
 *     await doMutationWork();
 *     if (heartbeat.leaseLost) throw new LeaseLostError(operationId, workerId);
 *   } finally {
 *     heartbeat.stop();
 *   }
 */

import { logger } from "@/lib/logger";
import { renewLease } from "./concurrency";

// ── Public API ───────────────────────────────────────────────────────────────

export interface HeartbeatOptions {
  /** How often to renew the lease (ms). Default: 20_000 */
  intervalMs?: number;
  /** Duration to extend the lease on each renewal (ms). Default: 60_000 */
  leaseDurationMs?: number;
  /** Called synchronously when a renewal attempt fails. */
  onLeaseLost?: (operationId: string, workerId: string) => void;
}

export interface HeartbeatHandle {
  /** Stop the heartbeat interval. Always call this in a finally block. */
  stop: () => void;
  /** True if a lease renewal has failed. */
  readonly leaseLost: boolean;
  /** Resolves when the lease is lost. Never rejects. */
  readonly leaseLostPromise: Promise<void>;
}

export class LeaseLostError extends Error {
  public readonly operationId: string;
  public readonly workerId: string;

  constructor(operationId: string, workerId: string) {
    super(
      `[Heartbeat] Worker "${workerId}" lost lease on operation "${operationId}". ` +
      "Mutation work aborted to prevent duplicate execution."
    );
    this.name = "LeaseLostError";
    this.operationId = operationId;
    this.workerId = workerId;
  }
}

/**
 * Starts a background heartbeat that periodically renews the execution lease.
 */
export function startOperationHeartbeat(
  operationId: string,
  workerId: string,
  options: HeartbeatOptions = {}
): HeartbeatHandle {
  const {
    intervalMs = 20_000,
    leaseDurationMs = 60_000,
    onLeaseLost,
  } = options;

  let _leaseLost = false;
  let _intervalId: ReturnType<typeof setInterval> | null = null;

  let _resolveLeaseLost!: () => void;
  const _leaseLostPromise = new Promise<void>((resolve) => {
    _resolveLeaseLost = resolve;
  });

  const handleLeaseLost = () => {
    if (_leaseLost) return;
    _leaseLost = true;

    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }

    logger.error("[Heartbeat] Lease lost — stopping worker", {
      operationId,
      workerId,
    });

    _resolveLeaseLost();

    try {
      onLeaseLost?.(operationId, workerId);
    } catch (callbackErr) {
      logger.error("[Heartbeat] onLeaseLost callback threw", {
        operationId,
        workerId,
        error: (callbackErr as Error)?.message,
      });
    }
  };

  const doRenewal = async () => {
    if (_leaseLost) return;

    try {
      const renewed = await renewLease(operationId, workerId, leaseDurationMs);
      if (!renewed) {
        handleLeaseLost();
      }
    } catch (err) {
      logger.warn("[Heartbeat] Renewal attempt threw — will retry next interval", {
        operationId,
        workerId,
        error: (err as Error)?.message,
      });
    }
  };

  _intervalId = setInterval(doRenewal, intervalMs);

  const handle: HeartbeatHandle = {
    stop() {
      if (_intervalId !== null) {
        clearInterval(_intervalId);
        _intervalId = null;
      }
    },
    get leaseLost() {
      return _leaseLost;
    },
    get leaseLostPromise() {
      return _leaseLostPromise;
    },
  };

  logger.info("[Heartbeat] Started", {
    operationId,
    workerId,
    intervalMs,
    leaseDurationMs,
  });

  return handle;
}
