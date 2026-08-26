/**
 * Two-Tier Kill Switch — global, site-level, and per-channel effect control.
 *
 * Provides granular mutation blocking:
 * - GLOBAL_EMERGENCY_STOP: blocks ALL mutations system-wide (env var)
 * - Site automationsPaused: blocks all mutations for one site
 * - Per-channel effect switches: blocks specific effect types per site
 *
 * | Scenario                        | Global | Site | CMS | GitHub | IndexNow |
 * |--------------------------------|--------|------|-----|--------|----------|
 * | Normal operation               | ✅     | ✅   | ✅  | ✅     | ✅       |
 * | WordPress credentials leaked   | ✅     | ✅   | ❌  | ✅     | ✅       |
 * | Full site pause                | ✅     | ❌   | —   | —      | —        |
 * | Global emergency               | ❌     | —    | —   | —      | —        |
 *
 * See: implementation_plan.md v2.1 — Phase 2
 */

import type { KillSwitchChannel } from "./types";
import { MutationBlockedError } from "./types";
import { logger } from "@/lib/logger";

const CHANNEL_TO_SITE_FIELD: Record<KillSwitchChannel, string> = {
  CMS: "effectCmsEnabled",
  GITHUB: "effectGithubEnabled",
  INDEXNOW: "effectIndexNowEnabled",
};

/**
 * Checks the global emergency stop.
 * Currently backed by environment variable (can be extended to Redis).
 *
 * @throws {MutationBlockedError} if global kill switch is active
 */
export async function assertGlobalNotKilled(): Promise<void> {
  if (process.env.GLOBAL_EMERGENCY_STOP === "true") {
    logger.error("[KillSwitch] GLOBAL_EMERGENCY_STOP is active — all mutations blocked");
    throw new MutationBlockedError(
      "GLOBAL_EMERGENCY_STOP is active — all mutations are blocked system-wide"
    );
  }
}

/**
 * Checks site-level automation pause.
 *
 * @throws {MutationBlockedError} if site has automations paused
 */
export async function assertSiteNotKilled(siteId: string): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { automationsPaused: true },
  });

  if (!site) {
    throw new MutationBlockedError(`Site ${siteId} not found`);
  }

  if (site.automationsPaused) {
    logger.warn("[KillSwitch] Site automations paused", { siteId });
    throw new MutationBlockedError(
      `Site ${siteId} has automations paused — all mutations blocked for this site`
    );
  }
}

/**
 * Checks per-channel effect switches before dispatching an effect.
 *
 * @throws {MutationBlockedError} if the effect channel is disabled for the site
 */
export async function assertEffectChannelEnabled(
  siteId: string,
  channel: KillSwitchChannel
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");

  const fieldName = CHANNEL_TO_SITE_FIELD[channel];
  if (!fieldName) {
    throw new Error(`[KillSwitch] Unknown channel: ${channel}`);
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      effectCmsEnabled: true,
      effectGithubEnabled: true,
      effectIndexNowEnabled: true,
    },
  });

  if (!site) {
    throw new MutationBlockedError(`Site ${siteId} not found`);
  }

  const isEnabled = site[fieldName as keyof typeof site] as boolean;
  if (!isEnabled) {
    logger.warn("[KillSwitch] Effect channel disabled", { siteId, channel });
    throw new MutationBlockedError(
      `Effect channel ${channel} is disabled for site ${siteId}`
    );
  }
}

/**
 * Runs all pre-flight kill switch checks for an operation.
 * Call this before any mutation execution.
 *
 * @throws {MutationBlockedError} if any kill switch is active
 */
export async function assertAllKillSwitchesClear(siteId: string): Promise<void> {
  await assertGlobalNotKilled();
  await assertSiteNotKilled(siteId);
}
