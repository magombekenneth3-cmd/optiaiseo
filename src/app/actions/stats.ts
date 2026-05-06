"use server";

import prisma from "@/lib/prisma";
import { unstable_cache } from "next/cache";
import { logger } from "@/lib/logger";

export const getPublicStats = unstable_cache(
  async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [siteCount, weeklySignups, auditCount, blogCount] = await Promise.all([
      prisma.site.count().catch((err) => {
        logger.error("Failed to count sites", { error: (err as Error)?.message });
        return 0;
      }),
      prisma.user.count({
        where: { createdAt: { gte: sevenDaysAgo } },
      }).catch((err) => {
        logger.error("Failed to count weekly signups", { error: (err as Error)?.message });
        return 0;
      }),
      prisma.audit.count().catch(() => 0),
      prisma.blog.count({ where: { status: "PUBLISHED" } }).catch(() => 0),
    ]);

    return { siteCount, weeklySignups, auditCount, blogCount };
  },
  ["public-stats", process.env.NODE_ENV ?? "development"],
  { revalidate: 3600, tags: ["public-stats"] }
);