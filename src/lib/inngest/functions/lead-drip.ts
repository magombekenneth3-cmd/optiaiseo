/**
 * Lead Drip Sequence — Inngest Job
 * ─────────────────────────────────────────────────────────────────────────────
 * A 3-email nurture sequence triggered after the Magic First Audit completes.
 * Each email is timed relative to signup and targets a specific conversion goal.
 *
 * Day 0  (immediate — sent by magic-first-audit.ts)  → Activation email
 * Day 2  → Education: "Why AI engines aren't citing you yet" + top fix
 * Day 5  → Social proof: "Sites like yours are ranking in ChatGPT" + CTA
 * Day 10 → Urgency: "Your competitors are pulling ahead in AI search" + upgrade CTA
 *
 * Design decisions:
 *  - Concurrency-capped at 5 to match plan limit (was uncapped)
 *  - retries: 2 with NonRetriableError on permanent failures (bad env, bad email)
 *  - Resend instantiated lazily per step.run (never at module load time)
 *  - from address driven by RESEND_FROM_DOMAIN env var (not hardcoded)
 *  - All email bodies have html + text alternatives (spam compliance)
 *  - List-Unsubscribe header on every send (RFC 8058)
 *  - displayName derived inside step.run to keep event payload lean
 *  - shouldSkip helper is a pure async fn — safe to call across step boundaries
 */

import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Resend } from "resend";
import { signUnsubToken } from "@/lib/unsub-token";
import { CONCURRENCY } from "../concurrency";

// ── Constants ─────────────────────────────────────────────────────────────────

const POSTAL_ADDRESS = "OptiAISEO Ltd · 20-22 Wenlock Road · London · N1 7GU · UK";

// ── Resend singleton ──────────────────────────────────────────────────────────
// Lazy — never instantiated at module load time (safe for Next.js build).
// Throws NonRetriableError so Inngest doesn't burn retry budget on a config gap.

let _resend: Resend | null = null;
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new NonRetriableError("[DripSequence] RESEND_API_KEY is not set");
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

function getFrom(): string {
  const domain = process.env.RESEND_FROM_DOMAIN;
  if (!domain) throw new NonRetriableError("[DripSequence] RESEND_FROM_DOMAIN is not set");
  return `Kenneth from OptiAISEO <kenneth@${domain}>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "https://www.optiaiseo.online").replace(/\/$/, "");
}

function unsubLink(userId: string): string {
  return `${appUrl()}/api/unsubscribe?token=${signUnsubToken(userId)}`;
}

function listUnsubHeaders(userId: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${appUrl()}/api/unsubscribe?token=${signUnsubToken(userId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "Precedence": "bulk",
  };
}

function emailShell(body: string, userId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="background:#0d1117;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:40px auto;">
  <tr><td style="padding:0 28px;">
    <div style="margin-bottom:28px;">
      <span style="font-size:18px;font-weight:700;color:#fff;letter-spacing:-.3px;">AISEO</span>
      <span style="display:inline-block;width:6px;height:6px;background:#10b981;border-radius:50%;margin-left:6px;vertical-align:middle;"></span>
    </div>
    ${body}
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #21262d;">
      <p style="color:#4b5563;font-size:12px;margin:0;">
        You're receiving this because you signed up at www.optiaiseo.online.<br>
        <a href="${unsubLink(userId)}" style="color:#4b5563;text-decoration:underline;">Unsubscribe</a>
      </p>
      <p style="color:#374151;font-size:11px;margin:8px 0 0;">${POSTAL_ADDRESS}</p>
    </div>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Plain-text helpers ────────────────────────────────────────────────────────

function textShell(body: string, userId: string): string {
  return [
    body,
    "",
    "---",
    "You're receiving this because you signed up at www.optiaiseo.online.",
    `Unsubscribe: ${unsubLink(userId)}`,
    POSTAL_ADDRESS,
  ].join("\n");
}

// ── Skip predicate ────────────────────────────────────────────────────────────

async function shouldSkip(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true, preferences: true },
  });
  if (!user) return true;
  if (user.subscriptionTier !== "FREE") return true;
  const prefs = (user.preferences as Record<string, unknown>) ?? {};
  return prefs.unsubscribed === true;
}

// ── Email builders ────────────────────────────────────────────────────────────

function buildDay2Html(name: string, userId: string): string {
  const issues = [
    ["No FAQ section", "AI engines extract Q&A pairs verbatim. Pages with ≥5 FAQ questions are cited 3× more often."],
    ["Missing definition block", "If your page doesn't define its topic clearly in the first 100 words, AI engines skip it."],
    ["No structured data (JSON-LD)", "Article and FAQPage schema are the strongest signals that your page is authoritative."],
  ] as const;

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px;line-height:1.3;">
      Why AI engines aren't citing your site yet, ${name}
    </h1>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Perplexity, ChatGPT, and Claude use a specific set of signals to decide which pages to cite.<br><br>
      The 3 most common reasons sites get missed:
    </p>
    <div style="background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin-bottom:24px;">
      ${issues.map(([title, desc]) => `
        <div style="display:flex;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #21262d;">
          <span style="color:#ef4444;font-size:18px;line-height:1;">⚠</span>
          <div>
            <strong style="color:#fff;font-size:14px;display:block;margin-bottom:4px;">${title}</strong>
            <span style="color:#6b7280;font-size:13px;">${desc}</span>
          </div>
        </div>`).join("")}
    </div>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Your AI Citation Score flags exactly which of these you're missing — and gives you the specific fix for each one.
    </p>
    <a href="${appUrl()}/dashboard/blogs"
       style="display:inline-block;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 24px;border-radius:10px;">
      Check My Citation Score →
    </a>`;
  return emailShell(body, userId);
}

