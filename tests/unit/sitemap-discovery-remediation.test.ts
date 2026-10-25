import React from "react";
(globalThis as unknown as { React: typeof React }).React = React;

import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/marketing/SiteFooter", () => ({ default: () => null }));
vi.mock("@/components/marketing/NavAuthSection", () => ({ NavAuthSection: () => null }));
vi.mock("@/components/marketing/MarketingNav", () => ({ MarketingNav: () => null }));
vi.mock("@/components/home/HomeClient", () => ({ default: () => null }));
vi.mock("@/app/actions/stats", () => ({ getPublicStats: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    blog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "--font-inter", className: "inter" }),
  Montserrat: () => ({ variable: "--font-montserrat", className: "montserrat" }),
}));

import fs from "fs";
import path from "path";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { metadata as rootMetadata } from "@/app/layout";
import { metadata as homeMetadata } from "@/app/page";
import { metadata as termsMetadata } from "@/app/terms/page";
import { metadata as privacyMetadata } from "@/app/privacy/page";
import { metadata as securityMetadata } from "@/app/security/page";
import { generateMetadata as generateToolsMetadata } from "@/app/tools/[slug]/page";
import { generateMetadata as generateAeoGuideMetadata } from "@/app/aeo-guide/[slug]/page";
import { generateMetadata as generateGuideMetadata } from "@/app/guide/[slug]/page";
import { GUIDES } from "@/data/guides";
import KEYWORDS from "@/data/keywords.json";
import { NICHES, getNicheLeaderboardResult } from "@/lib/leaderboard";
import { generateMetadata as generateLeaderboardMetadata } from "@/app/leaderboard/[niche]/page";

describe("Sitemap Generation & Deduplication", () => {
  it("emits only unique canonical URLs", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    const uniqueUrls = new Set(urls);

    expect(urls.length).toBe(uniqueUrls.size);
  });

  it("enforces canonical origin and avoids accidental trailing slashes", async () => {
    const entries = await sitemap();
    const rootOrigin = "https://optiaiseo.online";

    for (const entry of entries) {
      expect(entry.url.startsWith(rootOrigin)).toBe(true);
      if (entry.url !== rootOrigin) {
        expect(entry.url.endsWith("/")).toBe(false);
      }
    }
  });

  it("does not duplicate the 7 competitor alternative tool paths", async () => {
    const entries = await sitemap();
    const duplicateTargets = [
      "https://optiaiseo.online/tools/moz-alternatives",
      "https://optiaiseo.online/tools/ahrefs-alternatives-free",
      "https://optiaiseo.online/tools/clearscope-alternatives",
      "https://optiaiseo.online/tools/screaming-frog-alternatives",
      "https://optiaiseo.online/tools/mangools-alternatives",
      "https://optiaiseo.online/tools/surfer-seo-alternatives",
      "https://optiaiseo.online/tools/semrush-alternatives-free",
    ];

    for (const target of duplicateTargets) {
      const occurrences = entries.filter((e) => e.url === target).length;
      expect(occurrences).toBe(1);
    }
  });

  it("excludes authenticated dashboard routes and noncanonical variants", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls.some((u) => u.includes("/dashboard"))).toBe(false);
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
    expect(urls.some((u) => u.includes("/api/"))).toBe(false);
    expect(urls.some((u) => u.includes("free-backlink-checker-usa"))).toBe(false);
  });
});

describe("Leaderboard Safe Handling & SEO Indexability Policy", () => {
  it("distinguishes empty categories and marks them noindex, follow", async () => {
    for (const niche of NICHES) {
      const result = await getNicheLeaderboardResult(niche);
      // In current database state, all 6 niches have 0 qualifying snapshot rows
      if (result.status === "empty") {
        const metadata = await generateLeaderboardMetadata({
          params: Promise.resolve({ niche }),
        });
        expect(metadata.robots).toEqual({ index: false, follow: true });
        expect(metadata.alternates?.canonical).toBe(`https://optiaiseo.online/leaderboard/${niche}`);
      } else if (result.status === "success") {
        const metadata = await generateLeaderboardMetadata({
          params: Promise.resolve({ niche }),
        });
        expect(metadata.robots).toEqual({ index: true, follow: true });
      }
    }
  });

  it("excludes confirmed empty leaderboards from sitemap", async () => {
    const entries = await sitemap();
    const urls = new Set(entries.map((e) => e.url));

    for (const niche of NICHES) {
      const result = await getNicheLeaderboardResult(niche);
      if (result.status === "empty") {
        expect(urls.has(`https://optiaiseo.online/leaderboard/${niche}`)).toBe(false);
      }
    }
  });
});

