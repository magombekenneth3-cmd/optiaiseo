import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const databaseUrl = process.env.DATABASE_URL || "postgresql://dummy:dummy@localhost:5432/dummy";

const poolSize = process.env.DATABASE_POOL_SIZE
    ? parseInt(process.env.DATABASE_POOL_SIZE, 10)
    : process.env.NODE_ENV === "production"
        ? 20
        : 5;

let urlWithPool = databaseUrl;
if (!databaseUrl.includes("connection_limit")) {
    const separator = databaseUrl.includes("?") ? "&" : "?";
    urlWithPool = `${databaseUrl}${separator}connection_limit=${poolSize}&pool_timeout=20`;
}

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
        datasources: {
            db: { url: urlWithPool },
        },
    });

// #14: Slow query logging — warn on any query taking >500ms
// Runs only once at module init (globalForPrisma.prisma guard prevents re-registration)
if (!globalForPrisma.prisma && process.env.NODE_ENV !== "test") {
    // @ts-expect-error — $on is available at runtime but not typed in all Prisma versions
    prisma.$on("query", (e: { query: string; duration: number }) => {
        if (e.duration >= 500) {
            logger.warn("[Prisma/SlowQuery]", {
                query: e.query.substring(0, 200),
                durationMs: e.duration,
            });
        }
    });
}

globalForPrisma.prisma = prisma;

// Default export removed — use named import: import { prisma } from "@/lib/prisma"