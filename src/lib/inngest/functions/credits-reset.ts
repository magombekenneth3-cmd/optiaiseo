/**
 * 6.1: Monthly credits reset cron.
 * Runs on the 1st of every month at 00:00 UTC.
 * Resets each user's credit balance to their tier allowance.
 */
import { inngest } from "../client";
import { resetMonthlyCredits } from "@/lib/credits";
import { logger } from "@/lib/logger";

export const creditsResetJob = inngest.createFunction(
    {
        id: "credits-monthly-reset",
        name: "Monthly Credits Reset",
        retries: 1,
        concurrency: { limit: 1 }, // cron — must never run concurrently
    
        triggers: [{ cron: "0 0 1 * *" }],
    },
    // 1st of every month, midnight UTC
    async () => {
        await resetMonthlyCredits();
        logger.info("[Credits] Monthly reset job complete");
        return { success: true };
    },
);