"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";

// Prisma uses cuid() for all PKs — validate as a non-empty string ≤ 50 chars
const uuidSchema = z.string().min(1).max(50);
const querySchema = z.string().min(1).max(500);

type ActionError = { success: false; error: string };

type SaveAeoProofResult =
  | { success: true; shareToken: string; shareUrl: string }
  | ActionError;

type GetAeoProofsResult =
  | { success: true; proofs: ProofRow[] }
  | ActionError;

type ProofRow = {
  id: string;
  query: string;
  responseText: string;
  cited: boolean;
  shareToken: string;
  createdAt: Date;
};

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

export async function saveAeoProof(
  siteId: string,
  query: string,
  responseText: string,
  cited: boolean
): Promise<SaveAeoProofResult> {
  if (!uuidSchema.safeParse(siteId).success) return { success: false, error: "Invalid site ID." };
  if (!querySchema.safeParse(query).success) return { success: false, error: "Query must be 1–500 characters." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const site = await prisma.site.findFirst({ where: { id: siteId, userId: user.id } });
    if (!site) return { success: false, error: "Site not found" };

    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const proof = await prisma.aeoProof.create({
      data: { siteId, query, responseText, cited, expiresAt },
    });

    const siteUrl = (process.env.NEXTAUTH_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

    return {
      success: true,
      shareToken: proof.shareToken,
      shareUrl: `${siteUrl}/proof/${proof.shareToken}`,
    };
  } catch (err: unknown) {
    logger.error("[AeoProof] saveAeoProof failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to save proof." };
  }
}

export async function getAeoProofs(siteId: string): Promise<GetAeoProofsResult> {
  if (!uuidSchema.safeParse(siteId).success) return { success: false, error: "Invalid site ID." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const site = await prisma.site.findFirst({ where: { id: siteId, userId: user.id } });
    if (!site) return { success: false, error: "Site not found" };

    const proofs = await prisma.aeoProof.findMany({
      where: { siteId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, query: true, responseText: true, cited: true, shareToken: true, createdAt: true },
    });

    return { success: true, proofs };
  } catch (err: unknown) {
    logger.error("[AeoProof] getAeoProofs failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to load proofs." };
  }
}
