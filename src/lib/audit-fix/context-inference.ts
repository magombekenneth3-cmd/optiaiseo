/**
 * context-inference.ts — Phase 1.4
 *
 * Extracted from auditFix.ts (lines 489–672).
 * Owns all framework detection and FrameworkContext resolution so
 * auditFix.ts becomes a thin orchestrator.
 */

import { detectFramework } from "@/lib/seo/ai";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FrameworkContext {
    name: string;
    allowedFiles: string[];
    forbidden: string;
    notes: string;
}

// ─── Framework map ───────────────────────────────────────────────────────────

const FRAMEWORK_MAP: Record<string, FrameworkContext> = {
    nextjs: {
        name: "Next.js 14 (App Router)",
        allowedFiles: [
            "public/robots.txt",
            "public/sitemap.xml",
            "app/layout.tsx — metadata export section ONLY (title, description, openGraph, twitter, verification, alternates)",
            "next.config.js — SEO headers/redirects ONLY",
        ],
        forbidden:
            "React hooks (useTheme, useContext, useState, etc.), UI components, CSS, API routes, /components folder, new npm packages",
        notes: [
            "Use Next.js Metadata API for all meta tags. Use app/sitemap.ts for dynamic sitemaps.",
            "CRITICAL — WILL BREAK THE BUILD: Never place 'jsonLd' or 'script' keys inside the metadata export object.",
            "For JSON-LD schema, ALWAYS use a <script type=\"application/ld+json\"> tag inside the component JSX return statement.",
            "Title tags must be under 60 characters. Meta descriptions must be under 160 characters.",
        ].join("\n"),
    },
    "react-vite": {
        name: "React + Vite (SPA)",
        allowedFiles: [
            "public/robots.txt",
            "public/sitemap.xml",
            "index.html — <head> section ONLY (meta tags, title, link tags)",
        ],
        forbidden:
            "React hooks, .tsx/.jsx component files, CSS/styling, any file outside public/ or index.html",
        notes:
            "React SPAs are not server-rendered. Meta tags go in index.html. For dynamic tags, recommend react-helmet or vite-plugin-html in existing setup — do not install new packages.",
    },
    vue: {
        name: "Vue 3 + Vite",
        allowedFiles: [
            "public/robots.txt",
            "public/sitemap.xml",
            "index.html — <head> section ONLY",
        ],
        forbidden:
            ".vue component files, Pinia/Vuex stores, router files, CSS, any file outside public/ or index.html",
        notes:
            "For dynamic meta in Vue, recommend @unhead/vue — do not install new packages, reference existing setup only.",
    },
    nuxt: {
        name: "Nuxt.js 3",
        allowedFiles: [
            "public/robots.txt",
            "public/sitemap.xml",
            "nuxt.config.ts — app.head section ONLY",
        ],
        forbidden: ".vue components, pages/, composables/, server/api/, CSS",
        notes:
            "Use nuxt.config.ts app.head for global meta. Nuxt has built-in @nuxtjs/sitemap and @nuxtjs/robots modules.",
    },
    angular: {
        name: "Angular",
        allowedFiles: [
            "public/robots.txt",
            "src/index.html — <head> section ONLY",
        ],
        forbidden: "Angular components, services, modules, routing, CSS",
        notes:
            "For dynamic meta in Angular use Meta and Title services from @angular/platform-browser — reference existing usage, do not restructure.",
    },
    html: {
        name: "Plain HTML / Static Site",
        allowedFiles: [
            "robots.txt",
            "sitemap.xml",
            "Any .html file — <head> section ONLY",
        ],
        forbidden:
            "Inline styles, JavaScript logic, backend files, content outside <head>",
        notes:
            "Static sitemap.xml must list all pages manually. robots.txt should reference the sitemap URL.",
    },
    wordpress: {
        name: "WordPress",
        allowedFiles: [],
        forbidden:
            "PHP files, plugins, wp-config.php — do NOT generate code for WordPress",
        notes:
            "WordPress SEO is managed via plugins (Yoast, RankMath). Provide step-by-step instructions only — no code output.",
    },
    other: {
        name: "Other / Unknown Framework",
        allowedFiles: [
            "public/robots.txt",
            "public/sitemap.xml",
            "index.html or equivalent — <head> only",
        ],
        forbidden:
            "Framework-specific component files, CSS, backend/server files",
        notes: "Generate generic, framework-agnostic SEO fixes only.",
    },
};

// ─── Prompt hints ─────────────────────────────────────────────────────────────

const FRAMEWORK_PROMPT_HINTS: Record<string, string> = {
    "Next.js 14 (App Router)": [
        "You are writing for Next.js 14 App Router. Use the Metadata API exclusively — never use <Head> from next/head.",
        "The Metadata type accepts ONLY: title, description, openGraph, twitter, alternates, icons, verification, robots, keywords, authors, category, metadataBase.",
        "JSON-LD schema MUST be a <script type=\"application/ld+json\"> tag in JSX — NEVER a key in the metadata export.",
        "Do not use useState, useEffect, or any React hook. These files are server components.",
    ].join("\n"),
    "React + Vite (SPA)": [
        "You are writing for a React SPA. There is no server rendering.",
        "All meta tags go in index.html inside the <head>. Do not generate .jsx or .tsx files.",
        "Do not import React or use any hooks.",
    ].join("\n"),
    WordPress: [
        "WordPress SEO is plugin-managed. Do NOT generate any PHP or code.",
        "Provide step-by-step instructions for Yoast SEO or RankMath plugin settings only.",
    ].join("\n"),
};

// ─── Public API ───────────────────────────────────────────────────────────────

const FW_TO_STACK: Record<string, string> = {
    "nextjs-app": "nextjs",
    "nextjs-pages": "nextjs",
    nuxt: "nuxt",
    sveltekit: "other",
    astro: "other",
    "react-vite": "react-vite",
    wordpress: "wordpress",
    "plain-html": "html",
};

/**
 * Resolves the FrameworkContext for a site.
 * Probes GitHub repo (if linked) then falls back to stored techStack.
 */
export async function resolveFrameworkContext(site: {
    techStack?: string | null;
    githubRepoUrl?: string | null;
}): Promise<FrameworkContext> {
    let detectedStack = site?.techStack;

    if (site?.githubRepoUrl) {
        try {
            const detected = await detectFramework(site.githubRepoUrl);
            if (detected.framework !== "unknown") {
                detectedStack = FW_TO_STACK[detected.framework] ?? site.techStack;
            }
        } catch {
            // Non-fatal — fall back to stored techStack
        }
    }

    return buildFrameworkContext(detectedStack);
}

export function buildFrameworkContext(
    techStack: string | null | undefined,
): FrameworkContext {
    return FRAMEWORK_MAP[techStack ?? "nextjs"] ?? FRAMEWORK_MAP["other"];
}

export function buildFrameworkPromptHints(frameworkCtx: FrameworkContext): string {
    return (
        FRAMEWORK_PROMPT_HINTS[frameworkCtx.name] ??
        `You are writing for ${frameworkCtx.name}. Follow standard SEO best practices for this framework.`
    );
}
