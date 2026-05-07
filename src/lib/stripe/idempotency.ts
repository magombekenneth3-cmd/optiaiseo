import crypto from "crypto"
import { logger } from "@/lib/logger"
import { prisma } from "@/lib/prisma"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library"

function hashRequest(data: object): string {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex")
}

export type IdempotentResult<T> = {
    status: number
    body: T
    cached: boolean
}

export async function executeIdempotently<T>(opts: {
    idempotencyKey: string
    userId: string
    requestPath: string
    requestBody: object
    handler: () => Promise<{ status: number; body: T }>
}): Promise<IdempotentResult<T>> {
    const { idempotencyKey, userId, requestPath, requestBody, handler } = opts
    const checksum = hashRequest(requestBody)

    try {
        await prisma.idempotencyKey.create({
            data: {
                idempotencyKey,
                userId,
                requestPath,
                requestChecksum: checksum,
                status: "PROCESSING",
            },
        })
    } catch (e: unknown) {
        if (!(e instanceof PrismaClientKnownRequestError) || e.code !== "P2002") {
            throw e
        }

        const existing = await prisma.idempotencyKey.findUnique({
            where: { idempotencyKey_userId: { idempotencyKey, userId } },
        })

        if (!existing) {
            throw new Error("Race condition on idempotency record")
        }

        if (existing.requestChecksum !== checksum) {
            throw new Error(
                `Idempotency key "${idempotencyKey}" reused with different parameters`
            )
        }

        if (existing.status === "PROCESSING") {
            throw new Error("Request is already being processed. Retry in a few seconds.")
        }

        return {
            status: existing.responseCode!,
            body: existing.responseBody as T,
            cached: true,
        }
    }

    try {
        const result = await handler()

        await prisma.idempotencyKey.update({
            where: { idempotencyKey_userId: { idempotencyKey, userId } },
            data: {
                status: result.status < 400 ? "SUCCEEDED" : "FAILED",
                responseCode: result.status,
                responseBody: result.body as object,
                completedAt: new Date(),
            },
        })

        return { ...result, cached: false }
    } catch (err: unknown) {
        await prisma.idempotencyKey
            .update({
                where: { idempotencyKey_userId: { idempotencyKey, userId } },
                data: { status: "FAILED", completedAt: new Date() },
            })
            .catch((e: unknown) =>
                logger.error("[Idempotency] Failed to mark key as FAILED", {
                    error: e instanceof Error ? e.message : String(e),
                })
            )

        throw err
    }
}

export async function cleanupExpiredIdempotencyKeys(): Promise<void> {
    const result = await prisma.idempotencyKey.deleteMany({
        where: {
            expiresAt: { lt: new Date() },
            status: { in: ["SUCCEEDED", "FAILED"] },
        },
    })

    logger.debug("[Idempotency] Expired keys removed", { count: result.count })
}