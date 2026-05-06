/**
 * src/lib/seo-fallbacks.ts
 * ────────────────────────
 * Framework-aware static fallback guides shown when:
 * - Gemini API is unavailable / quota-exceeded
 * - Fix generation fails validation
 * - Issue type has no AI template
 *
 * Every guide is specific to the framework — no generic Next.js guide shown to a WordPress user.
 */

import type { Framework } from "./ai";
import { BRAND } from "@/lib/constants/brand";

export interface FallbackGuide {
    title: string;
    steps: string[];
    docsUrl?: string;
    manualOnly?: boolean; // e.g. WordPress, Google Business Profile
}

type FallbackMap = Partial<Record<Framework, FallbackGuide>>;

// ── Per-issue fallbacks keyed by issueId ─────────────────────────────────────
const FALLBACKS: Record<string, FallbackMap & { _default: FallbackGuide }> = {

    "title-tag": {
        _default: {
            title: "Fix: Title Tag Too Long or Missing",
            steps: [
                "Open your site's main HTML file or layout component.",
                "Locate the <title> element inside the <head>.",
                "Shorten the text to under 60 characters.",
                "Keep your primary keyword and brand name.",
                `Example: '${BRAND.NAME} — Free Audit | BrandName' (42 chars).`,
                "Deploy and verify with Google Search Console > URL Inspection.",
            ],
            docsUrl: "https://developers.google.com/search/docs/appearance/title-link",
        },
        "nextjs-app": {
            title: "Fix: Title Tag (Next.js App Router)",
            steps: [
                "Open src/app/layout.tsx",
                "Set the metadata title template:\n```tsx\nexport const metadata: Metadata = {\n  title: { template: '%s | YourBrand', default: 'Your Site — Short Description' }\n};\n```",
                "In each page.tsx, export: export const metadata: Metadata = { title: 'Page Name' }",
                "Keep each full rendered title under 60 characters total.",
                "Run: pnpm build → check the <title> in the generated HTML.",
            ],
            docsUrl: "https://nextjs.org/docs/app/api-reference/functions/generate-metadata#title",
        },
        "nextjs-pages": {
            title: "Fix: Title Tag (Next.js Pages Router)",
            steps: [
                "In each page file, import Head from 'next/head'.",
                "Add: <Head><title>Your Title Under 60 Chars</title></Head>",
                "For dynamic titles, set it in getServerSideProps and pass as a prop.",
                "Verify length: logger.debug('Title length:', title.length) during build.",
            ],
            docsUrl: "https://nextjs.org/docs/pages/api-reference/components/head",
        },
        "wordpress": {
            title: "Fix: Title Tag (WordPress)",
            steps: [
                "Install Yoast SEO or RankMath plugin from Plugins > Add New.",
                "Go to Yoast SEO > Search Appearance > Content Types.",
                "Set SEO Title template to: %%title%% %%sep%% %%sitename%%",
                "Edit each post/page and set its SEO title in the Yoast meta box.",
                "Keep each title under 60 characters.",
            ],
            docsUrl: "https://yoast.com/how-to-set-an-seo-title/",
        },
        "nuxt": {
            title: "Fix: Title Tag (Nuxt 3)",
            steps: [
                "In nuxt.config.ts: app: { head: { titleTemplate: '%s | YourBrand' } }",
                "In each page, call useHead({ title: 'Page Title' }) inside setup().",
                "Run: nuxi build and inspect the HTML output for title length.",
            ],
            docsUrl: "https://nuxt.com/docs/api/composables/use-head",
        },
        "sveltekit": {
            title: "Fix: Title Tag (SvelteKit)",
            steps: [
                "In src/routes/+layout.svelte, add: <svelte:head><title>{title}</title></svelte:head>",
                "Pass the title from +layout.server.ts via PageData.",
                "In each +page.svelte, call: <svelte:head><title>Page Title</title></svelte:head>",
            ],
            docsUrl: "https://kit.svelte.dev/docs/seo#manual-setup-title-and-meta",
        },
        "astro": {
            title: "Fix: Title Tag (Astro)",
            steps: [
                "In src/layouts/BaseLayout.astro, use: <title>{title}</title> with a title prop.",
                "In each .astro page: <BaseLayout title='Page Title Under 60 Chars' />",
            ],
            docsUrl: "https://docs.astro.build/en/guides/seo/",
        },
        "react-vite": {
            title: "Fix: Title Tag (React + Vite)",
            steps: [
                "Install react-helmet-async: npm install react-helmet-async",
                "Wrap your app in <HelmetProvider> in main.tsx.",
                "In each page component: <Helmet><title>Page Title Under 60</title></Helmet>",
            ],
            docsUrl: "https://github.com/staylor/react-helmet-async",
        },
        "plain-html": {
            title: "Fix: Title Tag (HTML)",
            steps: [
                "Open index.html in a text editor.",
                "Inside <head>, update or add: <title>Your Brand — Short Description</title>",
                "Keep the text under 60 characters.",
            ],
        },
    },

    "meta-description": {
        _default: {
            title: "Fix: Meta Description Missing or Too Long",
            steps: [
                "Locate the <meta name='description'> tag in your site's head.",
                "Write a compelling description of 120–160 characters.",
                "Include the primary keyword naturally in the first half.",
                "End with a gentle CTA ('Learn more', 'Start free').",
                "Verify length before deploying.",
            ],
            docsUrl: "https://developers.google.com/search/docs/appearance/snippet",
        },
        "nextjs-app": {
            title: "Fix: Meta Description (Next.js App Router)",
            steps: [
                "In src/app/layout.tsx metadata export, add:\n```tsx\ndescription: 'Your 120–160 char description with keyword.'\n```",
                "Per page, export metadata with description in page.tsx.",
                "Verify: pnpm build → inspect HTML output.",
            ],
        },
        "wordpress": {
            title: "Fix: Meta Description (WordPress)",
            steps: [
                "Install Yoast SEO if not already installed.",
                "Edit each page/post → Yoast meta box → enter Meta description (120–160 chars).",
                "For the homepage: Yoast SEO > Search Appearance > General > Homepage description.",
            ],
        },
    },

    "canonical-tag": {
        _default: {
            title: "Fix: Canonical Tag Missing",
            steps: [
                "Add <link rel='canonical' href='https://yourdomain.com/current-page/'> to the <head>.",
                "Every page must have exactly ONE canonical tag.",
                "The canonical must match the preferred URL (with or without trailing slash — pick one).",
                "For paginated content, each page should self-canonicalize.",
            ],
            docsUrl: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
        },
        "nextjs-app": {
            title: "Fix: Canonical Tag (Next.js App Router)",
            steps: [
                "In root layout.tsx, set metadataBase:\n```tsx\nmetadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yoursite.com')\n```",
                "Add alternates.canonical: '/' to the root layout metadata.",
                "Each page.tsx exports alternates: { canonical: '/page-slug' }.",
                "Next.js resolves relative paths against metadataBase automatically.",
            ],
            docsUrl: "https://nextjs.org/docs/app/api-reference/functions/generate-metadata#alternates",
        },
        "wordpress": {
            title: "Fix: Canonical Tag (WordPress)",
            steps: [
                "Install Yoast SEO or RankMath — both add canonical tags automatically.",
                "Check Yoast SEO > Advanced tab for each page.",
                "For custom canonical: add to functions.php:\n```php\nadd_action('wp_head', function() {\n  echo '<link rel=\"canonical\" href=\"' . get_permalink() . '\" />';\n});\n```",
            ],
        },
    },

    "schema-organization": {
        _default: {
            title: "Fix: Missing Organization Schema",
            steps: [
                "Create a JSON-LD script block with @type: Organization.",
                "Include: name, url, logo.url, sameAs (social profiles), contactPoint.",
                "Place the script inside the <head> of every page.",
                "Validate at: https://validator.schema.org/",
                "Test rich results at: https://search.google.com/test/rich-results",
            ],
            docsUrl: "https://schema.org/Organization",
        },
        "nextjs-app": {
            title: "Fix: Organization Schema (Next.js App Router)",
            steps: [
                "In src/app/layout.tsx, add before </head>:\n```tsx\n<script\n  type='application/ld+json'\n  dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}\n/>\n```",
                "Define orgSchema as a const above the component.",
                "Validate using https://validator.schema.org/",
            ],
        },
        "wordpress": {
            title: "Fix: Organization Schema (WordPress)",
            steps: [
                "In functions.php, add:\n```php\nadd_action('wp_head', 'add_org_schema');\nfunction add_org_schema() {\n  $schema = array('@context'=>'https://schema.org','@type'=>'Organization','name'=>get_bloginfo('name'),'url'=>get_bloginfo('url'));\n  echo '<script type=\"application/ld+json\">' . json_encode($schema) . '</script>';\n}\n```",
            ],
        },
    },

    "schema-faq": {
        _default: {
            title: "Fix: FAQPage Schema Missing",
            steps: [
                "Create JSON-LD with @type: FAQPage containing mainEntity array.",
                "Each item: { @type: 'Question', name: 'Q?', acceptedAnswer: { @type: 'Answer', text: 'A.' } }",
                "Include 5–10 real questions from your site's FAQ or support content.",
                "Validate at https://search.google.com/test/rich-results",
            ],
            docsUrl: "https://developers.google.com/search/docs/appearance/structured-data/faqpage",
        },
    },

    "xml-sitemap": {
        _default: {
            title: "Fix: XML Sitemap Missing",
            steps: [
                "Create sitemap.xml in your public directory.",
                "Include all public-facing pages with <loc>, <lastmod>, <changefreq>, and <priority>.",
                "Submit to Google Search Console: Settings > Sitemaps.",
                "Submit to Bing Webmaster Tools.",
                "Add Sitemap: https://yourdomain.com/sitemap.xml to robots.txt.",
            ],
            docsUrl: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview",
        },
        "nextjs-app": {
            title: "Fix: XML Sitemap (Next.js App Router)",
            steps: [
                "Create src/app/sitemap.ts:",
                "```ts\nimport type { MetadataRoute } from 'next';\nexport default function sitemap(): MetadataRoute.Sitemap {\n  return [\n    { url: 'https://yoursite.com', lastModified: new Date(), priority: 1.0 },\n    // Add all pages\n  ];\n}\n```",
                "This auto-generates /sitemap.xml on build.",
                "Submit the URL to Google Search Console.",
            ],
            docsUrl: "https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap",
        },
        "wordpress": {
            title: "Fix: XML Sitemap (WordPress)",
            steps: [
                "Install Yoast SEO — it generates a sitemap automatically at /sitemap_index.xml",
                "Or install 'Google XML Sitemaps' plugin.",
                "Submit the sitemap URL to Google Search Console.",
            ],
        },
    },

    "robots-txt": {
        _default: {
            title: "Fix: robots.txt Configuration",
            steps: [
                "Create /public/robots.txt (or /robots.txt for static sites).",
                "Example:\n```\nUser-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /dashboard/\nSitemap: https://yourdomain.com/sitemap.xml\n```",
                "Never disallow your homepage or key landing pages.",
                "Verify at: https://www.google.com/webmasters/tools/robots-testing-tool",
            ],
            docsUrl: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
        },
    },

    "og-tags": {
        _default: {
            title: "Fix: Open Graph Tags Missing",
            steps: [
                "Add to <head>: og:title, og:description, og:type, og:url, og:image, og:site_name.",
                "og:title: same as <title>, under 60 chars.",
                "og:description: same as meta description, 120–160 chars.",
                "og:image: a 1200×630px image (use /og-image.png).",
                "Test with: https://developers.facebook.com/tools/debug/",
            ],
            docsUrl: "https://ogp.me/",
        },
    },

    "render-blocking-scripts": {
        _default: {
            title: "Fix: Render-Blocking Scripts",
            steps: [
                "Find all <script> tags in <head> without async or defer.",
                "For analytics scripts (GA, GTM): add async attribute.",
                "For non-critical scripts: add defer attribute.",
                "Move non-critical scripts to just before </body>.",
                "Critical scripts (app initialization) must stay synchronous.",
                "Verify with: PageSpeed Insights → Eliminate render-blocking resources.",
            ],
            docsUrl: "https://web.dev/render-blocking-resources/",
        },
    },

    "a11y-skip-nav": {
        _default: {
            title: "Fix: Skip Navigation Link (WCAG 2.1 SC 2.4.1)",
            steps: [
                "Add as the FIRST element inside <body>:\n```html\n<a href='#main-content' class='skip-nav'>Skip to main content</a>\n```",
                "Add id='main-content' to your <main> element.",
                "Add CSS to visually hide it until focused:\n```css\n.skip-nav { position: absolute; top: -100%; left: 0; }\n.skip-nav:focus { top: 0; }\n```",
            ],
            docsUrl: "https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks.html",
        },
    },

    "backlink-profile": {
        _default: {
            title: "Off-Page: Backlink Building Strategy",
            steps: [
                "1. GUEST POSTING: Target industry blogs and publications in your niche. Pitch data-driven angle using your product's unique insights.",
                "2. DIRECTORIES: Submit to Google Business Profile, Bing Places, Yelp, Apple Maps, Clutch (B2B), Capterra (software).",
                "3. DIGITAL PR: Publish an original research report or dataset. Reach out to journalists via HARO (Help A Reporter Out).",
                "4. INTERNAL LINKING: Add links from your blog posts to key product/service pages with keyword-rich anchor text.",
                "5. PARTNER LINKS: Reach out to technology partners for mutual mentions or integration listings.",
            ],
            manualOnly: true,
        },
    },

    "google-business-profile": {
        _default: {
            title: "Local SEO: Google Business Profile Setup",
            steps: [
                "Go to: https://business.google.com and sign in.",
                "Click 'Add your business to Google'.",
                "Enter business name, category, and location.",
                "Verify ownership via postcard, phone, or email.",
                "Add: description, photos (logo + cover + interior), hours, website, services.",
                "Enable Google Messaging.",
                "Post weekly updates to stay active.",
                "Request reviews from satisfied customers via the review link.",
            ],
            docsUrl: "https://support.google.com/business/answer/2911778",
            manualOnly: true,
        },
    },
};

// ── Generic fallback generator ────────────────────────────────────────────────

function generateGenericFallback(issueId: string, issueLabel: string): FallbackGuide {
    return {
        title: `Manual Fix: ${issueLabel}`,
        steps: [
            `This SEO issue (${issueId}) requires manual attention.`,
            "1. Identify which page(s) are affected.",
            "2. Research the specific fix for your framework using the Google Search Central documentation.",
            "3. Implement the fix and test using Google Search Console's URL Inspection tool.",
            "4. Validate structured data at https://validator.schema.org/",
            "5. Resubmit the page for indexing after applying the fix.",
        ],
        docsUrl: "https://developers.google.com/search/docs",
    };
}


export function getFallbackGuide(
    issueId: string,
    issueLabel: string,
    framework: Framework
): FallbackGuide {
    const fallbackMap = FALLBACKS[issueId];
    if (!fallbackMap) {
        return generateGenericFallback(issueId, issueLabel);
    }

    const frameworkGuide = fallbackMap[framework];
    const defaultGuide = fallbackMap._default;

    return frameworkGuide ?? defaultGuide ?? generateGenericFallback(issueId, issueLabel);
}

export const FALLBACK_ISSUE_IDS = Object.keys(FALLBACKS);