describe("Programmatic Content & Internal Link Integrity", () => {
  it("has valid, unique slugs for all programmatic keywords", () => {
    const slugs = new Set<string>();
    for (const k of KEYWORDS as { slug: string; title: string; keyword: string; intent: string; tools: unknown[] }[]) {
      expect(k.slug).toBeTruthy();
      expect(k.keyword).toBeTruthy();
      expect(k.title).toBeTruthy();
      expect(Array.isArray(k.tools)).toBe(true);
      expect(slugs.has(k.slug)).toBe(false);
      slugs.add(k.slug);
    }
  });

  it("contains no broken links to deleted blog posts in guides dataset", () => {
    for (const [slug, item] of Object.entries(GUIDES)) {
      expect(slug).toBeTruthy();
      expect(item.title).toBeTruthy();
      for (const rel of item.related) {
        expect(rel.href.startsWith("/")).toBe(true);
        expect(rel.href.startsWith("/blog/")).toBe(false);
      }
    }
  });

  it("verifies diversified non-boilerplate verdicts on audited regional pages", () => {
    const auditedSlugs = [
      "cheap-seo-tools-uk",
      "cheap-seo-tools-usa",
      "cheap-seo-tools-canada",
      "cheap-seo-tools-australia",
      "free-seo-tools-germany",
      "free-seo-tools-netherlands",
      "free-seo-tools-uk",
      "free-seo-tools-australia",
    ];

    for (const slug of auditedSlugs) {
      const page = (KEYWORDS as { slug: string; tools: { name: string; verdict: string }[] }[]).find((k) => k.slug === slug);
      expect(page).toBeDefined();
      if (page) {
        for (const tool of page.tools) {
          expect(tool.verdict).toBeTruthy();
          expect(tool.verdict.includes("Solid free option for")).toBe(false);
          expect(tool.verdict.includes("without breaking the budget")).toBe(false);
        }
      }
    }
  });

  describe("Canonical Hostname & WWW Consolidation", () => {
    it("enforces https://optiaiseo.online host and sitemap in robots.ts", () => {
      const r = robots();
      expect(r.host).toBe("https://optiaiseo.online");
      expect(r.sitemap).toBe("https://optiaiseo.online/sitemap.xml");
    });

    it("contains no www.optiaiseo.online URLs in public/llms.txt", () => {
      const content = fs.readFileSync(path.resolve(process.cwd(), "public/llms.txt"), "utf-8");
      expect(content.includes("www.optiaiseo.online")).toBe(false);
      expect(content.includes("https://optiaiseo.online")).toBe(true);
    });

    it("declares canonical production server in public/openapi.yaml", () => {
      const content = fs.readFileSync(path.resolve(process.cwd(), "public/openapi.yaml"), "utf-8");
      expect(content.includes("https://optiaiseo.online/api/v1")).toBe(true);
      expect(content.includes("www.optiaiseo.online")).toBe(false);
    });

      it("configures 301 permanent redirects for www and railway domains in next.config.ts", () => {
      const configText = fs.readFileSync(path.resolve(process.cwd(), "next.config.ts"), "utf-8");
      expect(configText).toContain('value: "www.optiaiseo.online"');
      expect(configText).toContain("https://optiaiseo.online/:path*");
      expect(configText).toContain("optiaiseo-production.up.railway.app");
      expect(configText).toContain("optiaiseo-production-ac11.up.railway.app");
      expect(configText).toContain("statusCode: 301");
    });
  });

  describe("Rendered Canonical Tags Audit & Child Inheritance Prevention", () => {
    it("ensures root layout does NOT define alternates.canonical so child pages never inherit homepage canonical", () => {
      expect(rootMetadata.alternates?.canonical).toBeUndefined();
    });

    it("ensures homepage explicitly defines canonical to https://optiaiseo.online/", () => {
      expect(homeMetadata.alternates?.canonical).toBe("https://optiaiseo.online/");
    });

    it("ensures static legal and security pages define their own explicit canonical URLs", () => {
      expect(termsMetadata.alternates?.canonical).toBe("https://optiaiseo.online/terms");
      expect(privacyMetadata.alternates?.canonical).toBe("https://optiaiseo.online/privacy");
      expect(securityMetadata.alternates?.canonical).toBe("https://optiaiseo.online/security");
    });

    it("ensures representative tools page generates its own distinct canonical URL and truthful dateModified", async () => {
      const meta = await generateToolsMetadata({ params: Promise.resolve({ slug: "ai-seo-tools-usa" }) });
      expect(meta.alternates?.canonical).toBe("https://optiaiseo.online/tools/ai-seo-tools-usa");
      expect(meta.alternates?.canonical).not.toBe("https://optiaiseo.online/");

      const toolsPageSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/tools/[slug]/page.tsx"), "utf-8");
      expect(toolsPageSource.includes('dateModified: "2026-09-15"')).toBe(false);
    });

    it("ensures representative aeo-guide page generates its own distinct canonical URL", async () => {
      const meta = await generateAeoGuideMetadata({ params: Promise.resolve({ slug: "topical-authority-ai-search" }) });
      expect(meta.alternates?.canonical).toBe("https://optiaiseo.online/aeo-guide/topical-authority-ai-search");
      expect(meta.alternates?.canonical).not.toBe("https://optiaiseo.online/");
    });

    it("ensures representative guide page generates its own distinct canonical URL", async () => {
      const meta = await generateGuideMetadata({ params: Promise.resolve({ slug: "how-to-rank-in-chatgpt" }) });
      expect(meta.alternates?.canonical).toBe("https://optiaiseo.online/guide/how-to-rank-in-chatgpt");
      expect(meta.alternates?.canonical).not.toBe("https://optiaiseo.online/");
    });
  });

  describe("Redirect Relevance & Junk URL Handling", () => {
    it("maps obsolete blog URLs to specific topical replacements and avoids generic hub Soft 404s", () => {
      const configText = fs.readFileSync(path.resolve(process.cwd(), "next.config.ts"), "utf-8");
      expect(configText).toContain("source: '/blog/topical-authority-guide', destination: '/aeo-guide/topical-authority-ai-search'");
      expect(configText).toContain("source: '/blog/ai-citation-guide', destination: '/aeo-guide/ai-citation-tracking'");
      expect(configText).toContain("source: '/blog/automated-schema-fix-github', destination: '/guide/schema-markup-ai-search'");
      expect(configText).toContain("source: '/blog/nextjs-seo-guide', destination: '/seo'");
    });

    it("does not redirect /100 to homepage, permitting a natural 404 response", () => {
      const configText = fs.readFileSync(path.resolve(process.cwd(), "next.config.ts"), "utf-8");
      expect(configText.includes("source: '/100'")).toBe(false);
    });
  });
});
