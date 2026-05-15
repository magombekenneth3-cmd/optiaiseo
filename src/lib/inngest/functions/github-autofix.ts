import { logger } from "@/lib/logger";
import { inngest } from "../client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { createAutoFixPR, type AutoFixFile } from "@/lib/github";
import { callGemini } from "@/lib/gemini/client";

const CHECK_TO_FILE: Record<string, { path: string; label: string }> = {
    schema_faq:              { path: "public/schema/faq.json",                   label: "FAQPage schema markup" },
    schema_howto:            { path: "public/schema/howto.json",                  label: "HowTo schema markup" },
    schema_article:          { path: "public/schema/article.json",                label: "Article schema markup" },
    schema_speakable:        { path: "public/schema/speakable.json",              label: "Speakable schema markup" },
    schema_organization:     { path: "public/schema/organization.json",           label: "Organization schema markup" },
    eeat_about:              { path: "public/about-page-template.html",           label: "About page template" },
    eeat_contact:            { path: "public/contact-page-template.html",         label: "Contact page template" },
    eeat_privacy:            { path: "public/privacy-page-template.html",         label: "Privacy policy template" },
    content_faq_section:     { path: "public/faq-section-template.html",          label: "FAQ content section" },
    tech_sitemap:            { path: "public/sitemap.xml",                        label: "XML Sitemap" },
    tech_canonical:          { path: "public/seo-head-snippets.html",             label: "Canonical tag snippet" },
    "content-decay-detector":{ path: "public/content-refresh-blueprint.md",      label: "Content Refresh Blueprint" },
    "search-intent-mapper":  { path: "public/search-intent-optimizations.md",    label: "Search Intent optimizations" },
    "header-tag-strategy":   { path: "public/header-tag-strategy.html",          label: "Header Tag optimizations" },
};

const CODE_QUALITY_SUFFIX =
    "\n\nCODE QUALITY: Generated code must be perfectly formatted and follow accessibility norms. DO NOT alter any UI, UX, layouts, or core application logic. Focus strictly on SEO and AEO improvements.";

function buildFixPrompt(checkId: string, domain: string): string {
    const prompts: Record<string, string> = {
        schema_faq:              `Generate a complete FAQPage JSON-LD schema for ${domain}. Include 5 realistic visitor questions. Return ONLY raw JSON.`,
        schema_howto:            `Generate a HowTo JSON-LD schema for ${domain}. Return ONLY raw JSON.`,
        schema_article:          `Generate an Article JSON-LD schema for ${domain}. Return ONLY raw JSON.`,
        schema_speakable:        `Generate a Speakable JSON-LD schema for ${domain}. Return ONLY raw JSON.`,
        schema_organization:     `Generate a complete Organization JSON-LD schema for ${domain} including name, url, logo, and sameAs. Return ONLY raw JSON.`,
        eeat_about:              `Write a professional /about page HTML body for ${domain}. Return ONLY the HTML body content.`,
        eeat_contact:            `Write a /contact page HTML body for ${domain} with a contact form. Return ONLY the HTML body content.`,
        eeat_privacy:            `Write a GDPR-compliant privacy policy HTML body for ${domain}. Return ONLY the HTML body content.`,
        content_faq_section:     `Write a FAQ section using <details>/<summary> for ${domain} with 5 visitor questions. Return ONLY the <section>...</section>.`,
        tech_sitemap:            `Generate a sitemap.xml for ${domain} covering /, /about, /contact, /blog, /privacy. Return ONLY the XML.`,
        tech_canonical:          `Generate a canonical <link> tag for ${domain}. Return ONLY the tag.`,
        "content-decay-detector":`Generate a Content Refresh Blueprint markdown for ${domain} with 3 industry updates. Return ONLY markdown.`,
        "search-intent-mapper":  `Generate a Search Intent Optimization guide markdown for ${domain}. Return ONLY markdown.`,
        "header-tag-strategy":   `Generate 5 optimised H2 headings for the main landing page of ${domain}. Return ONLY an HTML snippet.`,
    };
    return (prompts[checkId] ?? `Generate the SEO fix for check "${checkId}" for ${domain}. Return only the code.`) + CODE_QUALITY_SUFFIX;
}

