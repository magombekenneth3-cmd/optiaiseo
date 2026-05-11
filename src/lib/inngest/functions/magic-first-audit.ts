/**
 * Magic First Audit — Inngest Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Triggered when a new user registers (event: "user.registered").
 *
 * What it does in under 60s:
 *  1. Waits up to 10 minutes for the user to add a site (event: "site.created")
 *     If they haven't added a site themselves yet, the job ends — no spam.
 *  2. Runs a fast 5-point AEO health check on that site
 *  3. Sends a personalised activation email: "Here are X issues we found on
 *     <domain> — here's your first fix"
 *  4. Emits "audit.run" to queue the full weekly audit for the new site
 *  5. Tracks an AeoEvent for activation analytics
 *
 * Design decisions:
 *  - Uses step.waitForEvent so the job doesn't block a thread while waiting
 *  - Health check is lightweight (title, meta, HTTPS, speed proxy, AEO score)
 *    — same check as /api/free-seo-check to avoid extra LLM costs
 *  - Email is sent via Resend directly (matches existing email infra)
 *  - If the health check fails, we still send a welcome email without scores
 *    so the user always gets activation contact
 */

import { inngest } from "../client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { signUnsubToken } from "@/lib/unsub-token";
import { CONCURRENCY } from "../concurrency";
import { getAuditEngine } from "@/lib/seo-audit";

// Lazy getter — never constructed at module load time (safe for next build)
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("[MagicFirstAudit] RESEND_API_KEY is not set");
  return new Resend(key);
}



export const magicFirstAuditJob = inngest.createFunction(
  {
    id: "magic-first-audit",
    name: "Magic First Audit — New User Activation",
    retries: 2,
    concurrency: { limit: CONCURRENCY.magicFirstAudit, key: "global-magic-first-audit" },
    timeouts: { finish: "15m" },
  
      triggers: [{ event: "user.registered" }],
  },
  async ({ event, step }) => {
    const { userId, email, name } = event.data as {
      userId: string;
      email: string;
      name?: string;
    };

    const siteEvent = await step.waitForEvent("wait-for-first-site", {
      event: "site.created",
      match: "data.userId",
      timeout: "10m",
    });

    if (!siteEvent) {
      // User registered but never added a site — send a lighter nudge email instead
      logger.info("[MagicFirstAudit] No site added within 10 min — sending nudge", { userId });

      await step.run("send-nudge-email", async () => {
        await getResend().emails.send({
          from: "OptiAISEO <support@optiaiseo.online>",
          to: email,
          subject: "Your AI SEO dashboard is ready — add your site to get started",
          html: buildNudgeEmail(name ?? email.split("@")[0], userId),
        });
      });

      return { activated: false, reason: "no_site_added" };
    }

    const { siteId, domain } = siteEvent.data as { siteId: string; domain: string };

    const auditResult = await step.run("run-health-check", async () => {
      try {
        const url = domain.startsWith("http") ? domain : `https://${domain}`;
        const engine = getAuditEngine("free");
        return await engine.runAudit(url);
      } catch (err) {
        logger.warn("[MagicFirstAudit] Health check failed", { domain, error: (err as Error)?.message });
        return null;
      }
    });

    const issues: { label: string; fix: string }[] = [];
    if (auditResult) {
      for (const cat of auditResult.categories) {
        for (const item of cat.items) {
          if ((item.status === "Fail" || item.status === "Warning") && item.recommendation) {
            issues.push({ label: item.label ?? item.id, fix: item.recommendation.text });
          }
        }
      }
    }

    const aeoScore = auditResult?.aeoScore ?? auditResult?.overallScore ?? 0;

    await step.run("send-activation-email", async () => {
      const html = auditResult
        ? buildActivationEmail({
          name: name ?? email.split("@")[0],
          domain,
          siteId,
          userId,
          issues: issues.slice(0, 3),
          aeoScore,
          lowestKey: auditResult.recommendations[0]?.itemId ?? "",
        })
        : buildFallbackEmail({
          name: name ?? email.split("@")[0],
          domain,
          siteId,
          userId,
        });

      await getResend().emails.send({
        from: "OptiAISEO <support@optiaiseo.online>",
        to: email,
        subject: auditResult
          ? `We scanned ${domain} — ${issues.length} issue${issues.length === 1 ? "" : "s"} found`
          : `Welcome to AISEO — your site is queued for analysis`,
        html,
      });
    });

    await step.sendEvent("trigger-full-audit", {
      name: "audit.run",
      data: { siteId },
    });

    await step.run("track-activation-event", async () => {
      await prisma.aeoEvent.create({
        data: {
          siteId,
          eventType: "magic_first_audit",
          intent: "onboarding",
          metadata: {
            issueCount: issues.length,
            aeoScore,
            lowestKey: auditResult?.recommendations[0]?.itemId ?? null,
          },
        },
      });
    });

    logger.info("[MagicFirstAudit] Complete", { userId, domain, issueCount: issues.length });
    return { activated: true, domain, issueCount: issues.length };
  }
);


