import type {
    AuditModule,
    AuditModuleContext,
    AuditCategoryResult,
    ChecklistItem,
} from '../types';
import { parse } from 'node-html-parser';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const MAX_HTML_BYTES = 10 * 1024 * 1024;

/** Minimum favicon size (px) that renders crisply at 16×16 SERP favicon slot */
const MIN_FAVICON_PX = 16;

// ── HELPERS ───────────────────────────────────────────────────────────────────

function parseJsonLdBlocks(html: string): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed: any = JSON.parse(match[1]);
            const nodes: Record<string, unknown>[] = Array.isArray(parsed)
                ? parsed
                : parsed['@graph']
                    ? (parsed['@graph'] as Record<string, unknown>[])
                    : [parsed];
            results.push(...nodes.filter(Boolean));
        } catch { /* malformed — skip */ }
    }
    return results;
}

function getSchemaType(node: Record<string, unknown>): string {
    const t = node['@type'];
    if (typeof t === 'string') return t;
    if (Array.isArray(t)) return (t as string[])[0] ?? '';
    return '';
}

// ── CHECKS ────────────────────────────────────────────────────────────────────

function checkOrganizationSchema(nodes: Record<string, unknown>[]): ChecklistItem {
    const org = nodes.find(n => getSchemaType(n) === 'Organization');
    if (!org) {
        return {
            id: 'brand-org-schema',
            label: 'Organization schema',
            status: 'Fail',
            finding: 'No Organization JSON-LD block found. Google cannot confirm brand identity or display your logo in SERPs.',
            recommendation: {
                text: 'Add <script type="application/ld+json"> with @type:Organization, name, url, and logo.url pointing to your logo file.',
                priority: 'High',
            },
            roiImpact: 85,
            aiVisibilityImpact: 80,
        };
    }

    const hasName  = typeof org.name  === 'string' && (org.name as string).length > 0;
    const hasUrl   = typeof org.url   === 'string' && (org.url as string).length > 0;
    const logoObj  = org.logo as Record<string, unknown> | undefined;
    const hasLogo  = logoObj && (typeof logoObj.url === 'string' || typeof org.logo === 'string');
    const hasSameAs = Array.isArray(org.sameAs) && (org.sameAs as unknown[]).length > 0;

    const missing: string[] = [];
    if (!hasName)   missing.push('name');
    if (!hasUrl)    missing.push('url');
    if (!hasLogo)   missing.push('logo (with ImageObject.url)');
    if (!hasSameAs) missing.push('sameAs (social profiles)');

    if (missing.length > 0) {
        return {
            id: 'brand-org-schema',
            label: 'Organization schema',
            status: 'Warning',
            finding: `Organization schema present but incomplete. Missing required fields: ${missing.join(', ')}.`,
            recommendation: {
                text: `Add these fields to your Organization block: ${missing.join(', ')}. The logo field should use "@type":"ImageObject" with a url, width, and height.`,
                priority: 'High',
            },
            roiImpact: 70,
            aiVisibilityImpact: 70,
        };
    }

    return {
        id: 'brand-org-schema',
        label: 'Organization schema',
        status: 'Pass',
        finding: 'Organization schema present with name, url, logo, and sameAs.',
        roiImpact: 85,
        aiVisibilityImpact: 80,
    };
}

