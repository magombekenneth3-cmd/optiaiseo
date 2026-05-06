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
<div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:12px;padding:2rem;text-align:center;margin:2.5rem 0;">
  <h3 style="color:#1e3a8a;margin-top:0;font-size:1.3rem;">${brand}</h3>
  <p style="color:#3b82f6;margin-bottom:1.5rem;">Ready to get started? Visit our website for full details, pricing, and to get in touch.</p>
  <a href="${siteUrl}" style="background:#2563eb;color:white;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;display:inline-block;">Visit ${brand} →</a>
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
<div style="background:#ecfdf5;border:2px solid #10b981;border-radius:12px;padding:2rem;margin:2.5rem 0;">
  <h3 style="color:#064e3b;margin-top:0;font-size:1.2rem;">Want to know more about ${brand}?</h3>
  <p style="color:#047857;margin-bottom:1.2rem;">Visit our website for service details, packages, and to get in touch directly with our team.</p>
  <a href="${siteUrl}" style="background:#10b981;color:white;padding:11px 24px;border-radius:8px;font-weight:700;text-decoration:none;display:inline-block;">Go to ${brand} →</a>
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
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:5px solid #64748b;border-radius:8px;padding:1.5rem;margin:2.5rem 0;">
  <p style="color:#1e293b;font-weight:700;margin:0 0 0.5rem;">${brand}</p>
  <p style="color:#64748b;margin:0 0 1rem;font-size:0.95rem;">For more information about our services and how we can help, visit our website.</p>
  <a href="${siteUrl}" style="color:#1e293b;font-weight:700;text-decoration:underline;">Visit ${brand} →</a>
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
<div style="margin:2.5rem 0;border-top:1px solid #e2e8f0;padding-top:1.5rem;text-align:center;">
  <p style="color:#64748b;margin-bottom:0.75rem;">Learn more about ${brand}:</p>
  <a href="${siteUrl}" style="color:#1e293b;font-weight:800;text-decoration:none;letter-spacing:0.03em;">${siteUrl} →</a>
</div>`
            };
        }
    }
}

/**
 * Injects a funnel CTA into the blog content at a strategic position.
 */
export function injectFunnelCta(content: string, funnelJson: FunnelConfig): string {
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