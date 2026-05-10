import { logger } from "@/lib/logger";


import type { Framework, SiteContent } from "./ai";

export interface PromptContext {
    issueId: string;
    issueLabel: string;
    issueDetail?: string;
    issueRecommendation?: string;
    domain: string;
    content: SiteContent;
    framework: Framework;
    filePath: string;
    userContext?: Record<string, string>;
}


const FRAMEWORK_RULES: Record<Framework, string> = {
    "nextjs-app": `
FRAMEWORK: Next.js App Router
SYNTAX RULES:
- Use 'export const metadata: Metadata = { ... }' in layout.tsx or page.tsx for all meta tags
- Use 'alternates: { canonical: "/" }' for canonical tags — NOT a raw <link> tag
- CRITICAL ERROR AVOIDANCE: The metadata object does NOT support 'jsonLd' or 'script'. NEVER put jsonLd inside metadata.
- For JSON-LD schemas, inject via: <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} /> inside the React component JSX
- Never use React Helmet — it is incompatible with App Router
- Use next/image for all images, never <img>
- Import type { Metadata } from "next"
- metadataBase must be set for OG images to resolve correctly`.trim(),

    "nextjs-pages": `
FRAMEWORK: Next.js Pages Router
SYNTAX RULES:
- Use next/head: import Head from "next/head" for all meta tags
- For canonical: <link rel="canonical" href="..." />
- For JSON-LD: use <Script type="application/ld+json" strategy="afterInteractive">
- Import Script from "next/script"
- Use getServerSideProps or getStaticProps for dynamic meta`.trim(),

    "nuxt": `
FRAMEWORK: Nuxt 3
SYNTAX RULES:
- Use useHead({ title: "...", meta: [{ name: "description", content: "..." }] }) composable
- For canonical: useHead({ link: [{ rel: "canonical", href: "..." }] })
- For JSON-LD: <script type="application/ld+json" v-html="JSON.stringify(schema)" /> inside <template>
- Never use document.head directly
- Use defineOgMeta() for Open Graph when available`.trim(),

    "sveltekit": `
FRAMEWORK: SvelteKit
SYNTAX RULES:
- Use <svelte:head> block inside .svelte files for all meta tags
- For canonical: <link rel="canonical" href="{canonicalUrl}" /> inside <svelte:head>
- For JSON-LD: <script type="application/ld+json">{JSON.stringify(schema)}</script> inside <svelte:head>
- Export let data from load() for server-rendered meta`.trim(),

    "astro": `
FRAMEWORK: Astro
SYNTAX RULES:
- Place all meta tags and JSON-LD inside the <head> section of the .astro file
- Use <link rel="canonical" href={canonicalUrl} />
- For JSON-LD: <script type="application/ld+json" set:html={JSON.stringify(schema)} />
- Use Astro.props for passing dynamic values to layout components`.trim(),

    "wordpress": `
FRAMEWORK: WordPress
IMPORTANT: WordPress requires manual implementation. This is a step-by-step guide, NOT generated code.
Use Yoast SEO or RankMath plugin for most on-page SEO tasks — they have GUI interfaces.
For custom schema, add to functions.php via the wp_head action hook.`.trim(),

    "react-vite": `
FRAMEWORK: React + Vite
SYNTAX RULES:
- Use react-helmet-async: import { Helmet } from "react-helmet-async"
- Wrap app in <HelmetProvider> in main.tsx
- For canonical: <Helmet><link rel="canonical" href="..." /></Helmet>
- For JSON-LD: <Helmet><script type="application/ld+json">{JSON.stringify(schema)}</script></Helmet>
- Never use document.title directly in components`.trim(),

    "plain-html": `
FRAMEWORK: Plain HTML
SYNTAX RULES:
- Place all meta tags inside the <head> element
- Use <link rel="canonical" href="..." /> for canonical
- For JSON-LD: <script type="application/ld+json">{ ... }</script> inside <head>
- All href and src values must be absolute URLs`.trim(),

    "unknown": `
FRAMEWORK: Unknown (generic HTML output)
Note: Framework could not be detected from the repository. Output generic HTML.
Add a comment at the top of the code noting the framework should be adapted.`.trim(),
};