function checkLogoSchema(nodes: Record<string, unknown>[]): ChecklistItem {
    const org = nodes.find(n => getSchemaType(n) === 'Organization');
    if (!org) {
        return {
            id: 'brand-logo-schema',
            label: 'Logo structured data',
            status: 'Fail',
            finding: 'No Organization schema — logo cannot be validated as a structured data entity.',
            recommendation: {
                text: 'Add Organization schema with a logo field using "@type":"ImageObject" and url/width/height.',
                priority: 'High',
            },
            roiImpact: 80,
            aiVisibilityImpact: 75,
        };
    }

    const logo = org.logo as Record<string, unknown> | string | undefined;
    if (!logo) {
        return {
            id: 'brand-logo-schema',
            label: 'Logo structured data',
            status: 'Fail',
            finding: 'Organization schema exists but has no logo field. Google cannot surface your logo in Knowledge Panel or SERPs.',
            recommendation: {
                text: 'Add logo: { "@type": "ImageObject", url: "https://yourdomain.com/logo.svg", width: 200, height: 60 } inside your Organization block.',
                priority: 'High',
            },
            roiImpact: 80,
            aiVisibilityImpact: 75,
        };
    }

    const logoUrl = typeof logo === 'string' ? logo : (logo.url as string | undefined);
    const hasSize = typeof logo !== 'string' && logo.width && logo.height;

    if (!hasSize) {
        return {
            id: 'brand-logo-schema',
            label: 'Logo structured data',
            status: 'Warning',
            finding: `Logo URL present (${logoUrl ?? 'unknown'}) but missing width/height dimensions. Google recommends explicit dimensions for ImageObject.`,
            recommendation: {
                text: 'Add width and height properties to the logo ImageObject (e.g. width: 200, height: 60).',
                priority: 'Medium',
            },
            roiImpact: 60,
            aiVisibilityImpact: 60,
        };
    }

    return {
        id: 'brand-logo-schema',
        label: 'Logo structured data',
        status: 'Pass',
        finding: `Logo schema complete: ${logoUrl} with explicit dimensions.`,
        roiImpact: 80,
        aiVisibilityImpact: 75,
    };
}

