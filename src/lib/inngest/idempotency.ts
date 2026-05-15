import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function checkInngestIdempotency(
    functionId: string,
    siteId: string,
    userId: string
): Promise<boolean> {
    const key = `${functionId}:${siteId}:${new Date().toISOString().slice(0, 10)}`;
    try {
        const existing = await prisma.idempotencyKey.findFirst({
            where: { idempotencyKey: key, userId },
        });
        if (existing) {
            logger.info(`[Idempotency] Skipping duplicate: ${key}`);
            return false;
        }
        await prisma.idempotencyKey.create({
            data: {
                idempotencyKey: key,
                userId,
                requestChecksum: key,
                status: "PROCESSING",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
        });
        return true;
    } catch (e: unknown) {
        if ((e as { code?: string })?.code === "P2002") {
            logger.info(`[Idempotency] Race-condition duplicate caught: ${key}`);
            return false;
        }
        logger.warn("[Idempotency] Check failed, allowing execution", {
            error: (e as Error)?.message,
        });
        return true;
    }
}