const HARD_CONSTRAINTS = `
HARD CONSTRAINTS — NEVER VIOLATE:
1. NEVER use placeholder values like: yourdomain.com, example.com, "Your Business Name", "Your City", "000-000-0000", "yoursite.com"
2. Use ONLY the real brand and domain provided in the context below
3. Title tags MUST be under 60 characters total
4. Meta descriptions MUST be between 120 and 160 characters
5. All JSON-LD must be valid JSON — parseable by JSON.parse() with no errors
6. Return ONLY the code for the target file. No explanation, no markdown fences, no comments outside the code.
7. CODE QUALITY & NORMS: The generated code MUST be perfectly formatted, follow well-known web and accessibility norms, and NEVER break the user's application logic or build process.
8. PRESERVATION OF UI/UX: Do NOT alter, add, or remove any structural layouts, component styling (CSS/Tailwind classes), visual design schemas, core application logic, or user experience (UX) elements. Focus strictly on SEO, AEO, headings, alt text, and semantic content updates without changing the page's visual appearance or core functionality.`;


const SURGICAL_LAYOUT_RULES = `
SURGICAL OUTPUT RULES — MANDATORY FOR LAYOUT.TSX:
- Output ONLY the \`export const metadata: Metadata = { ... };\` block
- Do NOT output any import statements — they already exist in the file
- Do NOT output any function, class, or JSX — must not be touched
- CRITICAL ERROR AVOIDANCE: Do NOT include \`jsonLd:\` or \`script:\` — they are NOT valid Next.js Metadata fields and will cause a build failure.
- Do NOT include \`verification: { google: "YOUR_..." }\` — only include verification if you have the real token
- The pipeline will surgically merge this block into the existing file. Output nothing else.`.trim();

function buildContext(ctx: PromptContext): string {
    const brand = ctx.content.title || ctx.domain.replace(/^www\./, "").split(".")[0];
    const lines = [
        `SITE DOMAIN: ${ctx.domain}`,
        `BRAND NAME: ${brand}`,
        `PAGE TITLE: ${ctx.content.title}`,
        ctx.content.description ? `SITE DESCRIPTION: ${ctx.content.description}` : "",
        ctx.content.headings.length ? `PAGE HEADINGS: ${ctx.content.headings.slice(0, 8).join(" | ")}` : "",
        ctx.content.paragraphs.length ? `SAMPLE CONTENT: ${ctx.content.paragraphs.slice(0, 3).join(" ... ")}` : "",
        ctx.content.keywords.length ? `META KEYWORDS: ${ctx.content.keywords.join(", ")}` : "",
        `TARGET FILE: ${ctx.filePath}`,
    ];

    // Append user-provided context fields
    if (ctx.userContext) {
        for (const [key, val] of Object.entries(ctx.userContext)) {
            if (val?.trim()) lines.push(`${key.toUpperCase()}: ${val.trim().slice(0, 500)}`);
        }
    }

    return lines.filter(Boolean).join("\n");
}

const PROMPTS: Record<string, (ctx: PromptContext) => string> = {

    "title-tag": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}
${ctx.filePath.endsWith("layout.tsx") ? SURGICAL_LAYOUT_RULES : ""}

TASK: Generate a new title and meta description for this website.
- Title MUST be under 60 characters. Keep the brand name and primary keyword.
- Description MUST be between 120 and 160 characters.
- Use ONLY the brand and domain from CONTEXT below — never invent a different brand.

CONTEXT:
${buildContext(ctx)}

