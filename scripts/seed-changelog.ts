/**
 * Seed the Changelog table from CHANGES.md historical entries.
 * Run: npx tsx scripts/seed-changelog.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const entries = [
    {
        version: "1.0.1",
        title: "Missing og-image.png — social sharing restored",
        category: "fix",
        description:
            "Added a branded 1200×630 SVG source for og-image generation. Run `node scripts/generate-og-image.js` to produce the PNG, or use @vercel/og for dynamic per-page OG images.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Placeholder social links in footer replaced",
        category: "fix",
        description:
            "Footer now links to the correct twitter.com/aiseoseo and github.com/aiseoseo handles instead of placeholder values.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Stripe webhook — silent FREE downgrade hardened",
        category: "security",
        description:
            "getTierFromPriceId now returns __UNKNOWN__ sentinel (not FREE) for unrecognised price IDs. A new assertKnownTier() guard halts webhook processing and logs a CRITICAL alert instead of silently downgrading paying users. STRIPE_PRO_PRICE_ID / STRIPE_AGENCY_PRICE_ID are now validated at startup.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Mobile nav hamburger menu added to landing page",
        category: "improvement",
        description:
            "Added Menu / X icons, mobileNavOpen state, body scroll lock, and Escape key handler. Full-width right-side drawer with all nav links, Log in, and Get Started CTA. Desktop nav links remain hidden on mobile.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Skip-nav accessibility link now renders correctly",
        category: "fix",
        description:
            "Added <a href=\"#main-content\" class=\"skip-nav\">Skip to main content</a> as the first child of ClientLayout.tsx. The #main-content anchor already existed in the dashboard — now correctly linked.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "card-surface hover visible in light mode",
        category: "fix",
        description:
            "Changed base hover border-color from rgba(255,255,255,0.1) (invisible on white) to rgba(0,0,0,0.15). Dark mode override remains unchanged.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Notifications — real API + dynamic TopHeader",
        category: "feature",
        description:
            "/api/notifications now queries Prisma for recent completed audits, pending blog reviews, and new-user welcome messages. TopHeader replaces hardcoded array with a useNotifications() hook that fetches on mount and every 60 s. Loading skeleton and empty state included.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Sidebar tooltips on context-dependent items",
        category: "improvement",
        description:
            "Items requiring a siteId now show a \"Select a site first\" tooltip on hover when no site is active. Items are pointer-events-none (not just dim) to prevent accidental navigation.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Annual pricing toggle on landing page",
        category: "feature",
        description:
            "Added billingAnnual state with animated toggle switch in the pricing section. Pro: $39/mo → $31/mo annual. Agency: $99/mo → $79/mo annual. \"Billed annually — 2 months free\" badge shown when annual is selected.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "AEO empty state — benchmark teaser shown",
        category: "improvement",
        description:
            "Empty AEO card now shows \"Top brands avg 68/100\" instead of generic \"Run deep AEO audit\" text, with a \"See where you rank →\" link.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Inline onboarding wizard",
        category: "feature",
        description:
            "Replaces the \"Add Your First Site\" button with a 3-step inline wizard (Domain → Audit Queue → Done). Real-time domain validation calls /api/sites POST without leaving the page. Wired into dashboard isNewUser branch.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "⌘K Command palette",
        category: "feature",
        description:
            "Global ⌘K / Ctrl+K shortcut opens a full-featured command palette with 15 commands and fuzzy search scoring (exact > prefix > contains > keywords > description). Keyboard navigation with ↑↓ and ↵.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Real-time job progress via JobPoller component",
        category: "feature",
        description:
            "Generic polling component polls a pollUrl every 5 s while status is PENDING/RUNNING. Animated progress bar with elapsed/estimated time. onComplete and onError callbacks.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Shareable audit link button",
        category: "feature",
        description:
            "\"Share\" button next to Export in the audit detail header. Uses navigator.share() on mobile; clipboard copy fallback on desktop. Shows \"Copied!\" confirmation for 2 s.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.0.1",
        title: "Keyword rank history sparkline",
        category: "feature",
        description:
            "SVG sparkline component for position-over-time in keyword rows. Color-coded by trend: green = improved, red = declined, gray = flat. Delta badge (↑3 / ↓2) shown next to the sparkline.",
        publishedAt: new Date("2026-04-08"),
    },
    {
        version: "1.1.0",
        title: "Priority score on every audit issue",
        category: "feature",
        description:
            "Every audit issue now carries a priority score (0–100) computed from traffic impact × 0.5 + fix ease × 0.3 + confidence × 0.2. A \"Top 5 Fixes This Week\" card at the top of every audit report shows the highest-impact fixes first, with difficulty badges (Easy / Medium / Complex).",
        publishedAt: new Date("2026-04-09"),
    },
    {
        version: "1.1.0",
        title: "Public changelog page launched",
        category: "feature",
        description:
            "A live /changelog page now shows all product updates grouped by month, color-coded by category (green = feature, blue = improvement, amber = fix, red = security). No login required.",
        publishedAt: new Date("2026-04-09"),
    },
];

async function main() {
    console.log(`Seeding ${entries.length} changelog entries...`);
    let created = 0;
    for (const entry of entries) {
        await prisma.changelog.upsert({
            where: {
                // Use a deterministic ID based on title to be idempotent
                id: Buffer.from(entry.title).toString("base64url").slice(0, 25),
            },
            update: {},
            create: {
                id:          Buffer.from(entry.title).toString("base64url").slice(0, 25),
                ...entry,
            },
        });
        created++;
    }
    console.log(`✅ Seeded ${created} entries.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
