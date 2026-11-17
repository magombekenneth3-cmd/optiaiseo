export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';

export interface FunnelCTA {
    type: 'button' | 'form' | 'link' | 'banner';
    text: string;
    description?: string;
    targetUrl: string;
    style?: string;
    goal: 'lead' | 'sale' | 'demo' | 'branding';
}

export interface FunnelConfig {
    intent: SearchIntent;
    primaryCTA: FunnelCTA;
    secondaryCTA?: FunnelCTA;
    funnelStrategy: string;
    htmlSnippet: string;
}

/**
 * Returns a CTA block branded entirely to the user's site.
 * Links always go to the site's own homepage — never to guessed subpaths,
 * never to OptiAISEO platform URLs.
 */
export function getFunnelForIntent(
    intent: SearchIntent,
    siteId: string,
    siteDomainWithProtocol: string,
    siteTitle: string,
    _blogId?: string
): FunnelConfig {
    const siteDomain = siteDomainWithProtocol
        .replace('https://', '')
        .replace('http://', '')
        .split('/')[0];

    // Always link to the site's own homepage — no guessed subpaths
    const siteUrl = `https://${siteDomain}`;
    const brand = siteTitle || siteDomain;

    switch (intent) {
        case 'transactional': {
            return {
                intent,
                funnelStrategy: 'Direct Conversion',
                primaryCTA: {
                    type: 'button',
                    text: `Visit ${brand}`,
                    targetUrl: siteUrl,
                    goal: 'sale',
                },
                htmlSnippet: `
<div data-funnel-cta="true" style="background-color:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.35);border-radius:12px;padding:2rem;text-align:center;margin:2.5rem 0;color:inherit;">
  <h3 style="color:inherit;margin-top:0;font-size:1.3rem;">${brand}</h3>
  <p style="color:inherit;opacity:0.85;margin-bottom:1.5rem;">Ready to get started? Visit our website for full details, pricing, and to get in touch.</p>
  <a href="${siteUrl}" style="background-color:#2563eb;color:#ffffff;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;display:inline-block;">Visit ${brand} →</a>
</div>`
            };
        }

        case 'commercial': {
            return {
                intent,
                funnelStrategy: 'Social Proof & Contact',
                primaryCTA: {
                    type: 'button',
                    text: `Learn More`,
                    targetUrl: siteUrl,
                    goal: 'demo',
                },
                htmlSnippet: `
<div data-funnel-cta="true" style="background-color:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.35);border-radius:12px;padding:2rem;margin:2.5rem 0;color:inherit;">
  <h3 style="color:inherit;margin-top:0;font-size:1.2rem;">Want to know more about ${brand}?</h3>
  <p style="color:inherit;opacity:0.85;margin-bottom:1.2rem;">Visit our website for service details, packages, and to get in touch directly with our team.</p>
  <a href="${siteUrl}" style="background-color:#10b981;color:#052e16;padding:11px 24px;border-radius:8px;font-weight:700;text-decoration:none;display:inline-block;">Go to ${brand} →</a>
</div>`
            };
        }

        case 'informational': {
            return {
                intent,
                funnelStrategy: 'Education & Brand Awareness',
                primaryCTA: {
                    type: 'link',
                    text: `Visit ${brand}`,
                    targetUrl: siteUrl,
                    goal: 'lead',
                },
                htmlSnippet: `
<div data-funnel-cta="true" style="background-color:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);border-left:4px solid #10b981;border-radius:8px;padding:1.5rem;margin:2.5rem 0;color:inherit;">
  <p style="color:inherit;font-weight:700;margin:0 0 0.5rem;">${brand}</p>
  <p style="color:inherit;opacity:0.85;margin:0 0 1rem;font-size:0.95rem;">For more information about our services and how we can help, visit our website.</p>
  <a href="${siteUrl}" style="color:#10b981;font-weight:700;text-decoration:underline;">Visit ${brand} →</a>
</div>`
            };
        }

        case 'navigational':
        default: {
            return {
                intent,
                funnelStrategy: 'Brand Authority',
                primaryCTA: {
                    type: 'link',
                    text: `Visit ${brand}`,
                    targetUrl: siteUrl,
                    goal: 'branding',
                },
                htmlSnippet: `
<div data-funnel-cta="true" style="margin:2.5rem 0;border-top:1px solid rgba(148,163,184,0.25);padding-top:1.5rem;text-align:center;color:inherit;">
  <p style="color:inherit;opacity:0.8;margin-bottom:0.75rem;">Learn more about ${brand}:</p>
  <a href="${siteUrl}" style="color:#10b981;font-weight:800;text-decoration:none;letter-spacing:0.03em;">${siteUrl} →</a>
</div>`
            };
        }
    }
}

const LEGACY_FUNNEL_CTA_PATTERNS = [
    /Ready to get started\? Visit our website for full details, pricing, and to get in touch\./i,
    /Visit our website for service details, packages, and to get in touch directly with our team\./i,
    /For more information about our services and how we can help, visit our website\./i,
];

/**
 * Returns true if the HTML content already includes a rendered funnel CTA block.
 */
export function hasFunnelCta(content: string): boolean {
    if (!content) return false;
    if (/data-funnel-cta=["']true["']/i.test(content)) return true;
    return LEGACY_FUNNEL_CTA_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Injects a funnel CTA into the blog content at a strategic position.
 * No-ops if a funnel CTA is already present to avoid duplicate blocks.
 */
export function injectFunnelCta(content: string, funnelJson: FunnelConfig): string {
    if (hasFunnelCta(content)) {
        return content;
    }
    const paragraphs = content.split('</p>');
    if (paragraphs.length > 3) {
        let safeIndex = 2;
        while (
            safeIndex < paragraphs.length - 1 &&
            (paragraphs[safeIndex + 1].trim().startsWith('<h') ||
                paragraphs[safeIndex].trim().endsWith('<h'))
        ) {
            safeIndex++;
        }
        if (safeIndex < paragraphs.length - 1) {
            paragraphs[safeIndex] = paragraphs[safeIndex] + '</p>' + funnelJson.htmlSnippet;
            return paragraphs.join('</p>');
        }
    }
    return content + funnelJson.htmlSnippet;
}