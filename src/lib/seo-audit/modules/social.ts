import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { parse } from 'node-html-parser';
import { fetchHtml } from '../utils/fetch-html';

export const SocialModule: AuditModule = {
    id: 'social-branding',
    label: 'Social & Branding Signals',
    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        let html = context.html;
        if (!html) {
            html = await fetchHtml(context.url);

        }

        const items: ChecklistItem[] = [];

        if (!html) {
            return {
                id: SocialModule.id,
                label: SocialModule.label,
                items,
                score: 0,
                passed: 0,
                failed: 1,
                warnings: 0
            };
        }
        const root = parse(html || '');

        // ─────────────────────────────────────────────────────────────
        // 1. Full Open Graph Audit (6 core + 2 recommended properties)
        // ─────────────────────────────────────────────────────────────
        const getOgContent = (prop: string) => root.querySelector(`meta[property="${prop}"]`)?.getAttribute('content')?.trim() || null;
        const getTwitterContent = (name: string) => root.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || null;

        const ogTitle = getOgContent('og:title');
        const ogDesc = getOgContent('og:description');
        const ogImage = getOgContent('og:image');
        const ogUrl = getOgContent('og:url');
        const ogType = getOgContent('og:type');
        const ogSiteName = getOgContent('og:site_name');

        const pageTitle = root.querySelector('title')?.textContent.trim() || '';
        const _pageDesc = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';

        const ogFields = [
            { key: 'og:title', value: ogTitle, required: true },
            { key: 'og:description', value: ogDesc, required: true },
            { key: 'og:image', value: ogImage, required: true },
            { key: 'og:url', value: ogUrl, required: true },
            { key: 'og:type', value: ogType, required: false },
            { key: 'og:site_name', value: ogSiteName, required: false },
        ];

        const missingRequired = ogFields.filter(f => f.required && !f.value).map(f => f.key);
        const missingOptional = ogFields.filter(f => !f.required && !f.value).map(f => f.key);
        const presentCount = ogFields.filter(f => !!f.value).length;

        let ogStatus: ChecklistItem['status'] = presentCount === 6 ? 'Pass' : missingRequired.length === 0 ? 'Warning' : 'Fail';
        const ogIssues: string[] = [];
        if (missingRequired.length > 0) ogIssues.push(`Missing required: ${missingRequired.join(', ')}`);
        if (missingOptional.length > 0) ogIssues.push(`Missing recommended: ${missingOptional.join(', ')}`);

        // Flag relative og:image URL (must be absolute)
        if (ogImage && !ogImage.startsWith('http://') && !ogImage.startsWith('https://')) {
            ogStatus = 'Fail';
            ogIssues.push(`og:image must be an absolute URL (found: "${ogImage}")`);
        }

        items.push({
            id: 'open-graph-full',
            label: 'Open Graph Tags (Full Audit)',
            status: ogStatus,
            finding: ogIssues.length === 0
                ? `All 6 Open Graph properties present. og:image is absolute URL.`
                : ogIssues.join('. ') + '.',
            recommendation: ogIssues.length > 0 ? {
                text: 'Add all required OG tags: og:title, og:description, og:image (absolute HTTPS URL, 1200×630px), og:url (matching canonical). Optional but recommended: og:type (e.g. "website"), og:site_name.',
                priority: missingRequired.length > 0 ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 60,
            aiVisibilityImpact: 80,
            details: {
                titlePresent: !!ogTitle, descPresent: !!ogDesc, imagePresent: !!ogImage,
                urlPresent: !!ogUrl, typePresent: !!ogType, siteNamePresent: !!ogSiteName,
            },
        });

        // ─────────────────────────────────────────────────────────────
        // 2. OG vs <title> mismatch detection
        // ─────────────────────────────────────────────────────────────
        if (ogTitle && pageTitle && ogTitle.toLowerCase() !== pageTitle.toLowerCase()) {
            items.push({
                id: 'og-title-mismatch',
                label: 'OG vs Title Tag Mismatch',
                status: 'Warning',
                finding: `og:title ("${ogTitle.substring(0, 60)}") differs from <title> ("${pageTitle.substring(0, 60)}"). This can cause inconsistent previews.`,
                recommendation: {
                    text: 'Keep og:title and <title> consistent. Minor wording differences are acceptable, but major mismatches confuse social sharing previews and AI scrapers.',
                    priority: 'Low',
                },
                roiImpact: 30,
                aiVisibilityImpact: 50,
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 3. Twitter Card — Full Audit
        // ─────────────────────────────────────────────────────────────
        const twitterCard = getTwitterContent('twitter:card');
        const twitterTitle = getTwitterContent('twitter:title');
        const twitterDesc = getTwitterContent('twitter:description');
        const twitterImage = getTwitterContent('twitter:image');
        const twitterCreator = getTwitterContent('twitter:creator');
        const twitterSite = getTwitterContent('twitter:site');

        const twitterFields = [twitterCard, twitterTitle, twitterDesc, twitterImage];
        const _twitterPresent = twitterFields.filter(Boolean).length;
        const validCardTypes = ['summary', 'summary_large_image', 'app', 'player'];

        const twitterIssues: string[] = [];
        let twitterStatus: ChecklistItem['status'] = 'Pass';

        if (!twitterCard) {
            twitterStatus = 'Fail';
            twitterIssues.push('twitter:card is missing — without it Twitter shows only a bare link');
        } else if (!validCardTypes.includes(twitterCard)) {
            twitterStatus = 'Warning';
            twitterIssues.push(`Invalid twitter:card value: "${twitterCard}" (must be summary, summary_large_image, app, or player)`);
        }
        if (!twitterTitle) twitterIssues.push('twitter:title missing');
        if (!twitterDesc) twitterIssues.push('twitter:description missing');
        if (!twitterImage) twitterIssues.push('twitter:image missing');

        if (twitterIssues.length > 0 && twitterStatus === 'Pass') twitterStatus = 'Warning';

        items.push({
            id: 'twitter-cards-full',
            label: 'Twitter / X Cards (Full Audit)',
            status: twitterStatus,
            finding: twitterIssues.length === 0
                ? `Twitter card "${twitterCard}" fully configured${twitterCreator ? ` with creator @${twitterCreator}` : ''}.`
                : twitterIssues.join('. ') + '.',
            recommendation: twitterIssues.length > 0 ? {
                text: 'Add twitter:card (use "summary_large_image" for best visual impact), twitter:title, twitter:description, and twitter:image. Add twitter:site with your @handle for attribution.',
                priority: twitterStatus === 'Fail' ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 45,
            aiVisibilityImpact: 70,
            details: {
                card: twitterCard || 'none',
                titlePresent: !!twitterTitle, descPresent: !!twitterDesc, imagePresent: !!twitterImage,
                creator: twitterCreator || 'none', site: twitterSite || 'none',
            },
        });

        // ─────────────────────────────────────────────────────────────
        // 4. OG vs Twitter description mismatch
        // ─────────────────────────────────────────────────────────────
        if (ogDesc && twitterDesc && ogDesc.toLowerCase() !== twitterDesc.toLowerCase()) {
            items.push({
                id: 'og-twitter-mismatch',
                label: 'OG vs Twitter Description Mismatch',
                status: 'Warning',
                finding: 'og:description and twitter:description have different values. This creates inconsistent previews across platforms.',
                recommendation: {
                    text: 'Align og:description and twitter:description, or set twitter:description equal to og:description where both apply.',
                    priority: 'Low',
                },
                roiImpact: 20,
                aiVisibilityImpact: 35,
            });
        }

        // ─────────────────────────────────────────────────────────────
        // 5. Facebook Pixel
        // ─────────────────────────────────────────────────────────────
        const hasPixel = (html || '').includes('connect.facebook.net/en_US/fbevents.js') || (html || '').includes('fbq(');
        items.push({
            id: 'facebook-pixel',
            label: 'Facebook / Meta Pixel',
            status: hasPixel ? 'Pass' : 'Info',
            finding: hasPixel ? 'Meta Pixel detected.' : 'No Meta Pixel detected (optional — needed for Facebook/Instagram ad retargeting).',
            recommendation: !hasPixel ? { text: 'Install the Meta Pixel via GTM if running Facebook/Instagram ad campaigns.', priority: 'Low' } : undefined,
            roiImpact: 35,
            aiVisibilityImpact: 15,
        });

        // ─────────────────────────────────────────────────────────────
        // 6. Social Profile Links & YouTube
        // ─────────────────────────────────────────────────────────────
        const links = root.querySelectorAll('a[href]');
        const socialPlatforms = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com'];
        let socialLinksFound = 0;
        let hasYoutubeLinkOrEmbed = (html || '').includes('youtube.com/embed');
        const socialFound: string[] = [];

        links.forEach(a => {
            const href = a.getAttribute('href') || '';
            for (const platform of socialPlatforms) {
                if (href.includes(platform)) {
                    socialLinksFound++;
                    socialFound.push(platform.split('.')[0]);
                    if (href.includes('youtube.com') || href.includes('youtu.be')) {
                        hasYoutubeLinkOrEmbed = true;
                    }
                    break;
                }
            }
        });

        // Also check schema.org sameAs — many modern sites declare social profiles in JSON-LD
        // rather than visible anchor tags (this is a perfectly valid SEO pattern)
        const schemaScripts = root.querySelectorAll('script[type="application/ld+json"]');
        schemaScripts.forEach(script => {
            try {
                const obj = JSON.parse(script.textContent?.trim() || '{}');
                const sameAs: string[] = Array.isArray(obj.sameAs) ? obj.sameAs : (obj.sameAs ? [obj.sameAs] : []);
                sameAs.forEach(url => {
                    for (const platform of socialPlatforms) {
                        if (url.includes(platform) && !socialFound.includes(platform.split('.')[0])) {
                            socialLinksFound++;
                            socialFound.push(platform.split('.')[0] + ' (schema)');
                            if (url.includes('youtube.com')) hasYoutubeLinkOrEmbed = true;
                            break;
                        }
                    }
                });
            } catch { /* invalid JSON, skip */ }
        });

        items.push({
            id: 'social-links',
            label: 'Social Media Profile Links',
            status: socialLinksFound > 0 ? 'Pass' : 'Warning',
            finding: socialLinksFound > 0
                ? `Links to ${[...new Set(socialFound)].join(', ')} detected.`
                : 'No social media profile links found.',
            recommendation: !socialLinksFound ? { text: 'Link to your social media profiles. This builds brand entity signals for Google\'s Knowledge Graph.', priority: 'Low' } : undefined,
            roiImpact: 50,
            aiVisibilityImpact: 75,
            details: { count: socialLinksFound, platforms: [...new Set(socialFound)].join(', ') || 'none' },
        });

        items.push({
            id: 'youtube-presence',
            label: 'YouTube Channel or Video Embeds',
            status: hasYoutubeLinkOrEmbed ? 'Pass' : 'Info',
            finding: hasYoutubeLinkOrEmbed ? 'YouTube embed or link detected.' : 'No YouTube presence detected on this page.',
            recommendation: !hasYoutubeLinkOrEmbed ? { text: 'Embed a brand intro video or link to your YouTube channel to increase dwell time and brand authority.', priority: 'Low' } : undefined,
            roiImpact: 60,
            aiVisibilityImpact: 75,
        });

        // ─────────────────────────────────────────────────────────────
        // Score (exclude Info)
        // ─────────────────────────────────────────────────────────────
        const analyzableItems = items.filter(i => i.status !== 'Skipped' && i.status !== 'Info');
        const passed = analyzableItems.filter(i => i.status === 'Pass').length;
        const failed = analyzableItems.filter(i => i.status === 'Fail').length;
        const warnings = analyzableItems.filter(i => i.status === 'Warning').length;
        const maxScore = analyzableItems.length;
        const score = maxScore > 0 ? Math.round(((passed + warnings * 0.5) / maxScore) * 100) : 0;

        return {
            id: SocialModule.id,
            label: SocialModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    }
};