export const githubAutofixSiteJob = inngest.createFunction(
    {
        id: "github-autofix-site",
        name: "GitHub Auto-Fix — Per Site",
        concurrency: { limit: 3 },
        retries: 1,
    
        triggers: [{ event: "github.autofix.site" }],
    },
    async ({ event, step }) => {
        const { siteId, domain } = event.data as { siteId: string; domain: string };

        if (!process.env.GEMINI_API_KEY) {
            throw new NonRetriableError("Missing GEMINI_API_KEY");
        }

        const site = await step.run("fetch-site", async () => {
            const s = await prisma.site.findUnique({
                where: { id: siteId },
                select: { id: true, domain: true, githubRepoUrl: true, userId: true, user: { select: { email: true } } },
            });
            if (!s?.githubRepoUrl) throw new NonRetriableError(`Site ${siteId} has no GitHub repo URL`);
            return s;
        });

        const token = await step.run("resolve-github-token", async () => {
            const { getGitHubToken } = await import("@/lib/github/token");
            const ghToken = await getGitHubToken(site.userId);
            if (!ghToken) {
                logger.info(`[Inngest/GithubAutofix] Skipping ${domain}: user has no GitHub OAuth token connected`);
            }
            return ghToken;
        });

        if (!token) return { skipped: true, reason: "no_github_oauth" };

        const failingChecks = await step.run("load-cached-aeo-report", async () => {
            const report = await prisma.aeoReport.findFirst({
                where: { siteId },
                orderBy: { createdAt: "desc" },
                select: { checks: true, createdAt: true },
            });

            const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
            if (!report || Date.now() - report.createdAt.getTime() > SEVEN_DAYS_MS) {
                logger.info(`[Inngest/GithubAutofix] ${domain}: no fresh AEO report — skipping`);
                return null;
            }

            type AeoCheck = { id: string; passed: boolean; impact: string };
            const checks = report.checks as unknown as AeoCheck[];
            return checks.filter((c) => !c.passed && c.impact === "high");
        });

        if (!failingChecks || failingChecks.length === 0) {
            return { skipped: true, reason: failingChecks === null ? "no_fresh_report" : "no_issues" };
        }

        const fixFiles = await step.run("generate-fix-files", async () => {
            const files: AutoFixFile[] = [];
            for (const check of failingChecks) {
                const fileMeta = CHECK_TO_FILE[check.id];
                if (!fileMeta) continue;
                const content = await callGemini(buildFixPrompt(check.id, domain), { maxOutputTokens: 4096, temperature: 0.3 })
                    .catch((err: unknown) => {
                        logger.warn("[Inngest/GithubAutofix] Gemini call failed for check", {
                            checkId: check.id,
                            domain,
                            error: (err as Error)?.message ?? String(err),
                        });
                        return null;
                    });
                if (content) files.push({ path: fileMeta.path, content: content.trim(), description: fileMeta.label });
            }
            return files;
        });

        if (fixFiles.length === 0) return { skipped: true, reason: "gemini_failed" };

        const prResult = await step.run("open-pr", async () => {
            return createAutoFixPR(site.githubRepoUrl!, fixFiles, domain, token, site.user?.email ?? undefined);
        });

        if (prResult.success) {
            logger.debug(`[Inngest/GithubAutofix] PR opened for ${domain}: ${prResult.prUrl}`);
            return { success: true, prUrl: prResult.prUrl, fixCount: fixFiles.length };
        }

        logger.error(`[Inngest/GithubAutofix] PR failed for ${domain}: ${prResult.error}`);
        return { success: false, error: prResult.error };
    }
);