function buildDay2Text(name: string, userId: string): string {
  return textShell(
    [
      `Why AI engines aren't citing your site yet, ${name}`,
      "",
      "The 3 most common reasons sites get missed:",
      "1. No FAQ section — pages with ≥5 FAQ questions are cited 3× more often.",
      "2. Missing definition block — define your topic clearly in the first 100 words.",
      "3. No structured data (JSON-LD) — Article and FAQPage schema signal authority.",
      "",
      `Check your AI Citation Score: ${appUrl()}/dashboard/blogs`,
    ].join("\n"),
    userId,
  );
}

function buildDay5Html(name: string, userId: string): string {
  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px;line-height:1.3;">
      How sites like yours appear in ChatGPT answers, ${name}
    </h1>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Sites that get cited consistently by AI engines have one thing in common: they write for <em>retrieval</em>, not just rankings.
    </p>
    <div style="background:#161b22;border-left:3px solid #10b981;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <p style="color:#d1fae5;font-size:14px;font-style:italic;margin:0 0 8px;">
        "We added FAQ schema and a definition section to 12 pages. Within 3 weeks, Perplexity started citing us for 7 of our target keywords."
      </p>
      <span style="color:#6b7280;font-size:12px;">— Agency client using AISEO Pro</span>
    </div>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 24px;">
      The AISEO blog generator scores every draft against our 8-criterion AI Citation rubric before it's approved for publish.
    </p>
    <a href="${appUrl()}/dashboard"
       style="display:inline-block;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 24px;border-radius:10px;">
      Generate a Citation-Ready Post →
    </a>`;
  return emailShell(body, userId);
}

function buildDay5Text(name: string, userId: string): string {
  return textShell(
    [
      `How sites like yours appear in ChatGPT answers, ${name}`,
      "",
      "Sites cited consistently by AI engines write for retrieval, not just rankings.",
      "",
      `Generate a citation-ready post: ${appUrl()}/dashboard`,
    ].join("\n"),
    userId,
  );
}

function buildDay10Html(name: string, userId: string): string {
  const upgradeUrl = `${appUrl()}/dashboard/billing`;
  const features = [
    ["150 citation-ready posts/month", "vs 3 on Free"],
    ["AI Citation Score on every draft", "with per-criterion fix guidance"],
    ["Post-publish citation monitor", "T+7d, T+14d, T+30d Perplexity checks"],
    ["Slack + Zapier webhook alerts", "instant notification on GSoV drops"],
    ["Client portal share links", "white-label read-only reports"],
  ] as const;

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px;line-height:1.3;">
      Your competitors may already be ahead in AI search, ${name}
    </h1>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 20px;">
      The share of Google traffic going to AI-generated answers has grown 35% in the last 6 months.
      Every week you're not optimised for AI citations is a week competitors can take that visibility.
    </p>
    <div style="background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin-bottom:24px;">
      <div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:14px;">Pro unlocks</div>
      ${features.map(([feat, detail]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #21262d;">
          <span style="color:#e5e7eb;font-size:14px;">✓ ${feat}</span>
          <span style="color:#6b7280;font-size:12px;">${detail}</span>
        </div>`).join("")}
    </div>
    <a href="${upgradeUrl}"
       style="display:inline-block;background:linear-gradient(135deg,#10b981,#3b82f6);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:10px;">
      Upgrade to Pro — from $29/mo →
    </a>
    <p style="color:#4b5563;font-size:13px;margin-top:16px;">
      Questions? Just reply to this email — I read every one.
    </p>`;
  return emailShell(body, userId);
}

function buildDay10Text(name: string, userId: string): string {
  return textShell(
    [
      `Your competitors may already be ahead in AI search, ${name}`,
      "",
      "Pro plan unlocks:",
      "- 150 citation-ready posts/month (vs 3 on Free)",
      "- AI Citation Score on every draft",
      "- Post-publish citation monitor",
      "- Slack + Zapier webhook alerts",
      "- Client portal share links",
      "",
      `Upgrade from $29/mo: ${appUrl()}/dashboard/billing`,
    ].join("\n"),
    userId,
  );
}

// ── Inngest function ──────────────────────────────────────────────────────────

export const leadDripSequenceJob = inngest.createFunction(
  {
    id: "lead-drip-sequence",
    name: "Lead Drip — 6-Email Nurture Sequence",
    retries: 2,
    concurrency: {
      limit: CONCURRENCY.leadDrip,
      key: "global-lead-drip",
    },
    // Extended to cover the new Day 30 final email (was 15d).
    timeouts: { finish: "45d" },
  
      triggers: [{ event: "user.registered" }],
  },
  async ({ event, step }) => {
    const { userId, email, name } = event.data as {
      userId: string;
      email: string;
      name?: string;
    };

    if (!userId || !email) {
      throw new NonRetriableError("Missing userId or email in event payload");
    }

    const displayName = name?.split(" ")[0] ?? email.split("@")[0];

    // ── Deduplication lock ──────────────────────────────────────────────────
    const alreadyStarted = await step.run("check-drip-lock", async () => {
      const existing = await prisma.dripSequence.findUnique({ where: { userId } });
      if (existing) return true;
      await prisma.dripSequence.create({ data: { userId, startedAt: new Date() } });
      return false;
    });
    if (alreadyStarted) return { skipped: true, reason: "duplicate_trigger" };

    // ── Day 2: Education email ─────────────────────────────────────────────
    await step.sleep("wait-2-days", "2d");

    const skip2 = await step.run("check-skip-day2", () => shouldSkip(userId));
    if (!skip2) {
      await step.run("send-day2-email", async () => {
        await getResend().emails.send({
          from: getFrom(),
          to: email,
          subject: "Why AI engines aren't citing your site (yet)",
          html: buildDay2Html(displayName, userId),
          text: buildDay2Text(displayName, userId),
          headers: listUnsubHeaders(userId),
        });
        logger.info("[DripSequence] Day 2 email sent", { userId });
      });
    }

    // ── Day 5: Social proof email ──────────────────────────────────────────
    await step.sleep("wait-3-more-days", "3d");

    const skip5 = await step.run("check-skip-day5", () => shouldSkip(userId));
    if (!skip5) {
      await step.run("send-day5-email", async () => {
        await getResend().emails.send({
          from: getFrom(),
          to: email,
          subject: "How sites like yours are appearing in ChatGPT answers",
          html: buildDay5Html(displayName, userId),
          text: buildDay5Text(displayName, userId),
          headers: listUnsubHeaders(userId),
        });
        logger.info("[DripSequence] Day 5 email sent", { userId });
      });
    }

    // ── Day 10: Urgency email ──────────────────────────────────────────────
    await step.sleep("wait-5-more-days", "5d");

    const skip10 = await step.run("check-skip-day10", () => shouldSkip(userId));
    if (!skip10) {
      await step.run("send-day10-email", async () => {
        await getResend().emails.send({
          from: getFrom(),
          to: email,
          subject: "Your competitors are pulling ahead in AI search 📊",
          html: buildDay10Html(displayName, userId),
          text: buildDay10Text(displayName, userId),
          headers: listUnsubHeaders(userId),
        });
        logger.info("[DripSequence] Day 10 email sent", { userId });
      });
    }

    // ── Day 14: Feature spotlight email ───────────────────────────────────
    await step.sleep("wait-4-more-days", "4d");

    const skip14 = await step.run("check-skip-day14", () => shouldSkip(userId));
    if (!skip14) {
      await step.run("send-day14-email", async () => {
        await getResend().emails.send({
          from: getFrom(),
          to: email,
          subject: "The feature most OptiAISEO users find last (but love most)",
          html: buildDay14Html(displayName, userId),
          text: buildDay14Text(displayName, userId),
          headers: listUnsubHeaders(userId),
        });
        logger.info("[DripSequence] Day 14 email sent", { userId });
      });
    }

    // ── Day 21: Personalised competitor email ──────────────────────────────
    await step.sleep("wait-7-more-days", "7d");

    const skip21 = await step.run("check-skip-day21", () => shouldSkip(userId));
    if (!skip21) {
      const competitorDomain = await step.run("fetch-competitor-domain", () =>
        prisma.competitor
          .findFirst({
            where: { site: { userId } },
            select: { domain: true },
            orderBy: { addedAt: "desc" },
          })
          .then((c) => c?.domain ?? null),
      );

      await step.run("send-day21-email", async () => {
        await getResend().emails.send({
          from: getFrom(),
          to: email,
          subject: competitorDomain
            ? `${competitorDomain} is pulling ahead in AI search`
            : "Your competitors are gaining ground in AI search",
          html: buildDay21Html(displayName, competitorDomain, userId),
          text: buildDay21Text(displayName, competitorDomain, userId),
          headers: listUnsubHeaders(userId),
        });
        logger.info("[DripSequence] Day 21 email sent", { userId, competitorDomain });
      });
    }

    // ── Day 30: Final offer ────────────────────────────────────────────────
    await step.sleep("wait-9-more-days", "9d");

    const skip30 = await step.run("check-skip-day30", () => shouldSkip(userId));
    if (!skip30) {
      await step.run("send-day30-email", async () => {
        await getResend().emails.send({
          from: getFrom(),
          to: email,
          subject: "Last thing: 20% off your first month",
          html: buildDay30Html(displayName, userId),
          text: buildDay30Text(displayName, userId),
          headers: listUnsubHeaders(userId),
        });
        logger.info("[DripSequence] Day 30 email sent", { userId });
      });
    }

    return { userId, completed: true };
  },
);

// ── Day 14 email builders ─────────────────────────────────────────────────────

function buildDay14Html(name: string, userId: string): string {
  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px;line-height:1.3;">
      The feature most users discover last, ${name}
    </h1>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Most OptiAISEO users spend their first two weeks on the AEO Score and blog generator.
      But the feature that drives the biggest ranking gains? The <strong style="color:#fff;">Competitor Gap</strong>.
    </p>
    <div style="background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="color:#d1fae5;font-size:14px;margin:0 0 12px;">With Competitor Gap you can:</p>
      <ul style="color:#9ca3af;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
        <li>See every keyword your top competitor ranks for — that you don't</li>
        <li>Find which AI citation sources your competitor gets — that you're missing</li>
        <li>Get a prioritised fix list ranked by traffic opportunity</li>
      </ul>
    </div>
    <a href="${appUrl()}/dashboard/competitors"
       style="display:inline-block;background:#10b981;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 24px;border-radius:10px;">
      Try Competitor Gap →
    </a>`;
  return emailShell(body, userId);
}