${ctx.filePath.endsWith("layout.tsx")
            ? "Return ONLY the `export const metadata: Metadata = { ... };` block. Nothing else."
            : `Return ONLY the complete updated file content for ${ctx.filePath}.`
        }`,

    "meta-description": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}
${ctx.filePath.endsWith("layout.tsx") ? SURGICAL_LAYOUT_RULES : ""}

TASK: Write a compelling meta description for this website.
- MUST be between 120 and 160 characters
- Use the real brand name and a clear value proposition
- Never use generic filler like "Welcome to our website"
- Use ONLY the brand and domain from CONTEXT below

CONTEXT:
${buildContext(ctx)}

${ctx.filePath.endsWith("layout.tsx")
            ? "Return ONLY the `export const metadata: Metadata = { ... };` block. Nothing else."
            : `Return ONLY the complete updated file content for ${ctx.filePath}.`
        }`,

    "canonical-tag": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}
${ctx.filePath.endsWith("layout.tsx") ? SURGICAL_LAYOUT_RULES : ""}

TASK: Add a canonical URL to the metadata. Use the domain exactly as provided — no yourdomain or example.com.

CONTEXT:
${buildContext(ctx)}

${ctx.filePath.endsWith("layout.tsx")
            ? "Return ONLY the `export const metadata: Metadata = { ... };` block. Nothing else."
            : `Return ONLY the complete updated file content for ${ctx.filePath}.`
        }`,

    "header-tag-strategy": (ctx) => `You are a senior SEO engineer and accessibility expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Optimize the heading hierarchy (H1 → H2 → H3) to boost SERP clicks and clearly structure the page.
- Exactly ONE H1 on the page containing the primary keyword.
- Replace generic H2 headings (like "Introduction" or "Overview") with keyword-rich, question-based, or benefit-driven headings to capture featured snippets.
- H3 headings for sub-items only.
- Never skip from H1 to H3.
- Do not change the overall visible text meaning, just the heading phrasing and structure.

CONTEXT:
${buildContext(ctx)}

Return ONLY the corrected ${ctx.filePath} content.`,

    "internal-linking-assistant": (ctx) => `You are a senior SEO architecture engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Identify opportunities for 5–10 new internal links to maximize link equity flow.
- Ensure links connect topically relevant pages (hub and spoke model).
- Use highly descriptive anchor text containing target keywords — never "click here" or "read more".
- Target pages that likely exist based on the site's context.
- Place links contextually within paragraphs where they add value, not just shoved at the end.

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated component or navigation snippet for ${ctx.filePath}.`,

    "image-alt-tags": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Add descriptive alt attributes to all images that are missing them. Alt text must:
- Describe the image content precisely
- Include a relevant keyword where natural
- Be under 125 characters
- Never be "image", "photo", or the filename

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated ${ctx.filePath} content.`,

    "og-tags": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}
${ctx.filePath.endsWith("layout.tsx") ? SURGICAL_LAYOUT_RULES : ""}

TASK: Add complete Open Graph metadata:
- og:title (same as title, under 60 chars)
- og:description (same as meta description, 120–160 chars)
- og:type (website for homepage, article for blog posts)
- og:url (canonical URL — use the REAL domain from context)
- og:image (absolute URL only — if unknown, omit the field entirely rather than using a placeholder path)
- og:site_name (exact brand name from context)

CONTEXT:
${buildContext(ctx)}

${ctx.filePath.endsWith("layout.tsx")
            ? "Return ONLY the `export const metadata: Metadata = { ... };` block. Nothing else."
            : `Return ONLY the complete updated file content for ${ctx.filePath}.`
        }`,

    "twitter-cards": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}
${ctx.filePath.endsWith("layout.tsx") ? SURGICAL_LAYOUT_RULES : ""}

TASK: Add Twitter Card meta tags:
- twitter:card = "summary_large_image"
- twitter:title (under 60 chars)
- twitter:description (120–160 chars)
- twitter:image (absolute URL only — if unknown, omit the field entirely)
- twitter:site (realistic handle based on brand name, prefixed with @)

CONTEXT:
${buildContext(ctx)}

${ctx.filePath.endsWith("layout.tsx")
            ? "Return ONLY the `export const metadata: Metadata = { ... };` block. Nothing else."
            : `Return ONLY the complete updated file content for ${ctx.filePath}.`
        }`,

    "hreflang": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Add hreflang link tags for international SEO. Include:
- x-default pointing to the canonical URL
- en (English) pointing to the canonical URL
- Any additional locales specified in user context

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete updated file content for ${ctx.filePath}.`,


    "content-decay-detector": (ctx) => `You are a senior SEO content strategist.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: This page appears to be suffering from content decay (outdated information, dropping rankings).
Write a Content Refresh Blueprint to update the page. Focus on:
1. Identifying stale statistics or outdated facts to replace.
2. Adding a new section explaining recent developments in the topic.
3. Adding an "Updated [Current Year]" badge or text.
4. Ensuring E-E-A-T signals are strong (author credibility, expert quotes).

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated file content for ${ctx.filePath}.`,

    "search-intent-mapper": (ctx) => `You are a senior SEO intent specialist.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: This page has a search intent mismatch. The content does not perfectly align with what users are looking for when searching its primary keywords.
Re-write the introduction and modify the H2 structures to immediately satisfy user intent (Informational, Transactional, Navigational, or Commercial Investigation).
- If informational, provide a clear, direct answer immediately.
- If transactional, reduce friction to the call-to-action.
- Use explicit semantic keywords clusters related to the intent.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete updated file content for ${ctx.filePath}.`,


    "robots-txt": (ctx) => `You are a senior SEO engineer.
${HARD_CONSTRAINTS}

TASK: Generate a production-ready robots.txt file. Rules:
- Allow all crawlers access to public pages
- Disallow these paths: /api/, /dashboard/, /admin/, /_next/
- Include Sitemap: directive pointing to the sitemap URL
- Add a Crawl-delay: 1 for all bots

DOMAIN: ${ctx.domain}

Return ONLY the complete robots.txt file content. No explanation.`,

    "xml-sitemap": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a complete XML sitemap or sitemap.ts/sitemap.xml.tsx for this website. Include:
- Homepage (priority 1.0, weekly)
- /about, /contact, /pricing, /blog (priority 0.8, monthly)
- /login, /signup (priority 0.5, monthly, if they exist)
- /terms, /privacy (priority 0.3, yearly)
- changefreq and lastmod on every URL

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}.`,

    "render-blocking-scripts": (ctx) => `You are a senior performance SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Fix render-blocking scripts by:
- Adding defer to all non-critical scripts
- Adding async to fully independent scripts (analytics, heatmaps)
- Any Google Analytics or GTM script must use async
- Never add async/defer to critical scripts that initialize app state

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated ${ctx.filePath} with fixed script tags. Show the before/after as inline comments.`,

    "core-web-vitals": (ctx) => `You are a senior performance SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Add Core Web Vitals optimizations:
- LCP: Add fetchpriority="high" to the hero image; add <link rel="preload"> for critical resources
- CLS: Add explicit width and height to all images; add min-height to skeleton loaders
- FID/INP: Move non-critical event handlers to after load

CONTEXT:
${buildContext(ctx)}

Return ONLY the optimized ${ctx.filePath}.`,

    "mobile-friendly": (ctx) => `You are a senior SEO and UX engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Ensure the site is mobile-friendly:
- Add/fix viewport meta tag: <meta name="viewport" content="width=device-width, initial-scale=1">
- Ensure tap targets are at least 48×48px
- Remove any horizontal scrolling
- Use relative units (rem, %, vw) not fixed pixel widths on containers

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated ${ctx.filePath}.`,

    "https-redirect": (_ctx) => `You are a senior infrastructure and SEO engineer.

TASK: Provide the configuration to redirect all HTTP traffic to HTTPS. Output the correct config for the most common hosting providers as a comment-annotated snippet:
1. Vercel (vercel.json redirects)
2. Netlify (_redirects file)
3. Nginx (server block)
4. Apache (.htaccess)

Return ONLY the configuration snippets with clear comments labelling each platform. No explanation outside the code.`,


    "schema-organization": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a standalone React component that renders an Organization JSON-LD schema script.

