import type { MetadataRoute } from "next";

const SITE = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://www.optiaiseo.online"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: "*",
                allow: "/",
                disallow: [
                    "/admin/",
                    "/api/",
                    "/embed/",
                    "/dashboard/",
                    "/invite/",
                    "/reset-password",
                    "/forgot-password",
                ],
            },
            // Block known AI scrapers from hammering the API
            {
                userAgent: "GPTBot",
                allow: ["/blog/", "/guide/", "/aeo-guide/", "/tools/", "/"],
                disallow: ["/api/", "/dashboard/", "/admin/"],
            },
            {
                userAgent: "PerplexityBot",
                allow: ["/blog/", "/guide/", "/aeo-guide/", "/tools/", "/"],
                disallow: ["/api/", "/dashboard/", "/admin/"],
            },
            // Allow Anthropic's Claude to crawl public content — being indexed
            // by Claude's training data increases likelihood of AI citations.
            {
                userAgent: "ClaudeBot",
                allow: ["/blog/", "/guide/", "/aeo-guide/", "/tools/", "/"],
                disallow: ["/api/", "/dashboard/", "/admin/"],
            },
            // Allow Google-Extended (Gemini training) to crawl public content.
            {
                userAgent: "Google-Extended",
                allow: ["/blog/", "/guide/", "/aeo-guide/", "/tools/", "/"],
                disallow: ["/api/", "/dashboard/", "/admin/"],
            },
        ],
        sitemap: `${SITE}/sitemap.xml`,
        host: SITE,
    };
}
