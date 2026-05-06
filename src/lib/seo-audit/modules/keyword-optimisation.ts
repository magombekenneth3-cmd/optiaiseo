// =============================================================================
// SEO Audit — Keyword Optimisation Module
// Checks whether the site's target keyword is correctly used throughout the page:
// title, H1, URL slug, meta description, first paragraph, headings, and density.
// =============================================================================

import { parse } from "node-html-parser";
import type { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Case-insensitive keyword occurrence count in text. */
function countOccurrences(text: string, kw: string): number {
    if (!kw) return 0;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (text.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? []).length;
}

/** Keyword density as a percentage (0–100). */
function density(text: string, kw: string): number {
    const wc = wordCount(text);
    if (wc === 0) return 0;
    const kwWords = wordCount(kw);
    const occurrences = countOccurrences(text, kw);
    return Math.round(((occurrences * kwWords) / wc) * 1000) / 10;
}

function score(items: ChecklistItem[]): AuditCategoryResult {
    const passed   = items.filter(i => i.status === "Pass" || i.status === "Info").length;
    const failed   = items.filter(i => i.status === "Fail").length;
    const warnings = items.filter(i => i.status === "Warning").length;
    const total    = passed + failed + warnings;
    const s        = total > 0 ? Math.round(((passed + warnings * 0.5) / total) * 100) : 100;
    return { id: KeywordOptimisationModule.id, label: KeywordOptimisationModule.label, items, score: s, passed, failed, warnings };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const KeywordOptimisationModule: AuditModule = {
    id:    "keyword-optimisation",
    label: "Keyword Optimisation",

    async run(context: AuditModuleContext): Promise<AuditCategoryResult> {
        const kw = (context.targetKeyword ?? "").trim().toLowerCase();

        // If no target keyword is set, return informational — no keyword to check.
        if (!kw) {
            return {
                id: KeywordOptimisationModule.id,
                label: KeywordOptimisationModule.label,
                score: 100,
                passed: 1, failed: 0, warnings: 0,
                items: [{
                    id:      "kw-no-target",
                    label:   "Target Keyword Not Set",
                    status:  "Info",
                    finding: "No target keyword configured for this site. Set one in Site Settings to enable keyword optimisation checks.",
                    roiImpact: 90,
                    aiVisibilityImpact: 80,
                }],
            };
        }

        const items: ChecklistItem[] = [];
        const root   = parse(context.html);
        const fullText = toText(context.html);

        // ── 1. Keyword in Title ─────────────────────────────────────────────
        {
            const titleText = (root.querySelector("title")?.textContent ?? "").trim().toLowerCase();
            const inTitle   = titleText.includes(kw);
            const isStart   = titleText.startsWith(kw);

            items.push({
                id:    "kw-in-title",
                label: "Keyword in Title Tag",
                status: inTitle ? "Pass" : "Fail",
                finding: inTitle
                    ? `Keyword "${kw}" found in title${isStart ? " (front-loaded — excellent)" : ""}. Title: "${titleText.slice(0, 70)}"`
                    : `Keyword "${kw}" is NOT in the title tag. Title: "${titleText.slice(0, 70)}"`,
                recommendation: !inTitle ? {
                    text:     `• Add "${kw}" to the <title> tag, ideally at the start.\n• Keep total title length 50–60 characters.\n• Example: "${kw.charAt(0).toUpperCase() + kw.slice(1)} | ${context.url.replace(/https?:\/\//, "").split("/")[0]}"`,
                    priority: "High",
                } : undefined,
                roiImpact: 95,
                aiVisibilityImpact: 85,
                details: { keyword: kw, titleText: titleText.slice(0, 80), frontLoaded: isStart },
            });
        }

        // ── 2. Keyword in H1 ───────────────────────────────────────────────
        {
            const h1Text = (root.querySelector("h1")?.textContent ?? "").trim().toLowerCase();
            const inH1   = h1Text.includes(kw);

            items.push({
                id:    "kw-in-h1",
                label: "Keyword in H1",
                status: inH1 ? "Pass" : "Fail",
                finding: h1Text
                    ? (inH1
                        ? `Keyword "${kw}" found in H1: "${h1Text.slice(0, 80)}"`
                        : `Keyword "${kw}" NOT in H1. H1: "${h1Text.slice(0, 80)}"`)
                    : `No H1 found on the page. Both keyword placement and heading hierarchy are missing.`,
                recommendation: !inH1 ? {
                    text:     `• Include "${kw}" naturally in the H1 tag.\n• The H1 should match search intent and be unique from the title.\n• Example: "${kw.charAt(0).toUpperCase() + kw.slice(1)} — Everything You Need to Know"`,
                    priority: "High",
                } : undefined,
                roiImpact: 90,
                aiVisibilityImpact: 80,
                details: { keyword: kw, h1Text: h1Text.slice(0, 80) },
            });
        }

        // ── 3. Keyword in URL Slug ─────────────────────────────────────────
        {
            const slug      = context.url.toLowerCase().replace(/https?:\/\/[^/]+/, "");
            const kwSlug    = kw.replace(/\s+/g, "-");
            const inUrl     = slug.includes(kwSlug) || slug.includes(kw.replace(/\s+/g, "_"));
            const isHomepage = slug === "/" || slug === "";

            items.push({
                id:    "kw-in-url",
                label: "Keyword in URL Slug",
                status: isHomepage ? "Info" : inUrl ? "Pass" : "Warning",
                finding: isHomepage
                    ? "Homepage URL — keyword in URL is not applicable."
                    : inUrl
                        ? `Keyword "${kw}" present in URL slug: "${slug}"`
                        : `Keyword "${kw}" NOT in URL slug: "${slug}". URL slugs are a lightweight ranking signal.`,
                recommendation: !isHomepage && !inUrl ? {
                    text:     `• Use "${kwSlug}" in the URL slug (e.g. /blog/${kwSlug}).\n• Keep slugs short, lowercase, hyphen-separated.\n• If changing live URL: set up a 301 redirect and update internal links.`,
                    priority: "Medium",
                } : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 55,
                details: { keyword: kw, slug },
            });
        }

        // ── 4. Keyword in Meta Description ────────────────────────────────
        {
            const metaEl   = root.querySelector("meta[name='description']") ?? root.querySelector("meta[name='Description']");
            const metaText = (metaEl?.getAttribute("content") ?? "").trim().toLowerCase();
            const inMeta   = metaText.includes(kw);
            const metaLen  = metaText.length;

            items.push({
                id:    "kw-in-meta-description",
                label: "Keyword in Meta Description",
                status: inMeta ? "Pass" : metaText.length > 0 ? "Warning" : "Fail",
                finding: !metaText
                    ? `No meta description found. Missing description loses CTR AND keyword context.`
                    : inMeta
                        ? `Keyword "${kw}" in meta description (${metaLen} chars).`
                        : `Keyword "${kw}" NOT in meta description (${metaLen} chars). Meta: "${metaText.slice(0, 120)}"`,
                recommendation: !inMeta ? {
                    text:     `• Include "${kw}" naturally in the meta description.\n• Target 150–160 characters.\n• Include a benefit + CTA: "Discover how to [action] with [kw] — [benefit]. Start free today."`,
                    priority: inMeta ? "Low" : "Medium",
                } : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 65,
                details: { keyword: kw, metaLength: metaLen, inMeta },
            });
        }

        // ── 5. Keyword in First 100 Words ─────────────────────────────────
        {
            const bodyEl   = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body");
            const bodyText = toText(bodyEl?.innerHTML ?? context.html);
            const first150 = bodyText.split(/\s+/).slice(0, 150).join(" ").toLowerCase();
            const inFirst  = first150.includes(kw);

            items.push({
                id:    "kw-in-first-paragraph",
                label: "Keyword in First 100–150 Words",
                status: inFirst ? "Pass" : "Warning",
                finding: inFirst
                    ? `Keyword "${kw}" appears in the opening section — good relevance signal.`
                    : `Keyword "${kw}" not found in the first 150 words. Opening: "${first150.slice(0, 120)}…"`,
                recommendation: !inFirst ? {
                    text:     `• Mention "${kw}" naturally in the first paragraph (within 100 words of the opening sentence).\n• This tells both crawlers and AI engines what the page is about immediately.`,
                    priority: "Medium",
                } : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 75,
                details: { keyword: kw, foundInFirst150: inFirst },
            });
        }

        // ── 6. Keyword in H2 / H3 Subheadings ────────────────────────────
        {
            const h2Texts = Array.from(root.querySelectorAll("h2, h3")).map(el => el.textContent.trim().toLowerCase());
            const matchingH = h2Texts.filter(h => h.includes(kw));
            const kwWords   = kw.split(/\s+/);
            // Also check for partial keyword (individual words appear in headings)
            const partialH  = h2Texts.filter(h => kwWords.every(w => h.includes(w)));

            items.push({
                id:    "kw-in-subheadings",
                label: "Keyword / Variations in Subheadings",
                status: matchingH.length >= 1 ? "Pass" : partialH.length >= 1 ? "Warning" : "Fail",
                finding: matchingH.length >= 1
                    ? `Keyword "${kw}" found in ${matchingH.length} H2/H3 subheading(s).`
                    : partialH.length >= 1
                        ? `Keyword words found spread across headings but not as a phrase. Consider tighter alignment.`
                        : `Keyword "${kw}" not found in any H2 or H3 heading (${h2Texts.length} headings checked).`,
                recommendation: matchingH.length === 0 ? {
                    text:     `• Include "${kw}" (or a natural variation) in at least one H2 or H3.\n• Variations like "${kw} tips", "best ${kw}", "how to use ${kw}" are all valid.\n• This helps Google understand content depth and topical coverage.`,
                    priority: "Medium",
                } : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 70,
                details: { keyword: kw, h2h3Count: h2Texts.length, matchingCount: matchingH.length },
            });
        }

        // ── 7. Keyword Density ────────────────────────────────────────────
        {
            const dens = density(fullText, kw);
            const wc   = wordCount(fullText);

            let status: ChecklistItem["status"] = "Pass";
            let finding = `Keyword density: ${dens}% (${countOccurrences(fullText, kw)} occurrences in ~${wc} words). Ideal range: 0.5–2%.`;
            let rec: ChecklistItem["recommendation"];

            if (dens === 0) {
                status  = "Fail";
                finding = `Keyword "${kw}" does not appear in the body text at all.`;
                rec     = { text: `• Use "${kw}" naturally throughout the page body, aiming for 0.5–2% density.\n• Don't force it — write for readers and let the keyword appear naturally.`, priority: "High" };
            } else if (dens < 0.5) {
                status  = "Warning";
                finding = `Keyword density: ${dens}% — below 0.5%. The keyword appears but is underused.`;
                rec     = { text: `• Increase mentions of "${kw}" to at least 0.5% density.\n• Add related terms (LSI keywords) to support the primary keyword.`, priority: "Medium" };
            } else if (dens > 3) {
                status  = "Warning";
                finding = `Keyword density: ${dens}% — above 3%. This may look like keyword stuffing to Google.`;
                rec     = { text: `• Reduce exact repetitions of "${kw}" and replace with synonyms or related terms.\n• Google's algorithms penalise unnatural repetition.`, priority: "Medium" };
            }

            items.push({
                id:    "kw-density",
                label: "Keyword Density",
                status, finding, recommendation: rec,
                roiImpact: 70,
                aiVisibilityImpact: 60,
                details: { keyword: kw, densityPercent: dens, occurrences: countOccurrences(fullText, kw), wordCount: wc },
            });
        }

        // ── 8. LSI / Semantic Keyword Coverage ───────────────────────────
        {
            // Check if related semantic terms / variations appear on the page
            // We derive simple variations: plural, gerund, adjective forms
            const kwBase       = kw.replace(/s$/, "").replace(/ing$/, "");
            const kwParts      = kw.split(/\s+/);
            const relatedFound = kwParts.filter(part => part.length > 4 && fullText.toLowerCase().includes(part)).length;
            const hasVariants  = fullText.toLowerCase().includes(kwBase);
            const relatedRatio = kwParts.length > 0 ? relatedFound / kwParts.length : 0;

            items.push({
                id:    "kw-semantic-coverage",
                label: "Semantic / LSI Keyword Coverage",
                status: relatedRatio >= 0.8 ? "Pass" : relatedRatio >= 0.5 ? "Warning" : "Fail",
                finding: relatedRatio >= 0.8
                    ? `Good semantic coverage: ${relatedFound}/${kwParts.length} keyword components and base form found in content.`
                    : `Weak semantic coverage: only ${relatedFound}/${kwParts.length} keyword components found. Content may lack topic depth.`,
                recommendation: relatedRatio < 0.8 ? {
                    text:     [
                        `• Use related terms and synonyms for "${kw}" (LSI keywords).`,
                        `• Tools like Google's "Related Searches" and "People Also Ask" reveal semantic terms to add.`,
                        `• Comprehensive topic coverage signals expertise to both Google and AI engines.`,
                    ].join("\n"),
                    priority: relatedRatio < 0.5 ? "High" : "Medium",
                } : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 80,
                details: { keyword: kw, relatedTermsFound: relatedFound, totalParts: kwParts.length, hasBaseForm: hasVariants },
            });
        }

        return score(items);
    },
};