OUTPUT FORMAT (Next.js App Router — standalone component, NOT a layout.tsx edit):
\`\`\`tsx
export default function SchemaOrganization() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "<REAL brand name from context>",
    "url": "<REAL domain from context>",
    "logo": { "@type": "ImageObject", "url": "<domain>/favicon.ico" },
    "sameAs": [ /* real-looking social URLs based on brand name */ ]
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
\`\`\`

RULES:
- The component MUST be self-contained — no props needed
- Use ONLY the real brand name and domain from CONTEXT — no placeholders
- sameAs URLs must be based on the real brand name (e.g. https://twitter.com/brandname)
- Do NOT include logo URL as a placeholder — use /favicon.ico if no real logo is known

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}. No explanation.`,

    "schema-website": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a standalone React component that renders a WebSite JSON-LD schema script.

OUTPUT FORMAT (Next.js App Router — standalone component, NOT a layout.tsx edit):
\`\`\`tsx
export default function SchemaWebsite() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "<REAL brand name from context>",
    "url": "<REAL domain from context>",
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "<domain>/search?q={search_term_string}"
      },
      "query-input": "required name=search_term_string"
    }
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
\`\`\`

RULES:
- The component MUST be self-contained — no props needed
- Use ONLY the real brand name and domain from CONTEXT — never invent a brand
- urlTemplate must use the REAL domain from context — not localhost or example.com
- Do NOT modify layout.tsx — this is a standalone component file

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}. No explanation.`,

    "schema-faq": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a FAQPage JSON-LD schema. Use REAL questions that visitors of this specific site would ask. Base questions on the actual headings and content — not generic questions.