function buildActivationEmail(params: {
  name: string;
  domain: string;
  siteId: string;
  userId: string;
  issues: { label: string; fix: string }[];
  aeoScore: number;
  lowestKey: string;
}): string {
  const { name, domain, siteId, userId, issues, aeoScore } = params;
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
  const auditUrl = `${baseUrl}/dashboard/audits?siteId=${siteId}`;
  const ariaUrl = `${baseUrl}/aria?siteId=${siteId}`;

  const issueRows = issues.slice(0, 3).map((i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #1f2937;">
        <strong style="color:#f87171;display:block;margin-bottom:4px;">⚠ ${i.label}</strong>
        <span style="color:#9ca3af;font-size:14px;">${i.fix}</span>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d1117;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;">
    <tr><td style="padding:0 24px;">

      <!-- Header -->
      <div style="margin-bottom:32px;">
        <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:4px;">AISEO</div>
        <div style="width:40px;height:3px;background:linear-gradient(90deg,#10b981,#3b82f6);border-radius:2px;"></div>
      </div>

      <h1 style="font-size:24px;font-weight:700;color:#fff;margin:0 0 8px;">
        Hi ${name}, we scanned ${domain}
      </h1>
      <p style="color:#6b7280;font-size:15px;margin:0 0 28px;line-height:1.6;">
        Your AI Visibility Score is <strong style="color:${aeoScore >= 75 ? "#10b981" : aeoScore >= 50 ? "#f59e0b" : "#ef4444"}">${aeoScore}/100</strong>.
        ${issues.length === 0
      ? "You're looking good! Run the full audit to see detailed recommendations."
      : `We found ${issues.length} issue${issues.length === 1 ? "" : "s"} to fix.`}
      </p>

      ${issues.length > 0 ? `
      <!-- Issues table -->
      <div style="background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin-bottom:28px;">
        <div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:16px;">
          Top Issues
        </div>
        <table width="100%" cellpadding="0" cellspacing="0">${issueRows}</table>
      </div>` : ""}

      <!-- CTAs -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
        <tr>
          <td style="padding-right:8px;">
            <a href="${ariaUrl}" style="display:block;text-align:center;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 20px;border-radius:10px;">
              Ask Aria to fix it →
            </a>
          </td>
          <td style="padding-left:8px;">
            <a href="${auditUrl}" style="display:block;text-align:center;background:#161b22;color:#e5e7eb;font-weight:600;font-size:15px;text-decoration:none;padding:14px 20px;border-radius:10px;border:1px solid #21262d;">
              View Full Audit
            </a>
          </td>
        </tr>
      </table>

      <p style="color:#4b5563;font-size:13px;text-align:center;">
        © AISEO &middot;
        <a href="${baseUrl}/api/unsubscribe?token=${signUnsubToken(userId)}" style="color:#4b5563;">Unsubscribe</a>
      </p>
      <p style="color:#374151;font-size:11px;text-align:center;margin-top:4px;">OptiAISEO Ltd &middot; 20-22 Wenlock Road &middot; London &middot; N1 7GU &middot; UK</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildFallbackEmail(params: { name: string; domain: string; siteId: string; userId: string }): string {
  const { name, domain, siteId, userId } = params;
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
  const auditUrl = `${baseUrl}/dashboard/audits?siteId=${siteId}`;

  return `<!DOCTYPE html>
<html>
<body style="background:#0d1117;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">
  <table width="100%" style="max-width:600px;margin:40px auto;">
    <tr><td style="padding:0 24px;">
      <h1 style="font-size:24px;font-weight:700;color:#fff;">Hi ${name}, ${domain} is in the queue</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;">
        We're running your full AEO + SEO audit now. You'll see detailed results in your dashboard within the next few minutes.
      </p>
      <a href="${auditUrl}" style="display:inline-block;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:10px;margin-top:16px;">
        View Your Dashboard →
      </a>
      <p style="color:#4b5563;font-size:12px;margin-top:24px;">
        <a href="${baseUrl}/api/unsubscribe?token=${signUnsubToken(userId)}" style="color:#4b5563;text-decoration:underline;">Unsubscribe</a>
      </p>
      <p style="color:#374151;font-size:11px;margin-top:4px;">OptiAISEO Ltd &middot; 20-22 Wenlock Road &middot; London &middot; N1 7GU &middot; UK</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildNudgeEmail(name: string, userId: string): string {
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://optiaiseo.online";
  return `<!DOCTYPE html>
<html>
<body style="background:#0d1117;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;">
  <table width="100%" style="max-width:600px;margin:40px auto;">
    <tr><td style="padding:0 24px;">
      <h1 style="font-size:22px;font-weight:700;color:#fff;">Hi ${name}, your dashboard is ready</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;">
        Add your website to get an instant AI visibility score, keyword gaps, and a personalised fix plan — it takes under 60 seconds.
      </p>
      <a href="${baseUrl}/dashboard/sites/new" style="display:inline-block;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:10px;margin-top:16px;">
        Add Your Site →
      </a>
      <p style="color:#4b5563;font-size:12px;margin-top:24px;">
        <a href="${baseUrl}/api/unsubscribe?token=${signUnsubToken(userId)}" style="color:#4b5563;text-decoration:underline;">Unsubscribe</a>
      </p>
      <p style="color:#374151;font-size:11px;margin-top:4px;">OptiAISEO Ltd &middot; 20-22 Wenlock Road &middot; London &middot; N1 7GU &middot; UK</p>
    </td></tr>
  </table>
</body>
</html>`;
}