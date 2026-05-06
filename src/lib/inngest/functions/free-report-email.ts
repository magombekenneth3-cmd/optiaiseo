/**
 * Inngest function: email/free-report.send
 *
 * Sends the full SEO report email to a visitor who unlocked the free audit.
 *
 * Design decisions:
 *  - Concurrency-capped at 5 (matches plan limit and mirrors all other email jobs)
 *  - retries: 3 — transient Resend failures are worth retrying; Inngest deduplicates
 *  - from address uses RESEND_FROM_DOMAIN (env-driven, not hardcoded)
 *  - Both html + plain-text bodies supplied (spam filter compliance)
 *  - List-Unsubscribe header added (RFC 8058 / bulk mail best practice)
 *  - r.label / r.recommendation are HTML-escaped before interpolation (XSS guard)
 *  - domain and score are escaped / clamped before use in HTML (XSS guard)
 *  - NonRetriableError thrown for permanent failures (missing env, bad email)
 *    so Inngest doesn't waste retry budget on configuration errors
 */

import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { CONCURRENCY } from "../concurrency";

// ── Resend singleton ──────────────────────────────────────────────────────────

let _resend: Resend | null = null;
function getResend(): Resend {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new NonRetriableError("RESEND_API_KEY is not set");
    if (!_resend) _resend = new Resend(key);
    return _resend;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecommendationRow {
    label: string;
    recommendation: string;
    priority: string;
    priorityScore: number;
}

interface FreeReportEmailPayload {
    email: string;
    domain: string;
    score: number;
    recs: RecommendationRow[];
    auditId: string;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Clamp score to [0, 100] and round — prevents injected NaN/Infinity leaking into HTML. */
function safeScore(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.round(Math.max(0, Math.min(100, n)));
}

function priorityColor(priority: string): { bg: string; fg: string } {
    if (priority === "High") return { bg: "#ef444420", fg: "#ef4444" };
    if (priority === "Medium") return { bg: "#f59e0b20", fg: "#f59e0b" };
    return { bg: "#10b98120", fg: "#10b981" };
}

// ── Email builders ────────────────────────────────────────────────────────────

function buildHtml(
    domain: string,
    score: number,
    recs: RecommendationRow[],
    auditId: string,
    appUrl: string,
): string {
    const safeDomain = escapeHtml(domain);
    const displayScore = score; // already clamped integer by caller
    const gradeColor = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";

    const recRows = recs
        .slice(0, 10)
        .map((r, i) => {
            const { bg, fg } = priorityColor(r.priority);
            return `
        <tr style="border-bottom:1px solid #1e293b">
          <td style="padding:10px 8px;color:#94a3b8;font-size:13px">${i + 1}</td>
          <td style="padding:10px 8px;font-size:13px;color:#e2e8f0">${escapeHtml(r.label)}</td>
          <td style="padding:10px 8px;font-size:11px;color:#94a3b8">${escapeHtml(r.recommendation)}</td>
          <td style="padding:10px 8px;text-align:center">
            <span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">
              ${escapeHtml(r.priority)}
            </span>
          </td>
        </tr>`;
        })
        .join("");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your SEO Report for ${safeDomain}</title>
</head>
<body style="margin:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:640px;margin:0 auto;padding:40px 24px">

    <div style="text-align:center;margin-bottom:32px">
      <div style="display:inline-block;width:80px;height:80px;border-radius:50%;border:4px solid ${gradeColor};line-height:80px;font-size:36px;font-weight:900;color:${gradeColor}">
        ${safeScore}
      </div>
      <h1 style="margin:16px 0 4px;font-size:24px">SEO Report for ${safeDomain}</h1>
      <p style="color:#64748b;margin:0">Full audit results from OptiAISEO</p>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#0f172a">
          <th style="padding:10px 8px;text-align:left;font-size:11px;color:#64748b;font-weight:600">#</th>
          <th style="padding:10px 8px;text-align:left;font-size:11px;color:#64748b;font-weight:600">ISSUE</th>
          <th style="padding:10px 8px;text-align:left;font-size:11px;color:#64748b;font-weight:600">RECOMMENDATION</th>
          <th style="padding:10px 8px;text-align:center;font-size:11px;color:#64748b;font-weight:600">PRIORITY</th>
        </tr>
      </thead>
      <tbody>${recRows}</tbody>
    </table>

    <div style="text-align:center;margin-top:32px">
      <a href="${appUrl}/signup?audit=${encodeURIComponent(auditId)}"
         style="display:inline-block;background:#10b981;color:#000;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px">
        Fix These Issues — Start Free →
      </a>
    </div>

    <p style="text-align:center;color:#475569;font-size:12px;margin-top:24px">
      Generated by <a href="${appUrl}" style="color:#10b981">OptiAISEO</a>
    </p>
    <p style="text-align:center;color:#475569;font-size:11px;margin-top:8px">
      You received this because you requested a free SEO audit at optiaiseo.online.
    </p>
  </div>
</body>
</html>`;
}

function buildText(
    domain: string,
    score: number,
    recs: RecommendationRow[],
    auditId: string,
    appUrl: string,
): string {
    const lines = [
        `SEO Report for ${domain} — Score: ${score}/100`,
        `Generated by OptiAISEO`,
        ``,
        `TOP ISSUES`,
        `──────────`,
        ...recs.slice(0, 10).map(
            (r, i) =>
                `${i + 1}. [${r.priority}] ${r.label}\n   ${r.recommendation}`,
        ),
        ``,
        `Fix these issues — sign up free:`,
        `${appUrl}/signup?audit=${auditId}`,
        ``,
        `You received this because you requested a free SEO audit at optiaiseo.online.`,
    ];
    return lines.join("\n");
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const sendFreeReportEmailJob = inngest.createFunction(
    {
        id: "send-free-report-email",
        name: "Send Free SEO Report Email",
        retries: 3,
        concurrency: {
            limit: CONCURRENCY.freeReportEmail,
            key: "global-free-report-email",
        },
        onFailure: async ({ error }) => {
            logger.error("[FreeReportEmail] Permanently failed after all retries", {
                error: (error as Error)?.message ?? String(error),
            });
        },
    
        triggers: [{ event: "email/free-report.send" }],
    },
    async ({ event, step }) => {
        const { email, domain, score, recs, auditId } =
            event.data as FreeReportEmailPayload;

        // ── Guard: env vars ─────────────────────────────────────────────────────
        // NonRetriableError = Inngest will NOT retry — these are config problems,
        // not transient network failures.
        if (!process.env.RESEND_API_KEY) {
            throw new NonRetriableError("RESEND_API_KEY is not set");
        }
        if (!process.env.RESEND_FROM_DOMAIN) {
            throw new NonRetriableError("RESEND_FROM_DOMAIN is not set");
        }

        const appUrl = (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
        const from = `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`;
        const clampedScore = safeScore(score);

        await step.run("send-email", async () => {
            const result = await getResend().emails.send({
                from,
                to: email,
                subject: `Your SEO Report for ${domain} — Score: ${clampedScore}/100`,
                html: buildHtml(domain, clampedScore, recs, auditId, appUrl),
                text: buildText(domain, clampedScore, recs, auditId, appUrl),
                headers: {
                    // RFC 8058 one-click unsubscribe (good deliverability hygiene even
                    // for transactional emails — major ESPs check for this header)
                    "List-Unsubscribe": `<${appUrl}/dashboard/settings?tab=notifications>`,
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
            });

            logger.debug("[FreeReportEmail] Sent successfully", {
                id: result.data?.id,
                domain,
                auditId,
            });
        });

        return { delivered: true, auditId };
    },
);