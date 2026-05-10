"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

const uuidSchema = z.string().min(1).max(50);
const nameSchema = z.string().min(1).max(64);

type ActionError = { success: false; error: string };

type CreateApiKeyResult =
  | { success: true; key: string; id: string; prefix: string }
  | ActionError;

type ListApiKeysResult =
  | { success: true; keys: ApiKeyRow[] }
  | ActionError;

type RevokeApiKeyResult = { success: boolean; error?: string };

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

export async function createApiKey(name: string): Promise<CreateApiKeyResult> {
  if (!nameSchema.safeParse(name).success) return { success: false, error: "Name must be 1–64 characters." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const existing = await prisma.apiKey.count({ where: { userId: user.id } });
    if (existing >= 10) return { success: false, error: "Maximum of 10 API keys reached." };

    const rawKey = `oai_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    const record = await prisma.apiKey.create({
      data: { userId: user.id, name, keyHash, keyPrefix, scopes: ["aeo:read"] },
    });

    return { success: true, key: rawKey, id: record.id, prefix: keyPrefix };
  } catch (err: unknown) {
    logger.error("[ApiKey] createApiKey failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to create API key." };
  }
}

export async function listApiKeys(): Promise<ListApiKeysResult> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const keys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, keys };
  } catch (err: unknown) {
    logger.error("[ApiKey] listApiKeys failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to list API keys." };
  }
}

export async function revokeApiKey(id: string): Promise<RevokeApiKeyResult> {
  if (!uuidSchema.safeParse(id).success && id.length < 10) return { success: false, error: "Invalid key ID." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: "Unauthorized" };

    await prisma.apiKey.deleteMany({ where: { id, userId: user.id } });
    return { success: true };
  } catch (err: unknown) {
    logger.error("[ApiKey] revokeApiKey failed", { error: (err as Error)?.message });
    return { success: false, error: "Failed to revoke key." };
  }
}