- Include exactly 5 questions with concise answers
- Each answer must be under 300 characters
- Use the real brand name in answers where natural

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-howto": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a HowTo JSON-LD schema for the main action a user takes on this site. Make steps specific to this product/service — not generic. Include 4–6 steps.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-article": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate an Article JSON-LD schema. Use the real brand as publisher. Include:
- @type: Article
- headline (under 60 chars)
- description (120–160 chars)
- author (Person or Organization)
- publisher (Organization with logo)
- datePublished and dateModified (use today's date)

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-breadcrumb": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a BreadcrumbList JSON-LD schema. Based on the site structure inferred from headings and URLs, create a realistic breadcrumb trail (2–4 items). Item 1 is always the homepage.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-local-business": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a LocalBusiness JSON-LD schema. Must include:
- @type: LocalBusiness (or more specific type if industry is known)
- name, url, telephone, address object with streetAddress, addressLocality, addressRegion, postalCode, addressCountry
- openingHoursSpecification if hours are known
- geo with latitude/longitude if address is known

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-product": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a Product JSON-LD schema based on the product described on this site. Include:
- name, description, brand, sku (use generic if unknown)
- offers with price, priceCurrency, availability

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-review": (ctx) => `You are a senior schema.org expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate an AggregateRating + Review JSON-LD schema. Create realistic review data based on what the product offers. Use real-sounding reviewer names. Rating out of 5.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "schema-speakable": (ctx) => `You are a senior schema.org and AEO expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a Speakable JSON-LD schema. This tells AI assistants (Google, Alexa, ChatGPT) which page sections to read aloud. Target the H1, first paragraph, and any FAQ sections.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,


    "nap-consistency": (ctx) => `You are a senior local SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate consistent NAP (Name, Address, Phone) markup for the site footer and a LocalBusiness schema. Ensure the NAP format is identical everywhere on the site.

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated ${ctx.filePath} with NAP-consistent footer markup AND the LocalBusiness JSON-LD.`,

    "local-schema": (ctx) => `You are a senior local SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a complete LocalBusiness JSON-LD with geo coordinates, opening hours, and all available contact details. Use PostalAddress schema for the address object.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content.`,

    "map-embed": (_ctx) => `You are a senior local SEO engineer.

TASK: Generate a Google Maps embed iframe. Use the address provided in context below.
- Set width="100%" height="400" style="border:0;" loading="lazy" allowfullscreen
- Use the standard Google Maps embed URL format
- Include a fallback link for users who block iframes

${_ctx.userContext?.address ? `ADDRESS: ${_ctx.userContext.address}` : "⚠ No address provided — output a commented template with placeholder coordinates."}

Return ONLY the HTML iframe snippet.`,

    "google-business-profile": (_ctx) => `You are a senior local SEO strategist.

TASK: Provide a step-by-step checklist for setting up and optimizing a Google Business Profile for this site. Include:
1. Claim/verify the profile
2. Add business categories
3. Upload photos (logo, cover, interior)
4. Add services and products
5. Enable messaging
6. Set up post schedule
7. Request review strategy

Format as a numbered markdown checklist with checkboxes. Return ONLY the checklist.`,

    "local-directories": (_ctx) => `You are a senior local SEO strategist.

TASK: Generate a prioritized directory submission checklist. For each directory, provide the submission URL and importance level (High/Medium).

Directories to include:
- Google Business Profile (High)
- Bing Places (High)
- Apple Maps (High)
- Yelp Business (High)
- Facebook Business (High)
- Yellow Pages (Medium)
- Foursquare (Medium)
- Angi (Medium, for service businesses)
- BBB (Medium)
- Manta (Low)
- Hotfrog (Low)

Return ONLY the formatted markdown checklist.`,


    "ai-overview-optimizer": (ctx) => `You are a highly specialized AEO (Answer Engine Optimization) expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Generate a conversational Q&A schema and content block specifically tailored to rank in AI Overviews (Gemini, ChatGPT, Perplexity).
- Use natural, conversational phrasing that a user would type or speak to an AI.
- Provide a direct, factual, and unbiased answer in the first 2 sentences.
- Follow up with bullet points for easy AI extraction.
- Include a JSON-LD FAQPage schema with the exact questions and answers inside the component.

CONTEXT:
${buildContext(ctx)}

Return ONLY the updated ${ctx.filePath} content incorporating the Q&A block and schema.`,


    "entity-density": (ctx) => `You are a senior SEO/AEO expert specializing in Knowledge Graph optimization.
${HARD_CONSTRAINTS}

TASK: Write a dense "Entity Relationship Description" paragraph — under 150 words — that explicitly states:
1. Exactly what this company/product/service IS
2. What industry or category it belongs to
3. Who it serves (target audience)
4. Key related entities, technologies, or concepts it interacts with
5. What problem it solves

Use <strong> around the brand name and core category. This will be used as a dedicated section on the homepage to help AI answer engines categorize this brand.

CONTEXT:
${buildContext(ctx)}

Return ONLY the HTML <p> block. No explanation.`,

    // AEO aliases used in the existing system:
    "content_entity_density": (ctx) => PROMPTS["entity-density"](ctx),

    "micro-answers": (ctx) => `You are a senior AEO (Answer Engine Optimization) expert.
${HARD_CONSTRAINTS}

TASK: Identify the 3 most likely questions users ask about this brand/product on Google. For each question, write a direct, factual answer in 1–2 sentences. Format them as structured Q&A blocks. This will be embedded on the page to enable zero-click answer features.

CONTEXT:
${buildContext(ctx)}

Return ONLY the HTML block:
<div class="micro-answers">
  <div class="qa-pair"><h4>Q: [Question]</h4><p><strong>Short Answer:</strong> [1-2 sentence answer]</p></div>
  ... (3 total)
</div>`,

    "content_micro_answers": (ctx) => PROMPTS["micro-answers"](ctx),

    "definitions-section": (ctx) => `You are a senior SEO content strategist.
${HARD_CONSTRAINTS}

TASK: Write a "What is [Brand/Product]?" definitional section. This helps AI engines and users understand the entity. Requirements:
- First sentence must be a clear, concise definition (under 25 words)
- Follow with 2–3 sentences expanding on features and benefits
- Use the real brand name — never "your company"
- Include the primary category keyword in the first sentence

CONTEXT:
${buildContext(ctx)}

Return ONLY the HTML <section> block with an <h2> and <p> tags.`,

    "content_definitions": (ctx) => PROMPTS["definitions-section"](ctx),

    "faq-section": (ctx) => `You are a senior AEO content expert.
${HARD_CONSTRAINTS}

TASK: Write a FAQ section with 5 real questions visitors of this site would ask. Use <details>/<summary> HTML for progressive disclosure. Requirements:
- Questions must be specific to this brand/product/service — not generic
- Answers must be factual and concise (under 100 words each)
- Include the primary keyword in at least 2 of the questions

CONTEXT:
${buildContext(ctx)}

Return ONLY the HTML <section> block:
<section class="faq-section">
  <h2>Frequently Asked Questions</h2>
  <details><summary>[Question]</summary><p>[Answer]</p></details>
  ...
</section>`,

    "content_faq_section": (ctx) => PROMPTS["faq-section"](ctx),

    "statistics-citations": (ctx) => `You are a senior AEO content strategist.
${HARD_CONSTRAINTS}

TASK: Generate 4–5 punchy, specific statistics or citation-ready facts about the problem this brand/product solves or its market segment. Requirements:
- Each fact must be specific (percentages, dollar amounts, time values)
- Attribute each to a realistic source category (e.g. "industry research", "SEO studies")
- Never fabricate specific organization names or paper titles
- Format as a bulleted list inside a <ul> with <li> tags

CONTEXT:
${buildContext(ctx)}

Return ONLY the HTML <ul> block.`,

    "content_statistics": (ctx) => PROMPTS["statistics-citations"](ctx),

    "table-of-contents": (ctx) => `You are a senior content strategist.
${HARD_CONSTRAINTS}

TASK: Generate a Table of Contents based on the page headings below. Use anchor links matching the heading IDs (lowercase, hyphens). Include only H2 and H3 level headings.

CONTEXT:
${buildContext(ctx)}

Return ONLY the HTML <nav aria-label="Table of contents"> block with an ordered list of anchor links.`,

    "content_toc": (ctx) => PROMPTS["table-of-contents"](ctx),

    "speakable-schema": (ctx) => PROMPTS["schema-speakable"](ctx),

    "knowledge-panel-entity": (ctx) => `You are a senior Knowledge Graph and entity SEO expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Create the combined entity schema bundle needed to trigger a Google Knowledge Panel:
1. Organization schema with sameAs social profiles
2. WebSite schema with SearchAction
3. Person schema for the founder (if brand is personal)
Include all three as separate JSON-LD scripts.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete ${ctx.filePath} content with all three schemas injected.`,


    "backlink-profile": (ctx) => `You are a senior link-building strategist.

TASK: Provide a concrete, actionable off-page link-building strategy for this brand. Include:

1. GUEST POSTING TARGETS: List 5 realistic publication categories (not specific sites) relevant to this niche, with pitch angle suggestions.

2. DIRECTORY SUBMISSIONS: List 8 high-authority directories relevant to this niche.

3. INTERNAL LINKING AUDIT: Based on the detected headings, suggest 5 specific internal link opportunities (source page → target page with anchor text).

4. DIGITAL PR HOOKS: Suggest 3 data-driven story angles this brand could use for press coverage.

CONTEXT:
${buildContext(ctx)}

Return ONLY the formatted markdown strategy guide.`,

    "social-profile-links": (ctx) => `You are a senior technical SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Add rel="me" social profile links to the <head> for profile verification, and sameAs links in the Organization JSON-LD. Social profiles to include (based on brand name):
- Twitter/X profile
- LinkedIn company page
- GitHub organization
- Facebook page

Use realistic URLs based on the actual brand name.

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete updated ${ctx.filePath}.`,

    "external-links": (ctx) => `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Audit and fix all external links. Ensure:
- All outbound links use rel="noopener noreferrer" (security)
- Links to low-authority or unrelated sites use rel="nofollow"
- Partner/sponsor links use rel="sponsored"
- All external links open in target="_blank"

CONTEXT:
${buildContext(ctx)}

Return ONLY the corrected ${ctx.filePath} with fixed link attributes.`,


    "eeat_about": (ctx) => `You are a senior content strategist and SEO copywriter.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Write a complete /about page for this company. Requirements:
- Opening paragraph: What the company does and who it serves (real brand name)
- Mission statement section
- "Why choose us" section with 3–4 specific differentiators based on the detected content
- Team/founder section (generic but believable)
- A clear call-to-action at the bottom

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}.`,

    "eeat_author": (ctx) => PROMPTS["eeat_about"](ctx),

    "eeat_contact": (ctx) => `You are a senior UX and SEO content writer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Write a complete /contact page. Include:
- A contact form with fields: name, email, subject, message
- All form inputs must have proper <label> elements (a11y)
- All form inputs must have unique id attributes
- A brief introductory paragraph with the real brand name
- A section with hypothetical contact details formatted consistently
- Add LocalBusiness ContactPoint schema

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}.`,

    "eeat_privacy": (ctx) => `You are a privacy law and SEO expert.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Write a production-ready privacy policy for this website. Cover these sections:
1. What information is collected
2. How it is used
3. Cookies and tracking
4. Third-party services (Stripe, Google Analytics, etc. — based on detected integrations)
5. Data retention
6. User rights (GDPR, CCPA)
7. Contact information for privacy requests
8. Last updated date (use current month/year)

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}.`,

    "tech_canonical": (ctx) => PROMPTS["canonical-tag"](ctx),
    "tech_sitemap": (ctx) => PROMPTS["xml-sitemap"](ctx),
    "schema_faq": (ctx) => PROMPTS["schema-faq"](ctx),
    "schema_howto": (ctx) => PROMPTS["schema-howto"](ctx),
    "schema_article": (ctx) => PROMPTS["schema-article"](ctx),
    "schema_speakable": (ctx) => PROMPTS["schema-speakable"](ctx),
    "schema_organization": (ctx) => PROMPTS["schema-organization"](ctx),
};

/**
 * Builds a prompt for the given issue context.
 * Always returns a valid prompt string — uses a generic fallback if no template exists.
 */
export function buildPrompt(ctx: PromptContext): string {
    const templateFn = PROMPTS[ctx.issueId];
    if (templateFn) {
        return templateFn(ctx);
    }

    // Generic fallback prompt
    logger.warn(`[seo-prompts] No template for issue: ${ctx.issueId} — using generic fallback`);
    return `You are a senior SEO engineer.
${FRAMEWORK_RULES[ctx.framework]}
${HARD_CONSTRAINTS}

TASK: Fix the following SEO issue on a ${ctx.framework} site.
ISSUE: ${ctx.issueLabel}
${ctx.issueDetail ? `DETAIL: ${ctx.issueDetail}` : ""}
${ctx.issueRecommendation ? `RECOMMENDATION: ${ctx.issueRecommendation}` : ""}

CONTEXT:
${buildContext(ctx)}

Return ONLY the complete file content for ${ctx.filePath}. No explanation.`;
}

/** List of all issue IDs that have prompt templates. */
export const SUPPORTED_ISSUE_IDS = Object.keys(PROMPTS);
