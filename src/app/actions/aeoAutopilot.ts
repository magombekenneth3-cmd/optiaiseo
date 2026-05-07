"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { randomBytes } from "crypto";
import { z } from "zod";

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);

type ActionError = { success: false; error: string };

type AutopilotConfigResult =
  | { success: true; enabled: boolean; schedule: string; digestEnabled: boolean }
  | ActionError;

type UpdateAutopilotResult = { success: boolean; error?: string };

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

export async function getAutopilotConfig(siteId: string): Promise<AutopilotConfigResult> {
  if (!uuidSchema.safeParse(siteId).success) return { success: false, error: "Invalid site ID." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const site = await prisma.site.findFirst({
      where: { id: siteId, userId: user.id },
      select: { aeoAutopilotEnabled: true, aeoAutopilotSchedule: true, aeoDigestEnabled: true },
    });
    if (!site) return { success: false, error: "Site not found" };

    return {
      success: true,
      enabled: site.aeoAutopilotEnabled,
      schedule: site.aeoAutopilotSchedule,
      digestEnabled: site.aeoDigestEnabled,
    };
  } catch (err: unknown) {
    logger.error("[Autopilot] getAutopilotConfig failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to load autopilot config." };
  }
}

export async function updateAutopilotConfig(
  siteId: string,
  enabled: boolean,
  schedule: "daily" | "weekly" | "biweekly",
  digestEnabled: boolean
): Promise<UpdateAutopilotResult> {
  if (!uuidSchema.safeParse(siteId).success) return { success: false, error: "Invalid site ID." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    await prisma.site.updateMany({
      where: { id: siteId, userId: user.id },
      data: { aeoAutopilotEnabled: enabled, aeoAutopilotSchedule: schedule, aeoDigestEnabled: digestEnabled },
    });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[Autopilot] updateAutopilotConfig failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to update autopilot config." };
  }
}

export async function generatePublicBadgeToken(siteId: string): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!uuidSchema.safeParse(siteId).success) return { success: false, error: "Invalid site ID." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const token = randomBytes(20).toString("hex");
    await prisma.site.updateMany({
      where: { id: siteId, userId: user.id },
      data: { aeoPublicToken: token },
    });
    return { success: true, token };
  } catch (err: unknown) {
    logger.error("[Badge] generatePublicBadgeToken failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to generate badge token." };
  }
}
