// =============================================================================
// SEO Audit — Image SEO Module
// Checks image alt text coverage, descriptive filenames, WebP/AVIF format,
// lazy loading, and image-to-content ratio.
// =============================================================================

import { parse } from "node-html-parser";
import type { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from "../types";

function score(items: ChecklistItem[]): AuditCategoryResult {
    const passed   = items.filter(i => i.status === "Pass" || i.status === "Info").length;
    const failed   = items.filter(i => i.status === "Fail").length;
    const warnings = items.filter(i => i.status === "Warning").length;
    const total    = passed + failed + warnings;
    const s        = total > 0 ? Math.round(((passed + warnings * 0.5) / total) * 100) : 100;
    return { id: ImageSeoModule.id, label: ImageSeoModule.label, items, score: s, passed, failed, warnings };
}

/** Returns true if the filename looks auto-generated (e.g. IMG_1234.jpg, DSC0001.jpg, image-300x200.jpg) */
function isPoorFilename(src: string): boolean {
    const filename = src.split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";
    return (
        /^(img|dsc|image|photo|pic|screenshot|capture|download|untitled|file|graphic)[-_]?\d+/.test(filename) ||
        /\d{3,4}x\d{3,4}/.test(filename) ||                     // WordPress resize suffix
        /^[a-f0-9]{8,}\./.test(filename) ||                     // hash-named CDN file
        filename.length < 5
    );
}

/** Returns true if the image src is a modern format (WebP / AVIF). */
function isModernFormat(src: string): boolean {
    const ext = (src.split("?")[0].split(".").pop() ?? "").toLowerCase();
    return ext === "webp" || ext === "avif";
}

/** Returns true if the element has lazy loading declared. */
function hasLazyLoad(el: ReturnType<typeof parse>): boolean {
    const loading = el.getAttribute("loading");
    const dataSrc = el.getAttribute("data-src");
    const lazyClass = (el.getAttribute("class") ?? "").toLowerCase();
    return (
        loading === "lazy" ||
        !!dataSrc ||
        lazyClass.includes("lazyload") ||
        lazyClass.includes("lazy-load")
    );
}

export const ImageSeoModule: AuditModule = {
    id:    "image-seo",
    label: "Image SEO",

    async run(context: AuditModuleContext): Promise<AuditCategoryResult> {
        const items: ChecklistItem[] = [];
        const root   = parse(context.html);
        const images = root.querySelectorAll("img");

        if (images.length === 0) {
            return {
                id: ImageSeoModule.id,
                label: ImageSeoModule.label,
                score: 100,
                passed: 1, failed: 0, warnings: 0,
                items: [{
                    id:      "img-none",
                    label:   "Images",
                    status:  "Info",
                    finding: "No <img> elements found on this page. If this is intentional (e.g. a landing page), no action needed.",
                    roiImpact: 0,
                    aiVisibilityImpact: 0,
                }],
            };
        }

        // ── 1. Alt Text Coverage ───────────────────────────────────────────
        {
            const missingAlt  = images.filter(img => !img.getAttribute("alt") && img.getAttribute("alt") !== "").map(img => img.getAttribute("src") ?? "(unknown)");
            const emptyAlt    = images.filter(img => img.getAttribute("alt") === "");       // intentionally decorative
            const hasAlt      = images.filter(img => img.getAttribute("alt") && img.getAttribute("alt")!.trim().length > 0);
            const coveragePct = images.length > 0 ? Math.round((hasAlt.length / images.length) * 100) : 100;

            items.push({
                id:    "img-alt-coverage",
                label: "Image Alt Text Coverage",
                status: coveragePct === 100 ? "Pass" : coveragePct >= 80 ? "Warning" : "Fail",
                finding: coveragePct === 100
                    ? `All ${images.length} images have alt text — excellent accessibility and SEO signal.`
                    : `${missingAlt.length} of ${images.length} images are missing alt text (${100 - coveragePct}% uncovered). Examples: ${missingAlt.slice(0, 3).join(", ")}`,
                recommendation: missingAlt.length > 0 ? {
                    text: [
                        `• Add descriptive alt text to ${missingAlt.length} image(s).`,
                        `• Alt text should describe the image content AND include the target keyword where natural.`,
                        `• Decorative images (icons, dividers) should use alt="" (empty) — not omit the attribute.`,
                        `• Example: <img src="seo-audit.webp" alt="OptiAISEO keyword audit dashboard showing rank improvements">`,
                    ].join("\n"),
                    priority: coveragePct < 70 ? "High" : "Medium",
                } : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 70,
                details: { totalImages: images.length, withAlt: hasAlt.length, missingAlt: missingAlt.length, decorative: emptyAlt.length, coveragePct },
            });
        }

        // ── 2. Alt Text Quality (not too short, not keyword-stuffed) ──────
        {
            const altTexts       = images.map(img => (img.getAttribute("alt") ?? "").trim()).filter(Boolean);
            const tooShort       = altTexts.filter(alt => alt.length > 0 && alt.length < 10);
            const tooLong        = altTexts.filter(alt => alt.length > 125);
            const stuffed        = altTexts.filter(alt => alt.split(/\s+/).length > 15);
            const qualityIssues  = tooShort.length + tooLong.length + stuffed.length;

            items.push({
                id:    "img-alt-quality",
                label: "Alt Text Quality",
                status: qualityIssues === 0 ? "Pass" : qualityIssues <= 2 ? "Warning" : "Fail",
                finding: qualityIssues === 0
                    ? `Alt text quality looks good — descriptive and appropriately concise.`
                    : [
                        tooShort.length  > 0 && `${tooShort.length} alt text(s) too short (<10 chars)`,
                        tooLong.length   > 0 && `${tooLong.length} alt text(s) too long (>125 chars)`,
                        stuffed.length   > 0 && `${stuffed.length} alt text(s) may be keyword-stuffed (>15 words)`,
                    ].filter(Boolean).join(". "),
                recommendation: qualityIssues > 0 ? {
                    text: [
                        `• Aim for 10–125 character alt text — a natural description, not a keyword list.`,
                        tooShort.length > 0 && `• Expand short alts like "${tooShort[0]}" to include what the image shows.`,
                        tooLong.length  > 0 && `• Shorten overly long alt text — focus on the most important detail.`,
                        stuffed.length  > 0 && `• Remove keyword stuffing from alt text — Google penalises this pattern.`,
                    ].filter(Boolean).join("\n"),
                    priority: "Medium",
                } : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 60,
                details: { tooShort: tooShort.length, tooLong: tooLong.length, stuffed: stuffed.length },
            });
        }

        // ── 3. Descriptive Filenames ──────────────────────────────────────
        {
            const srcs       = images.map(img => img.getAttribute("src") ?? "").filter(Boolean);
            const poorNames  = srcs.filter(isPoorFilename);
            const poorPct    = srcs.length > 0 ? Math.round((poorNames.length / srcs.length) * 100) : 0;

            items.push({
                id:    "img-filenames",
                label: "Descriptive Image Filenames",
                status: poorPct === 0 ? "Pass" : poorPct <= 30 ? "Warning" : "Fail",
                finding: poorPct === 0
                    ? "All image filenames appear descriptive — good SEO signal for Google Image Search."
                    : `${poorNames.length} of ${srcs.length} images have generic filenames (IMG_*, screenshot*, hash strings). Examples: ${poorNames.slice(0, 3).map(s => s.split("/").pop()).join(", ")}`,
                recommendation: poorPct > 0 ? {
                    text: [
                        `• Rename image files to describe their content: "seo-audit-dashboard.webp" not "IMG_001.jpg".`,
                        `• Use hyphens, not underscores or spaces.`,
                        `• Include the target keyword where naturally relevant.`,
                        `• Update your CMS/CDN pipeline to enforce descriptive naming conventions.`,
                    ].join("\n"),
                    priority: poorPct > 50 ? "Medium" : "Low",
                } : undefined,
                roiImpact: 55,
                aiVisibilityImpact: 45,
                details: { totalImages: srcs.length, poorFilenames: poorNames.length, poorPercent: poorPct },
            });
        }

        // ── 4. Modern Image Formats (WebP / AVIF) ────────────────────────
        {
            const srcs        = images.map(img => img.getAttribute("src") ?? "").filter(s => !s.startsWith("data:"));
            const modernCount = srcs.filter(isModernFormat).length;
            const legacyCount = srcs.length - modernCount;
            const modernPct   = srcs.length > 0 ? Math.round((modernCount / srcs.length) * 100) : 100;

            // Also check <picture> + <source type="image/webp"> as a fallback signal
            const hasPictureWebP = context.html.toLowerCase().includes('type="image/webp"') ||
                                   context.html.toLowerCase().includes("type='image/webp'");

            items.push({
                id:    "img-modern-format",
                label: "Modern Image Formats (WebP / AVIF)",
                status: modernPct >= 80 || hasPictureWebP ? "Pass" : modernPct >= 40 ? "Warning" : "Fail",
                finding: modernPct >= 80
                    ? `${modernPct}% of images use WebP/AVIF — excellent for page speed and Core Web Vitals.`
                    : hasPictureWebP
                        ? `<picture> element with WebP source detected — progressive enhancement pattern is good.`
                        : `Only ${modernPct}% of images are WebP/AVIF. ${legacyCount} image(s) still use JPEG/PNG/GIF.`,
                recommendation: modernPct < 80 && !hasPictureWebP ? {
                    text: [
                        `• Convert ${legacyCount} JPEG/PNG image(s) to WebP (20–35% smaller at same quality).`,
                        `• Use <picture> with WebP source + JPEG fallback for older browsers.`,
                        `• Next.js users: use <Image> from "next/image" — it auto-converts to WebP.`,
                        `• Smaller images = faster LCP = higher Core Web Vitals score.`,
                    ].join("\n"),
                    priority: modernPct < 20 ? "High" : "Medium",
                } : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 60,
                details: { totalImages: srcs.length, modernFormat: modernCount, legacy: legacyCount, modernPercent: modernPct, hasPictureWebP },
            });
        }

        // ── 5. Lazy Loading ────────────────────────────────────────────────
        {
            // First image (LCP candidate) should NOT be lazy-loaded
            const firstImg      = images[0];
            const firstIsLazy   = firstImg ? hasLazyLoad(firstImg as never) : false;
            const belowFold     = images.slice(1); // skip first — should be eager
            const lazyCount     = belowFold.filter(img => hasLazyLoad(img as never)).length;
            const lazyPct       = belowFold.length > 0 ? Math.round((lazyCount / belowFold.length) * 100) : 100;

            items.push({
                id:    "img-lazy-loading",
                label: "Image Lazy Loading",
                status: firstIsLazy ? "Warning" : lazyPct >= 60 ? "Pass" : "Warning",
                finding: firstIsLazy
                    ? `The first image (LCP candidate) has lazy loading — this delays the Largest Contentful Paint and hurts Core Web Vitals.`
                    : lazyPct >= 60
                        ? `${lazyCount} of ${belowFold.length} secondary images have lazy loading — good for page speed.`
                        : `Only ${lazyPct}% of secondary images use lazy loading. Undeferred images slow initial page load.`,
                recommendation: firstIsLazy
                    ? {
                        text: `• Remove loading="lazy" from the first/hero image (the LCP candidate).\n• Set loading="eager" (or omit loading attribute) on the first visible image.\n• Apply loading="lazy" to all images below the fold.`,
                        priority: "High",
                    }
                    : lazyPct < 60 ? {
                        text: [
                            `• Add loading="lazy" to images below the fold (all except the first hero image).`,
                            `• Example: <img src="..." alt="..." loading="lazy" width="800" height="600">`,
                            `• Always include width and height attributes to prevent layout shift (CLS).`,
                        ].join("\n"),
                        priority: "Medium",
                    } : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 55,
                details: { totalImages: images.length, lazyLoaded: lazyCount, firstImageLazy: firstIsLazy, lazyPercent: lazyPct },
            });
        }

        // ── 6. Keyword in at Least One Alt ────────────────────────────────
        {
            const kw = (context.targetKeyword ?? "").trim().toLowerCase();
            if (kw) {
                const altTexts  = images.map(img => (img.getAttribute("alt") ?? "").trim().toLowerCase());
                const kwInAlt   = altTexts.some(alt => alt.includes(kw));

                items.push({
                    id:    "img-alt-keyword",
                    label: "Target Keyword in Image Alt Text",
                    status: kwInAlt ? "Pass" : "Warning",
                    finding: kwInAlt
                        ? `Target keyword "${kw}" found in at least one image alt attribute — good image SEO signal.`
                        : `Target keyword "${kw}" not found in any image alt text. Google Image Search ranks by alt relevance.`,
                    recommendation: !kwInAlt ? {
                        text: `• Add "${kw}" naturally to the alt text of the most relevant image on the page.\n• Don't force it — only use it where the image genuinely shows or relates to "${kw}".`,
                        priority: "Low",
                    } : undefined,
                    roiImpact: 55,
                    aiVisibilityImpact: 50,
                    details: { keyword: kw, foundInAlt: kwInAlt },
                });
            }
        }

        return score(items);
    },
};
