/**
 * Phase D.7.8 — Portfolio Gate for D.3 Planning
 *
 * Checks whether an OPEN opportunity should receive D.3 planning capacity
 * based on its D.7 portfolio allocation status.
 *
 * TWO MODES:
 *   Portfolio disabled → gate passes, D.3 plans everything (backward-compatible)
 *   Portfolio enabled  → only SELECTED allocations with valid fences proceed
 *
 * INVARIANT: This gate is observational. It NEVER:
 *   - Modifies allocations or opportunities
 *   - Reserves budget, creates claims, or transitions lifecycle
 *   - Imports from mutations/, autonomy/, or proposals/
 */

import { logger } from "@/lib/logger";
import type { AllocationFenceCheck } from "@/lib/portfolio/types";

// ── Portfolio Enablement ────────────────────────────────────────────────────

/**
 * Runtime portfolio optimization toggle, read from environment.
 *
 * Set `D7_PORTFOLIO_OPTIMIZATION_ENABLED=true` in deployment config to activate.
 * When unset or any other value: D.3 plans all OPEN opportunities — no D.7 gating.
 * When "true": D.3 only plans opportunities with a valid SELECTED allocation.
 *
 * Cached at module load for performance. Restart/redeploy to change.
 * Will be upgraded to per-site rollout when portfolio optimization
 * graduates to general availability.
 */
const PORTFOLIO_OPTIMIZATION_ENABLED =
  process.env.D7_PORTFOLIO_OPTIMIZATION_ENABLED === "true";

// ── Public API ──────────────────────────────────────────────────────────────

export interface PortfolioGateResult {
  /** True if the gate blocked this opportunity from planning */
  gated: boolean;
  /** Reason codes explaining why (empty if not gated) */
  reasons: Array<{ rule: string; details: string }>;
}

/**
 * Checks whether an opportunity should receive D.3 planning capacity.
 *
 * Returns { gated: false } if:
 *   - Portfolio optimization is disabled (backward-compatible passthrough)
 *   - Site has automations paused (let D.3 handle its own kill-switch)
 *   - Opportunity has a SELECTED allocation with a valid fence
 *
 * Returns { gated: true, reasons } if:
 *   - Portfolio is enabled but no SELECTED allocation exists
 *   - Portfolio is enabled but the allocation fence is stale
 */
export async function checkPortfolioGate(
  opportunityId: string,
  siteId: string
): Promise<PortfolioGateResult> {
  // Fast path: portfolio optimization disabled → passthrough
  if (!PORTFOLIO_OPTIMIZATION_ENABLED) {
    return { gated: false, reasons: [] };
  }

  const { prisma } = await import("@/lib/prisma");
  const { validateAllocationFence } = await import("@/lib/portfolio/allocation-fence");

  // ── 1. Find current SELECTED allocation for this opportunity ──────────
  const now = new Date();

  const allocation = await (prisma as any).portfolioAllocation.findFirst({
    where: {
      opportunityId,
      siteId,
      decision: "SELECTED",
      expiresAt: { gt: now },
    },
    orderBy: { allocatedAt: "desc" },
    select: { id: true },
  });

  if (!allocation) {
    logger.info("[PortfolioGate] No SELECTED allocation — deferring", {
      opportunityId,
      siteId,
    });
    return {
      gated: true,
      reasons: [{
        rule: "NOT_PORTFOLIO_SELECTED",
        details: `Opportunity ${opportunityId} has no current SELECTED allocation`,
      }],
    };
  }

  // ── 2. Validate the allocation fence ──────────────────────────────────
  const fence: AllocationFenceCheck = await validateAllocationFence(allocation.id, now);

  if (!fence.valid) {
    logger.info("[PortfolioGate] Allocation fence stale — deferring", {
      opportunityId,
      siteId,
      allocationId: allocation.id,
      reason: fence.reason,
    });
    return {
      gated: true,
      reasons: [{
        rule: "STALE_ALLOCATION",
        details: `STALE_ALLOCATION:${fence.reason}`,
      }],
    };
  }

  // ── 3. Gate passes — allocation is valid ──────────────────────────────
  logger.info("[PortfolioGate] Portfolio gate passed", {
    opportunityId,
    siteId,
    allocationId: allocation.id,
  });

  return { gated: false, reasons: [] };
}

/**
 * Returns whether portfolio optimization is enabled.
 *
 * Exposed for use by the reconciliation cron to skip
 * non-SELECTED opportunities when portfolio mode is active.
 */
export function isPortfolioOptimizationEnabled(): boolean {
  return PORTFOLIO_OPTIMIZATION_ENABLED;
}