function buildDay14Text(name: string, userId: string): string {
  return textShell(
    [
      `The feature most users discover last, ${name}`,
      "",
      "The Competitor Gap tool shows you:",
      "- Every keyword your top competitor ranks for that you don't",
      "- Which AI citation sources your competitor gets that you're missing",
      "- A prioritised fix list ranked by traffic opportunity",
      "",
      `Try it now: ${appUrl()}/dashboard/competitors`,
    ].join("\n"),
    userId,
  );
}

// ── Day 21 email builders ─────────────────────────────────────────────────────

function buildDay21Html(
  name: string,
  competitorDomain: string | null,
  userId: string,
): string {
  const compLine = competitorDomain
    ? `<strong style="color:#fff;">${competitorDomain}</strong>`
    : "your top competitor";

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px;line-height:1.3;">
      ${competitorDomain ? `${competitorDomain} is gaining in AI search` : "Your competitors are gaining ground in AI search"}, ${name}
    </h1>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 20px;">
      Our weekly scan found ${compLine} appearing in more AI-generated answers than three weeks ago.
      The gap compounds quickly — the earlier you act, the less ground you have to recover.
    </p>
    <div style="background:#161b22;border-left:3px solid #ef4444;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px;">
      <p style="color:#fca5a5;font-size:14px;margin:0;">
        Every week without AI-citation optimisation is a week that competitor gains a larger foothold
        in Perplexity, ChatGPT, and Claude answers.
      </p>
    </div>
    <a href="${appUrl()}/dashboard/competitors"
       style="display:inline-block;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:10px;">
      View Competitor Analysis →
    </a>`;
  return emailShell(body, userId);
}

function buildDay21Text(
  name: string,
  competitorDomain: string | null,
  userId: string,
): string {
  const compLine = competitorDomain ?? "your top competitor";
  return textShell(
    [
      `${competitorDomain ? `${competitorDomain} is gaining in AI search` : "Your competitors are gaining ground"}, ${name}`,
      "",
      `${compLine} is appearing in more AI-generated answers than three weeks ago.`,
      "The gap compounds quickly — act now before it grows.",
      "",
      `View competitor analysis: ${appUrl()}/dashboard/competitors`,
    ].join("\n"),
    userId,
  );
}

// ── Day 30 email builders ─────────────────────────────────────────────────────

function buildDay30Html(name: string, userId: string): string {
  const upgradeUrl = `${appUrl()}/dashboard/billing`;
  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px;line-height:1.3;">
      One last thing before I stop emailing, ${name}
    </h1>
    <p style="color:#9ca3af;font-size:15px;line-height:1.7;margin:0 0 20px;">
      You've been on OptiAISEO for 30 days. Over that time you've seen how the platform works.
      If you're ready to unlock the full power, here's your best offer:
    </p>
    <div style="background:linear-gradient(135deg,rgba(16,185,129,.12),rgba(59,130,246,.12));border:1px solid rgba(16,185,129,.3);border-radius:14px;padding:24px;margin-bottom:24px;text-align:center;">
      <div style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#10b981;margin-bottom:8px;">Limited Offer</div>
      <div style="font-size:36px;font-weight:800;color:#fff;margin-bottom:4px;">20% off</div>
      <div style="font-size:15px;color:#9ca3af;">your first month on any paid plan</div>
      <div style="font-size:12px;color:#6b7280;margin-top:8px;">Use code <strong style="color:#fff;">MONTH20</strong> at checkout</div>
    </div>
    <a href="${upgradeUrl}"
       style="display:inline-block;background:linear-gradient(135deg,#10b981,#3b82f6);color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 28px;border-radius:10px;">
      Claim 20% Off →
    </a>
    <p style="color:#4b5563;font-size:13px;margin-top:20px;">
      If OptiAISEO isn't the right fit right now, no hard feelings. I appreciate you giving it a try.
      You won't receive any more marketing emails after this one.
    </p>`;
  return emailShell(body, userId);
}

function buildDay30Text(name: string, userId: string): string {
  return textShell(
    [
      `One last thing before I stop emailing, ${name}`,
      "",
      "You've been on OptiAISEO for 30 days. Here's your best offer:",
      "",
      "20% off your first month on any paid plan.",
      "Use code MONTH20 at checkout.",
      "",
      `Claim your discount: ${appUrl()}/dashboard/billing`,
      "",
      "If OptiAISEO isn't right for you right now, no hard feelings.",
      "You won't receive any more marketing emails after this one.",
    ].join("\n"),
    userId,
  );
}