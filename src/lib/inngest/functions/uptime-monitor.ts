/**
 * 8.3: Uptime Monitoring
 * Inngest cron: every 5 minutes, orchestrator fans out one event per site.
 * Each site is checked in an isolated child job with its own retry budget.
 * On failure, sends a Resend email alert (max 1 alert/hour per site).
 */
import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { CONCURRENCY } from "../concurrency";
import { isSafeUrl } from "@/lib/security/safe-url";

const UPTIME_TIMEOUT_MS = 10_000;

// Singleton — instantiate once at module level, not per-failing-site
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// ── Orchestrator: runs every 5 min, fans out one event per site ───────────────
export const uptimeMonitorJob = inngest.createFunction(
    {
        id: "uptime-monitor",
        name: "Uptime Monitor Orchestrator (every 5 min)",
        concurrency: { limit: 1 }, // only one orchestrator run at a time
    
        triggers: [{ cron: "*/5 * * * *" }],
    },
    async ({ step }) => {
        const sites = await step.run("fetch-monitored-sites", async () => {
            return prisma.site.findMany({
                where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
                select: { id: true, domain: true },
            });
        });

        if (sites.length === 0) return { sites: 0 };

        // Fan out — each site gets its own isolated job with retries
        await step.sendEvent(
            "fan-out-uptime-checks",
            sites.map((site) => ({
                name: "uptime/check.site" as const,
                data: { siteId: site.id, domain: site.domain },
            }))
        );

        return { sites: sites.length };
    },
);

// ── Child: one per site, fully isolated ──────────────────────────────────────
export const uptimeSiteCheckerJob = inngest.createFunction(
    {
        id: "uptime-check-site",
        name: "Uptime Check Site",
        retries: 1,
        concurrency: { limit: CONCURRENCY.uptimeMonitor },
    
        triggers: [{ event: "uptime/check.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain } = event.data as { siteId: string; domain: string };

        const url = domain.startsWith("http") ? domain : `https://${domain}`;

        // Fetch the user email inside the step (not from orchestrator — avoids stale data)
        const siteRecord = await step.run("fetch-site-user", () =>
            prisma.site.findUnique({
                where: { id: siteId },
                select: { user: { select: { email: true, name: true } } },
            })
        );

        const { statusCode, durationMs, isDown } = await step.run("check-url", async () => {
            const timeout = AbortSignal.timeout(UPTIME_TIMEOUT_MS);

            for (const method of ["HEAD", "GET"] as const) {
                try {
                    const start = Date.now();
                    const res = await fetch(url, {
                        method,
                        signal: timeout,
                        redirect: "follow",
                    });
                    const guard = isSafeUrl(res.url);
                    if (!guard.ok) {
                        logger.warn(`[Uptime] Redirect to private host blocked for ${url}`);
                        return { statusCode: null, durationMs: null, isDown: true };
                    }
                    const elapsed = Date.now() - start;
                    if (method === "HEAD" && res.status === 405) continue;
                    return {
                        statusCode: res.status,
                        durationMs: elapsed,
                        isDown: res.status >= 500 || res.status === 0,
                    };
                } catch {
                    if (method === "GET") return { statusCode: null, durationMs: null, isDown: true };
                }
            }
            return { statusCode: null, durationMs: null, isDown: true };
        });

        if (isDown) {
            await step.run("record-and-alert", async () => {
                const recentAlert = await prisma.uptimeAlert.findFirst({
                    where: {
                        siteId,
                        alertSent: true,
                        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
                    },
                });
                if (recentAlert) return;

                await prisma.uptimeAlert.create({
                    data: { siteId, status: statusCode, durationMs, alertSent: true },
                });

                const fromDomain = process.env.RESEND_FROM_DOMAIN;
                const userEmail = siteRecord?.user?.email;

                if (resend && fromDomain && userEmail) {
                    try {
                        await resend.emails.send({
                            from: `OptiAISEO <noreply@${fromDomain}>`,
                            to: userEmail,
                            subject: `Site down alert: ${domain}`,
                            html: `
                            <p>Hi ${siteRecord?.user?.name ?? "there"},</p>
                            <p>OptiAISEO detected that <strong>${domain}</strong> returned an error or timed out.</p>
                            <p>Status: <strong>${statusCode ?? "Timeout"}</strong></p>
                            <p><a href="https://optiaiseo.online/dashboard">View your dashboard &rarr;</a></p>
                            <p style="color:#6b7280;font-size:12px">You'll receive at most one alert per hour per site to avoid inbox flooding.</p>
                            <p style="color:#9ca3af;font-size:11px;margin-top:16px;">OptiAISEO Ltd &middot; 20-22 Wenlock Road &middot; London &middot; N1 7GU &middot; UK</p>
                            `.trim(),
                        });
                        logger.warn(`[Uptime] Site down: ${domain}`, { statusCode, durationMs });
                    } catch (e) {
                        logger.error("[Uptime] Email send failed", { error: (e as Error).message });
                    }
                }
            });
            return { siteId, isDown: true, statusCode };
        }

        await step.run("check-recovery", async () => {
            const lastAlert = await prisma.uptimeAlert.findFirst({
                where: { siteId, alertSent: true, resolvedAt: null },
                orderBy: { createdAt: "desc" },
            });
            if (!lastAlert) return;

            await prisma.uptimeAlert.update({
                where: { id: lastAlert.id },
                data: { resolvedAt: new Date() },
            });

            const userEmail = siteRecord?.user?.email;
            const fromDomain = process.env.RESEND_FROM_DOMAIN;
            if (resend && fromDomain && userEmail) {
                const downtimeMin = Math.round((Date.now() - lastAlert.createdAt.getTime()) / 60000);
                await resend.emails.send({
                    from: `OptiAISEO <noreply@${fromDomain}>`,
                    to: userEmail,
                    subject: `✅ Site recovered: ${domain}`,
                    html: `<p>${domain} is back online. Estimated downtime: ${downtimeMin} minutes.</p>`,
                });
            }
        });

        return { siteId, isDown: false };
    },
);

