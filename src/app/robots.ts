import type { MetadataRoute } from "next";

const CANONICAL_SITE_URL = "https://optiaiseo.online";
const rawSite = (
    process.env.NEXT_PUBLIC_SITE_URL?.startsWith("http") && !process.env.NEXT_PUBLIC_SITE_URL.includes("localhost")
        ? process.env.NEXT_PUBLIC_SITE_URL
        : process.env.NEXT_PUBLIC_APP_URL?.startsWith("http") && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost")
        ? process.env.NEXT_PUBLIC_APP_URL
        : CANONICAL_SITE_URL
).replace(/\/$/, "");
const SITE = rawSite.includes("www.optiaiseo.online") ? CANONICAL_SITE_URL : rawSite;

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