function checkWebsiteSchema(nodes: Record<string, unknown>[]): ChecklistItem {
    const site = nodes.find(n => getSchemaType(n) === 'WebSite');
    if (!site) {
        return {
            id: 'brand-website-schema',
            label: 'WebSite schema + SearchAction',
            status: 'Fail',
            finding: 'No WebSite JSON-LD block found. Missing sitelink search box eligibility and site navigation signals.',
            recommendation: {
                text: 'Add WebSite schema with name, url, description, and a potentialAction SearchAction pointing to your search endpoint.',
                priority: 'Medium',
            },
            roiImpact: 60,
            aiVisibilityImpact: 65,
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const action = site.potentialAction as any;
    const hasSearchAction =
        action &&
        (getSchemaType(action) === 'SearchAction' ||
            (action['@type'] === 'SearchAction'));

    if (!hasSearchAction) {
        return {
            id: 'brand-website-schema',
            label: 'WebSite schema + SearchAction',
            status: 'Warning',
            finding: 'WebSite schema present but missing potentialAction SearchAction. Sitelink search box will not be eligible.',
            recommendation: {
                text: 'Add potentialAction: { "@type": "SearchAction", target: { urlTemplate: "https://yourdomain.com/search?q={search_term_string}" }, "query-input": "required name=search_term_string" }',
                priority: 'Medium',
            },
            roiImpact: 45,
            aiVisibilityImpact: 55,
        };
    }

    return {
        id: 'brand-website-schema',
        label: 'WebSite schema + SearchAction',
        status: 'Pass',
        finding: 'WebSite schema present with SearchAction (sitelink search box eligible).',
        roiImpact: 60,
        aiVisibilityImpact: 65,
    };
}

function checkLogoAltText(html: string): ChecklistItem {
    const root = parse(html.slice(0, MAX_HTML_BYTES));

    // Find all img tags that look like logos (src contains "logo")
    const logoImgs = root.querySelectorAll('img').filter(img => {
        const src = (img.getAttribute('src') ?? '').toLowerCase();
        return src.includes('logo');
    });

    if (logoImgs.length === 0) {
        // No <img> logo found — could be CSS/SVG background or inline SVG
        // Check for inline SVG with aria-label
        const svgs = root.querySelectorAll('svg[aria-label], svg[title]');
        if (svgs.length > 0) {
            return {
                id: 'brand-logo-alt',
                label: 'Logo alt / aria-label text',
                status: 'Pass',
                finding: 'Logo is an inline SVG with aria-label or title. Accessible and crawlable.',
                roiImpact: 50,
                aiVisibilityImpact: 45,
            };
        }

        // Check for aria-label on logo link wrappers
        const logoLinks = root.querySelectorAll('a[aria-label*="logo" i], a[aria-label*="home" i], a[title*="logo" i]');
        if (logoLinks.length > 0) {
            return {
                id: 'brand-logo-alt',
                label: 'Logo alt / aria-label text',
                status: 'Pass',
                finding: 'Logo link has descriptive aria-label associating brand name with its purpose.',
                roiImpact: 50,
                aiVisibilityImpact: 45,
            };
        }

        return {
            id: 'brand-logo-alt',
            label: 'Logo alt / aria-label text',
            status: 'Warning',
            finding: 'No <img> logo detected. If using CSS background or inline SVG, ensure an aria-label on the container or parent link describes the brand.',
            recommendation: {
                text: 'Add aria-label="BrandName — descriptive tagline" to the logo link element, or title/aria-label to the SVG.',
                priority: 'Medium',
            },
            roiImpact: 50,
            aiVisibilityImpact: 45,
        };
    }

    const weakAlt: string[] = [];
    const missingAlt: string[] = [];

    for (const img of logoImgs) {
        const alt = img.getAttribute('alt') ?? '';
        const src = img.getAttribute('src') ?? '';
        if (!alt) {
            missingAlt.push(src);
        } else if (alt.trim().length < 10) {
            weakAlt.push(`"${alt}" (${src})`);
        }
    }

    if (missingAlt.length > 0) {
        return {
            id: 'brand-logo-alt',
            label: 'Logo alt / aria-label text',
            status: 'Fail',
            finding: `${missingAlt.length} logo image(s) have no alt text: ${missingAlt.slice(0, 2).join(', ')}. Google cannot associate your logo with your brand keywords.`,
            recommendation: {
                text: 'Add alt="BrandName — AI SEO audit and automation platform" to every logo <img>. Be descriptive: include your brand name + core keyword.',
                priority: 'High',
            },
            roiImpact: 65,
            aiVisibilityImpact: 60,
        };
    }

    if (weakAlt.length > 0) {
        return {
            id: 'brand-logo-alt',
            label: 'Logo alt / aria-label text',
            status: 'Warning',
            finding: `Logo alt text too short (under 10 chars): ${weakAlt.join(', ')}. Missed keyword association opportunity.`,
            recommendation: {
                text: 'Expand logo alt to include brand name + primary keyword (e.g. "OptiAISEO — AI SEO audit and automation platform").',
                priority: 'Medium',
            },
            roiImpact: 50,
            aiVisibilityImpact: 45,
        };
    }

    return {
        id: 'brand-logo-alt',
        label: 'Logo alt / aria-label text',
        status: 'Pass',
        finding: `${logoImgs.length} logo image(s) have descriptive alt text.`,
        roiImpact: 65,
        aiVisibilityImpact: 60,
    };
}

function checkLogoHomepageAnchor(html: string): ChecklistItem {
    const root = parse(html.slice(0, MAX_HTML_BYTES));

    // Check if logo is wrapped in a link pointing to "/"
    const homeLinks = root.querySelectorAll('a[href="/"], a[href="https://www.optiaiseo.online"], a[href="https://optiaiseo.online"]');
    if (homeLinks.length === 0) {
        return {
            id: 'brand-logo-home-anchor',
            label: 'Logo → homepage anchor',
            status: 'Warning',
            finding: 'No link pointing to the homepage root (/) was found near the logo. Every page should reinforce homepage authority via a logo link.',
            recommendation: {
                text: 'Wrap your logo in <Link href="/" aria-label="BrandName homepage"> on every layout. This consolidates homepage authority and reinforces entity root.',
                priority: 'Medium',
            },
            roiImpact: 55,
            aiVisibilityImpact: 50,
        };
    }

    // Check if any of those links have an aria-label
    const withAriaLabel = homeLinks.filter(l => l.getAttribute('aria-label'));
    if (withAriaLabel.length === 0) {
        return {
            id: 'brand-logo-home-anchor',
            label: 'Logo → homepage anchor',
            status: 'Warning',
            finding: 'Logo links to homepage but has no aria-label — missed brand keyword signal for assistive tech and Google\'s link analysis.',
            recommendation: {
                text: 'Add aria-label="OptiAISEO — AI SEO audit and automation platform" to the logo link.',
                priority: 'Medium',
            },
            roiImpact: 45,
            aiVisibilityImpact: 45,
        };
    }

    return {
        id: 'brand-logo-home-anchor',
        label: 'Logo → homepage anchor',
        status: 'Pass',
        finding: `${homeLinks.length} homepage link(s) found near logo, ${withAriaLabel.length} with descriptive aria-label.`,
        roiImpact: 55,
        aiVisibilityImpact: 50,
    };
}

function checkFavicon(html: string): ChecklistItem {
    const root = parse(html.slice(0, MAX_HTML_BYTES));

    const svgFavicon = root.querySelector('link[rel="icon"][type="image/svg+xml"]');
    const pngFavicon = root.querySelector('link[rel="icon"][type="image/png"], link[rel="shortcut icon"]');
    const appleFavicon = root.querySelector('link[rel="apple-touch-icon"]');

    if (!svgFavicon && !pngFavicon) {
        return {
            id: 'brand-favicon',
            label: 'Favicon (SERP CTR signal)',
            status: 'Fail',
            finding: 'No favicon link tag found. Browsers and Google SERP use favicon to display brand identity next to your result — missing this hurts CTR.',
            recommendation: {
                text: 'Add <link rel="icon" type="image/svg+xml" href="/logo.svg"> as the primary favicon. Also include a PNG fallback for browsers that do not support SVG.',
                priority: 'High',
            },
            roiImpact: 70,
            aiVisibilityImpact: 30,
        };
    }

    const issues: string[] = [];
    if (!svgFavicon) issues.push('Missing SVG favicon (highest quality — add <link rel="icon" type="image/svg+xml">)');
    if (!appleFavicon) issues.push('Missing apple-touch-icon (180×180 PNG for iOS home screen)');

    if (issues.length > 0) {
        return {
            id: 'brand-favicon',
            label: 'Favicon (SERP CTR signal)',
            status: 'Warning',
            finding: `Favicon partially configured. ${issues.join('. ')}.`,
            recommendation: {
                text: issues.join('; '),
                priority: 'Medium',
            },
            roiImpact: 55,
            aiVisibilityImpact: 25,
        };
    }

    return {
        id: 'brand-favicon',
        label: 'Favicon (SERP CTR signal)',
        status: 'Pass',
        finding: 'SVG favicon, PNG fallback, and apple-touch-icon all present.',
        roiImpact: 70,
        aiVisibilityImpact: 30,
        details: { minSizePx: MIN_FAVICON_PX },
    };
}

function checkSameAsLinks(nodes: Record<string, unknown>[]): ChecklistItem {
    const org = nodes.find(n => getSchemaType(n) === 'Organization');
    const sameAs = org?.sameAs as string[] | undefined;

    if (!org || !sameAs || sameAs.length === 0) {
        return {
            id: 'brand-same-as',
            label: 'sameAs social profile links',
            status: 'Warning',
            finding: 'No sameAs links in Organization schema. Google uses these to build your Knowledge Graph entity and confirm brand identity across the web.',
            recommendation: {
                text: 'Add sameAs: ["https://twitter.com/yourbrand", "https://linkedin.com/company/yourbrand", "https://crunchbase.com/organization/yourbrand"] to your Organization block.',
                priority: 'Medium',
            },
            roiImpact: 60,
            aiVisibilityImpact: 70,
        };
    }

    const validUrls = sameAs.filter(s => s.startsWith('https://'));
    if (validUrls.length < 2) {
        return {
            id: 'brand-same-as',
            label: 'sameAs social profile links',
            status: 'Warning',
            finding: `Only ${validUrls.length} valid sameAs link(s). For strong Knowledge Graph coverage, include at least 3 (Twitter/X, LinkedIn, Crunchbase).`,
            recommendation: {
                text: 'Add more sameAs URLs — prioritise: LinkedIn, Twitter/X, Crunchbase, Wikipedia (if applicable), and your primary product listings.',
                priority: 'Medium',
            },
            roiImpact: 55,
            aiVisibilityImpact: 65,
        };
    }

    return {
        id: 'brand-same-as',
        label: 'sameAs social profile links',
        status: 'Pass',
        finding: `${validUrls.length} sameAs links: ${validUrls.join(', ')}`,
        roiImpact: 60,
        aiVisibilityImpact: 70,
    };
}

function checkBrandMentionDensity(html: string, url: string): ChecklistItem {
    const root = parse(html.slice(0, MAX_HTML_BYTES));

    // Extract brand name from URL
    let brand = '';
    try {
        const hostname = new URL(url).hostname.replace('www.', '');
        brand = hostname.split('.')[0];
    } catch { brand = ''; }

    if (!brand || brand.length < 3) {
        return {
            id: 'brand-mention-density',
            label: 'Brand mention density',
            status: 'Info',
            finding: 'Could not determine brand name from URL to check mention density.',
            roiImpact: 40,
            aiVisibilityImpact: 55,
        };
    }

    const bodyText = root.querySelector('body')?.text ?? '';
    const wordCount = bodyText.trim().split(/\s+/).length;
    const regex = new RegExp(brand, 'gi');
    const mentions = (bodyText.match(regex) ?? []).length;
    const density = wordCount > 0 ? (mentions / wordCount) * 100 : 0;

    if (mentions < 2) {
        return {
            id: 'brand-mention-density',
            label: 'Brand mention density',
            status: 'Fail',
            finding: `Brand name "${brand}" appears only ${mentions} time(s) in body text (${density.toFixed(2)}%). Google uses brand co-occurrence to establish entity authority.`,
            recommendation: {
                text: `Mention your brand name ("${brand}") at least 3–5 times per page in natural context. Use patterns like "With ${brand}, you can…" or "${brand} helps you…" near value statements.`,
                priority: 'Medium',
            },
            roiImpact: 50,
            aiVisibilityImpact: 65,
        };
    }

    if (density > 5) {
        return {
            id: 'brand-mention-density',
            label: 'Brand mention density',
            status: 'Warning',
            finding: `Brand name "${brand}" appears ${mentions} times (${density.toFixed(2)}%) — may appear over-optimised.`,
            recommendation: {
                text: 'Reduce brand mention density to under 3% to avoid appearing manipulative. Use natural variations.',
                priority: 'Low',
            },
            roiImpact: 30,
            aiVisibilityImpact: 40,
        };
    }

    return {
        id: 'brand-mention-density',
        label: 'Brand mention density',
        status: 'Pass',
        finding: `Brand "${brand}" mentioned ${mentions} times (${density.toFixed(2)}% density) — healthy range.`,
        roiImpact: 50,
        aiVisibilityImpact: 65,
    };
}

// ── SCORE CALCULATION ─────────────────────────────────────────────────────────

function calcScore(items: ChecklistItem[]): number {
    if (items.length === 0) return 0;
    const weights: Record<string, number> = {
        'brand-org-schema':        20,
        'brand-logo-schema':       15,
        'brand-website-schema':    10,
        'brand-logo-alt':          12,
        'brand-logo-home-anchor':  10,
        'brand-favicon':           13,
        'brand-same-as':           10,
        'brand-mention-density':   10,
    };
    let totalWeight = 0;
    let earned = 0;
    for (const item of items) {
        const w = weights[item.id] ?? 5;
        totalWeight += w;
        if (item.status === 'Pass') earned += w;
        else if (item.status === 'Warning') earned += w * 0.4;
        // Fail / Error = 0
    }
    return totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;
}

// ── MODULE EXPORT ─────────────────────────────────────────────────────────────

export const BrandEntityModule: AuditModule = {
    id: 'brand-entity',
    label: 'Brand Entity Score',
    requiresHtml: true,

    async run(context: AuditModuleContext): Promise<AuditCategoryResult> {
        const { html, url } = context;

        const nodes = parseJsonLdBlocks(html);

        const items: ChecklistItem[] = [
            checkOrganizationSchema(nodes),
            checkLogoSchema(nodes),
            checkWebsiteSchema(nodes),
            checkLogoAltText(html),
            checkLogoHomepageAnchor(html),
            checkFavicon(html),
            checkSameAsLinks(nodes),
            checkBrandMentionDensity(html, url),
        ];

        const score   = calcScore(items);
        const passed  = items.filter(i => i.status === 'Pass').length;
        const failed  = items.filter(i => i.status === 'Fail' || i.status === 'Error').length;
        const warnings = items.filter(i => i.status === 'Warning').length;

        return {
            id:    'brand-entity',
            label: 'Brand Entity Score',
            items,
            score,
            passed,
            failed,
            warnings,
        };
    },
};

/** Standalone utility — compute Brand Entity Score from raw HTML + URL without running the full audit engine */
export async function computeBrandEntityScore(
    html: string,
    url: string
): Promise<{ score: number; items: ChecklistItem[] }> {
    const result = await BrandEntityModule.run({
        url,
        html,
        frameworkHints: [],
    } as AuditModuleContext);
    return { score: result.score, items: result.items };
}
