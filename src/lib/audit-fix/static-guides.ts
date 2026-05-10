/**
 * static-guides.ts — Phase 1.4
 *
 * Extracted from auditFix.ts (lines 210–483).
 * All static fallback guides live here, isolated from Gemini/GitHub logic.
 */

export interface ManualFixGuide {
    steps: string[];
    codeSnippet?: string;
    filePath?: string;
    language?: string;
    docsUrl?: string;
}

interface SeoIssue {
    checkId?: string;
    id?: string;
    title?: string;
    category?: string;
    [key: string]: unknown;
}

// Guide registry

export const STATIC_FALLBACK_GUIDES: Record<string, ManualFixGuide> = {
    "robots-txt": {
        steps: [
            "Create a file named `robots.txt` in the root `/public` directory of your project.",
            "Add the basic rules below to allow all crawlers and reference your sitemap.",
            "Deploy the file — it will be served at `https://yourdomain.com/robots.txt`.",
        ],
        codeSnippet: `User-agent: *
Allow: /
Sitemap: https://yourdomain.com/sitemap.xml`,
        filePath: "public/robots.txt",
        language: "text",
        docsUrl: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
    },

    "xml-sitemap": {
        steps: [
            "For Next.js App Router: create `app/sitemap.ts` and export a default function that returns your URL list.",
            "For static sites: create `public/sitemap.xml` with all page URLs.",
            "Submit the sitemap URL to Google Search Console under Indexing → Sitemaps.",
        ],
        codeSnippet: `// app/sitemap.ts (Next.js App Router)
import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://yourdomain.com', lastModified: new Date(), changeFrequency: 'monthly', priority: 1 },
    { url: 'https://yourdomain.com/about', lastModified: new Date(), changeFrequency: 'yearly', priority: 0.8 },
  ];
}`,
        filePath: "app/sitemap.ts",
        language: "typescript",
        docsUrl: "https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap",
    },

    "google-analytics": {
        steps: [
            "Go to analytics.google.com and create a new GA4 property for your domain.",
            "Copy the Measurement ID (format: G-XXXXXXXXXX).",
            "In Next.js: install `@next/third-parties` and add `<GoogleAnalytics gaId='G-XXXXXXXXXX' />` to your root layout.",
            "Verify data is flowing in the GA4 Realtime report within 24 hours.",
        ],
        codeSnippet: `// app/layout.tsx
import { GoogleAnalytics } from '@next/third-parties/google';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
      <GoogleAnalytics gaId="G-XXXXXXXXXX" />
    </html>
  );
}`,
        filePath: "app/layout.tsx",
        language: "typescript",
        docsUrl: "https://nextjs.org/docs/app/building-your-application/optimizing/third-party-libraries#google-analytics",
    },

    "google-tag-manager": {
        steps: [
            "Go to tagmanager.google.com and create a new container for your domain.",
            "Copy the Container ID (format: GTM-XXXXXXX).",
            "In Next.js: install `@next/third-parties` and add `<GoogleTagManager gtmId='GTM-XXXXXXX' />` to your root layout.",
        ],
        codeSnippet: `// app/layout.tsx
import { GoogleTagManager } from '@next/third-parties/google';

export default function RootLayout({ children }) {
  return (
    <html>
      <GoogleTagManager gtmId="GTM-XXXXXXX" />
      <body>{children}</body>
    </html>
  );
}`,
        filePath: "app/layout.tsx",
        language: "typescript",
    },

    "gsc-verification": {
        steps: [
            "Go to search.google.com/search-console and click Add Property.",
            "Choose URL prefix and enter your domain.",
            "Select HTML tag verification — copy the content value from the meta tag.",
            "In Next.js: add `verification: { google: 'YOUR_CODE' }` to your root metadata export.",
            "Click Verify in Search Console.",
        ],
        codeSnippet: `// app/layout.tsx
export const metadata = {
  verification: {
    google: 'YOUR_VERIFICATION_CODE_HERE',
  },
};`,
        filePath: "app/layout.tsx",
        language: "typescript",
        docsUrl: "https://support.google.com/webmasters/answer/9008080",
    },

    "map-embed": {
        steps: [
            "Go to maps.google.com and search for your business address.",
            "Click Share → Embed a map → Copy HTML.",
            "Paste the <iframe> code in your contact or about page.",
            "For performance: add `loading='lazy'` attribute to the iframe.",
        ],
        docsUrl: "https://support.google.com/maps/answer/3544418",
    },

    "local-directories": {
        steps: [
            "Claim your Google Business Profile at business.google.com.",
            "Ensure NAP (Name, Address, Phone) is identical across your website, GBP, and all directories.",
            "Submit to: Yelp, Bing Places, Apple Maps Connect, Foursquare, and industry-specific directories.",
            "Use a tool like Moz Local or BrightLocal to manage listings at scale.",
        ],
        docsUrl: "https://support.google.com/business/answer/2911778",
    },

    "backlink-profile": {
        steps: [
            "Use Google Search Console → Links to see your current backlink profile.",
            "Identify toxic/spammy links using Ahrefs or SEMrush.",
            "Disavow harmful links via Google Search Console's Disavow tool.",
            "Build quality backlinks through: guest posts, digital PR, resource page outreach, and link reclamation.",
        ],
        docsUrl: "https://developers.google.com/search/docs/essentials/links",
    },
};

// Public API

/**
 * Returns the best matching static guide for an issue, or null if none found.
 * Matching is fuzzy: checks checkId, id, title, and category against guide keys.
 */
export function getStaticFallback(issue: SeoIssue): ManualFixGuide | null {
    const candidates = [issue.checkId, issue.id, issue.title, issue.category]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());

    for (const candidate of candidates) {
        if (STATIC_FALLBACK_GUIDES[candidate]) return STATIC_FALLBACK_GUIDES[candidate];
        const key = Object.keys(STATIC_FALLBACK_GUIDES).find(
            (k) => candidate.includes(k) || k.includes(candidate),
        );
        if (key) return STATIC_FALLBACK_GUIDES[key];
    }
    return null;
}

/**
 * Returns true if this issue should always use a static guide (no AI needed).
 */
export function shouldUseStaticGuide(issue: SeoIssue): boolean {
    const id = [issue.checkId, issue.id, issue.title, issue.category]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(" ");

    return (
        id.includes("robots") ||
        id.includes("sitemap") ||
        id.includes("google-analytics") ||
        id.includes("google-tag-manager") ||
        id.includes("gsc-verification") ||
        id.includes("map-embed") ||
        id.includes("local-directories") ||
        id.includes("backlink")
    );
}
