import { inngest } from "../client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { checkPerplexityCitation } from "@/lib/aeo/perplexity-citation-check";
import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const CHECKPOINTS_DAYS = [7, 14, 30] as const;

export const blogCitationMonitorJob = inngest.createFunction(
  {
    id: "blog-citation-monitor",
    name: "Post-Publish Citation Monitor",
    retries: 2,
    concurrency: { limit: 5, key: "event.data.siteId" },
  
      triggers: [{ event: "blog.published" }],
  },
  async ({ event, step }) => {
    const { siteId, blogId, targetKeywords, publishedAt } = event.data as {
      siteId: string;
      blogId: string;
      targetKeywords: string[];
      publishedAt: string;
    };

    const site = await step.run("fetch-site", async () => {
      return prisma.site.findUnique({
        where: { id: siteId },
        select: { domain: true, user: { select: { email: true, name: true } } },
      });
    });

    if (!site) return { skipped: true, reason: "site_not_found" };

    const keywords = (targetKeywords ?? []).slice(0, 5);
    if (keywords.length === 0) return { skipped: true, reason: "no_keywords" };

    let alreadyCited = false;
    const results: { checkpoint: number; keyword: string; cited: boolean }[] = [];

    for (const days of CHECKPOINTS_DAYS) {
      if (alreadyCited) break;

      const fireAt = new Date(publishedAt).getTime() + days * 24 * 60 * 60 * 1000;
      const remainingMs = fireAt - Date.now();

      if (remainingMs > 0) {
        await step.sleepUntil(`wait-until-${days}d`, new Date(fireAt));
      }

      const checkpointResults = await step.run(`check-citations-${days}d`, async () => {
        const found: { keyword: string; cited: boolean; citationUrl: string | null }[] = [];
        for (const keyword of keywords) {
          try {
            const res = await checkPerplexityCitation(keyword, site.domain);
            found.push({ keyword, cited: res.cited, citationUrl: res.citationUrl });
          } catch (err: unknown) {
            logger.warn("[CitationMonitor] Perplexity check failed", {
              keyword,
              error: (err as Error)?.message,
            });
          }
        }
        return found;
      });

      for (const r of checkpointResults) {
        results.push({ checkpoint: days, keyword: r.keyword, cited: r.cited });
      }

      const newlyCited = checkpointResults.filter((r) => r.cited);

      if (newlyCited.length > 0 && !alreadyCited) {
        alreadyCited = true;

        await step.run("persist-citations", async () => {
          await prisma.aiShareOfVoice.createMany({
            data: newlyCited.map((r) => ({
              siteId,
              keyword: r.keyword,
              modelName: "perplexity",
              brandMentioned: true,
              competitorsMentioned: [],
              recordedAt: new Date(),
            })),
            skipDuplicates: true,
          });
        });

        await step.run("send-citation-email", async () => {
          if (!site.user?.email || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_DOMAIN) return;

          const keywordList = newlyCited
            .map((r) => `"${r.keyword}"`)
            .join(", ");

          await getResend().emails.send({
            from: `OptiAISEO <noreply@${process.env.RESEND_FROM_DOMAIN}>`,
            to: site.user.email,
            subject: `🎉 Your blog is being cited by Perplexity — ${site.domain}`,
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
                <h2 style="font-size:22px;font-weight:700;margin:0 0 8px">Your content is earning AI citations</h2>
                <p style="color:#555;margin:0 0 24px">
                  Great news — ${days} days after publishing, Perplexity has started citing
                  <strong>${site.domain}</strong> for ${keywordList}.
                </p>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-bottom:24px">
                  <p style="margin:0;font-weight:600;color:#166534">📍 What this means</p>
                  <p style="margin:8px 0 0;color:#15803d;font-size:14px">
                    When someone asks Perplexity about ${newlyCited[0]?.keyword ?? ""}, your site is now
                    one of the sources it cites. This directly increases your AI Visibility score.
                  </p>
                </div>
                <a href="https://optiaiseo.online/dashboard/aeo?siteId=${siteId}"
                   style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                          padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
                  View your full AEO report →
                </a>
                <p style="color:#999;font-size:12px;margin-top:32px">
                  You're receiving this because you have blog citation monitoring enabled on ${site.domain}.
                </p>
              </div>
            `,
          });
        });
      }
    }

    logger.info("[CitationMonitor] Completed", {
      siteId,
      blogId,
      checkpoints: CHECKPOINTS_DAYS.length,
      totalCited: results.filter((r) => r.cited).length,
    });

    return { siteId, blogId, results, alreadyCited };
  }
);