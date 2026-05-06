import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from "../types"
import { fetchHtml } from "../utils/fetch-html"
import { parse } from "node-html-parser"

const AUTHORITATIVE_DOMAINS = new Set([
    "pubmed.ncbi.nlm.nih.gov", "who.int", "cdc.gov", "reuters.com",
    "apnews.com", "bbc.com", "bbc.co.uk", "nature.com", "sciencedirect.com",
    "ncbi.nlm.nih.gov", "nih.gov", "nhs.uk", "harvard.edu", "mit.edu",
])

const AUTHOR_CANDIDATE_PATHS = ["/about", "/team", "/author", "/authors", "/about-us"]

function toPlainText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function toSentences(text: string): string[] {
    return text
        .split(/(?<=[.!?])\s+(?=[A-Z])/)
        .map((s) => s.trim())
        .filter((s) => s.split(/\s+/).length >= 3)
}

function scoreItems(items: ChecklistItem[]): AuditCategoryResult {
    const passed = items.filter((i) => i.status === "Pass" || i.status === "Info").length
    const failed = items.filter((i) => i.status === "Fail").length
    const warnings = items.filter((i) => i.status === "Warning").length
    const total = passed + failed + warnings
    const score = total > 0 ? Math.round(((passed + warnings * 0.5) / total) * 100) : 100

    return {
        id: ContentQualityModule.id,
        label: ContentQualityModule.label,
        items,
        score,
        passed,
        failed,
        warnings,
    }
}

function parseJsonLdBlocks(html: string): object[] {
    const root = parse(html)
    const results: object[] = []
    for (const block of root.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            results.push(JSON.parse(block.textContent?.trim() ?? "{}"))
        } catch {
            // malformed JSON-LD — skip
        }
    }
    return results
}

export const ContentQualityModule: AuditModule = {
    id: "content-quality",
    label: "Content Quality & E-E-A-T",

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        if (!context.html) {
            return scoreItems([{
                id: "cq-fetch-error",
                label: "Content Quality Audit",
                status: "Error",
                finding: "Could not fetch page HTML — content quality checks skipped.",
                roiImpact: 0,
                aiVisibilityImpact: 0,
            }])
        }

        const html = context.html
        const root = parse(html)
        const bodyText = toPlainText(html)
        const words = bodyText.split(/\s+/).filter((w) => w.length > 0)
        const wordCount = words.length
        const sentences = toSentences(bodyText)
        const items: ChecklistItem[] = []
        const jsonLdObjects = parseJsonLdBlocks(html)
        const combinedSchema = jsonLdObjects.map((o) => JSON.stringify(o)).join(" ").toLowerCase()

        // 1. Author Attribution
        {
            const hasPersonSchema = combinedSchema.includes('"@type":"person"') || combinedSchema.includes('"@type": "person"')
            const hasAuthorField = combinedSchema.includes('"author"')
            const hasJobTitle = combinedSchema.includes('"jobtitle"') || combinedSchema.includes('"job_title"')
            const hasSameAs = combinedSchema.includes('"sameas"')
            const authorInHtml = /\b(written by|author:|by [A-Z][a-z]+ [A-Z][a-z]+)\b/i.test(bodyText)
            const hasAuthorBio = root.querySelector('[class*="author-bio"], [class*="author_bio"], [itemprop="author"]') !== null

            const authorScore = [hasPersonSchema, hasAuthorField, hasJobTitle, hasSameAs, authorInHtml, hasAuthorBio].filter(Boolean).length

            items.push({
                id: "eeat-author-attribution",
                label: "E-E-A-T: Author Attribution",
                status: authorScore >= 3 ? "Pass" : authorScore >= 1 ? "Warning" : "Fail",
                finding:
                    authorScore >= 3
                        ? `Strong author attribution: Person schema${hasJobTitle ? " with jobTitle" : ""}${hasSameAs ? " and sameAs social profiles" : ""} detected.`
                        : authorScore >= 1
                            ? `Partial attribution: ${[
                                hasAuthorField && "author field in schema",
                                authorInHtml && '"Written by" detected in text',
                                hasAuthorBio && '[itemprop="author"] element found',
                            ].filter(Boolean).join(", ")}. Missing explicit Person schema.`
                            : "No author attribution found. Google's E-E-A-T guidelines and AI engines rate authorless content as low-trust.",
                recommendation:
                    authorScore < 3
                        ? {
                            text: [
                                '• Add a Person JSON-LD schema with: "@type":"Person", "name", "jobTitle", "sameAs" (link to LinkedIn, Twitter).',
                                '• Add a visible byline: "Written by [Name], [Role]" above or below the article.',
                                "• Include an author bio section with a headshot and 2–3 sentences of expertise.",
                                "• Link the author name to a dedicated /team/[name] page (builds author entity in Google's Knowledge Graph).",
                            ].join("\n"),
                            priority: authorScore === 0 ? "High" : "Medium",
                        }
                        : undefined,
                roiImpact: 85,
                aiVisibilityImpact: 90,
                details: { hasPersonSchema, hasAuthorField, hasJobTitle, hasSameAs, authorInHtml, hasAuthorBio, authorScore },
            })
        }

        // 2. Trustworthiness Signals
        {
            const allHrefs = Array.from(root.querySelectorAll("a[href]")).map((a) =>
                (a.getAttribute("href") ?? "").toLowerCase()
            )

            const hasAbout = allHrefs.some((h) => h.includes("/about") || h.includes("about-us"))
            const hasContact = allHrefs.some((h) => h.includes("/contact") || h.includes("contact-us"))
            const hasPrivacy = allHrefs.some((h) => h.includes("/privacy") || h.includes("/privacy-policy"))
            const hasAddress =
                /\d{1,5}\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct)\b/i.test(bodyText)

            const trustScore = [hasAbout, hasContact, hasPrivacy].filter(Boolean).length

            items.push({
                id: "eeat-trustworthiness",
                label: "E-E-A-T: Trustworthiness Signals",
                status: trustScore === 3 ? "Pass" : trustScore >= 2 ? "Warning" : "Fail",
                finding:
                    trustScore === 3
                        ? `All core trust links found: About, Contact, Privacy Policy.${hasAddress ? " Physical address detected — strong local trust signal." : ""}`
                        : `Missing trust links: ${[!hasAbout && "/about", !hasContact && "/contact", !hasPrivacy && "/privacy"].filter(Boolean).join(", ")}. Google's Quality Raters check these links to assess site legitimacy.`,
                recommendation:
                    trustScore < 3
                        ? {
                            text: [
                                !hasAbout && "• Create and link to an /about page explaining who runs the site, your mission, and credentials.",
                                !hasContact && "• Create and link to a /contact page with email, phone, or contact form.",
                                !hasPrivacy && "• Create and link to a /privacy-policy page. Required for GDPR and Google's spam policies.",
                                !hasAddress && "• If a local business: add your physical address in the footer using LocalBusiness schema.",
                            ].filter(Boolean).join("\n"),
                            priority: trustScore === 0 ? "High" : "Medium",
                        }
                        : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 85,
                details: { hasAbout, hasContact, hasPrivacy, hasAddress, trustScore },
            })
        }

        // 3. Expertise & Citation Signals
        {
            const hasCite = root.querySelectorAll("cite").length > 0
            const hasBlockquote = root.querySelectorAll("blockquote").length > 0
            const hasSourceRef = /\b(according to|source:|cited in|published in|per [A-Z])\b/i.test(bodyText)
            const hasExpertName = /\b(Dr\.|Prof\.|CEO|CTO|Founder|Director)[^.]{3,40}(said|says|notes|explains|states)\b/i.test(bodyText)
            const expertiseScore = [hasCite, hasBlockquote, hasSourceRef, hasExpertName].filter(Boolean).length

            items.push({
                id: "eeat-expertise-signals",
                label: "E-E-A-T: Expertise & Citation Signals",
                status: expertiseScore >= 2 ? "Pass" : "Warning",
                finding:
                    expertiseScore >= 2
                        ? `Expertise signals found: ${[
                            hasCite && "<cite> elements",
                            hasBlockquote && "<blockquote> quotes",
                            hasSourceRef && "source references",
                            hasExpertName && "named expert quotes",
                        ].filter(Boolean).join(", ")}.`
                        : "Weak expertise signals. No named experts, <cite> tags, or source references found.",
                recommendation:
                    expertiseScore < 2
                        ? {
                            text: [
                                '• Quote at least one named expert per article: "According to [Name], [Role at Company]..."',
                                "• Add <cite> tags around book, study, or article references.",
                                "• Use <blockquote> for meaningful extracts from credible sources.",
                                "• Link to original sources (gov, .edu, well-known industry publications) with specific claims.",
                                '• If the content is based on personal experience, make that explicit: "In building X, we found..."',
                            ].join("\n"),
                            priority: "Medium",
                        }
                        : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 88,
                details: { hasCite, hasBlockquote, hasSourceRef, hasExpertName, expertiseScore },
            })
        }

        // 4. Reading Level & AI Extractability
        {
            const wordCounts = sentences.map((s) => s.split(/\s+/).length)
            const avgSentenceLength =
                wordCounts.length > 0 ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0

            const avgSyllables =
                wordCount > 0
                    ? words.reduce((sum, w) => sum + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length), 0) / wordCount
                    : 0

            const fleschEase =
                sentences.length > 0
                    ? Math.min(100, Math.max(0, Math.round(206.835 - 1.015 * (wordCount / sentences.length) - 84.6 * avgSyllables)))
                    : -1

            const isComplex = avgSentenceLength > 25
            const isPunchy = avgSentenceLength <= 15
            const gradeLabel = fleschEase >= 70 ? "Easy to read" : fleschEase >= 50 ? "Moderately complex" : "Difficult"

            items.push({
                id: "content-reading-level",
                label: "Content Reading Level & AI Extractability",
                status: isComplex ? "Warning" : "Pass",
                finding:
                    sentences.length < 3
                        ? "Not enough content on this page to assess reading level accurately."
                        : isComplex
                            ? `Average sentence length is ${avgSentenceLength} words (target: ≤20). Flesch Reading Ease: ${fleschEase} (${gradeLabel}). Long sentences reduce AI extractability.`
                            : `Average sentence length is ${avgSentenceLength} words. Flesch Reading Ease: ${fleschEase} (${gradeLabel}). Content is ${isPunchy ? "punchy and highly extractable" : "readable and appropriately complex"}.`,
                recommendation:
                    isComplex
                        ? {
                            text: [
                                "• Break sentences longer than 25 words into two shorter ones.",
                                "• Start key answer paragraphs with a direct 1-sentence summary.",
                                "• Use bullet lists for items you'd normally cram into a long sentence.",
                                `• Aim for Flesch Reading Ease > 60 (currently ${fleschEase}).`,
                            ].join("\n"),
                            priority: "Medium",
                        }
                        : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 80,
                details: {
                    avgSentenceLength,
                    sentenceCount: sentences.length,
                    fleschEase: fleschEase >= 0 ? fleschEase : "N/A (insufficient content)",
                    readingGrade: gradeLabel,
                },
            })
        }

        // 5. Factual Claims Density
        {
            const statMatches =
                bodyText.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(%|percent|million|billion|thousand|x faster|x more|x better|fold|times faster)\b/gi) ?? []
            const sourceMatches = bodyText.match(/\b(according to|source:|study|research|report|survey)\b/gi) ?? []
            const yearRefMatches = bodyText.match(/\b(20\d{2})\b/g) ?? []

            const factScore = statMatches.length + Math.min(3, sourceMatches.length)
            const isDataRich = wordCount > 300 && factScore >= 3
            const isDataThin = wordCount > 300 && factScore === 0

            items.push({
                id: "factual-claims-density",
                label: "Factual Claims & Data Density",
                status: isDataThin ? "Fail" : isDataRich ? "Pass" : "Warning",
                finding:
                    isDataThin
                        ? `No statistics or data references found in this ${wordCount}-word article. Content with zero verifiable data points is outranked by data-dense competitors.`
                        : isDataRich
                            ? `Strong data density: ${statMatches.length} statistic(s), ${sourceMatches.length} source reference(s).`
                            : `Low data density: ${statMatches.length} statistic(s), ${sourceMatches.length} source reference(s)${wordCount > 300 ? ` in ${wordCount} words` : ""}.`,
                recommendation:
                    !isDataRich
                        ? {
                            text: [
                                "• Add at least 3–5 specific statistics with their source (year + publication name).",
                                '• Replace vague claims ("many businesses") with specific ones ("67% of SMBs, per HubSpot 2024").',
                                "• Use a comparison table to frame data-heavy arguments clearly.",
                                "• If no third-party data exists, collect and publish your own — these become primary sources.",
                            ].join("\n"),
                            priority: isDataThin ? "High" : "Medium",
                        }
                        : undefined,
                roiImpact: 78,
                aiVisibilityImpact: 92,
                details: { statisticsFound: statMatches.length, sourceReferences: sourceMatches.length, yearReferences: yearRefMatches.length, wordCount },
            })
        }

        // 6. Content Depth vs Topic Scope
        {
            const h2Count = root.querySelectorAll("h2").length
            const h3Count = root.querySelectorAll("h3").length
            const isThin = h2Count >= 5 && wordCount < 800
            const isDeep = wordCount >= 1500 && h2Count >= 3

            if (h2Count > 0) {
                items.push({
                    id: "content-depth-ratio",
                    label: "Content Depth vs Topic Scope",
                    status: isThin ? "Fail" : isDeep ? "Pass" : "Warning",
                    finding:
                        isThin
                            ? `Thin content detected: ${h2Count} H2 sections but only ${wordCount} words. Many headings with little substance is a known AI-content quality signal.`
                            : isDeep
                                ? `Good depth: ${wordCount} words across ${h2Count} H2s and ${h3Count} H3s — well-structured and substantive.`
                                : `Adequate structure (${h2Count} H2s, ${h3Count} H3s, ${wordCount} words) but could be deeper.`,
                    recommendation:
                        isThin
                            ? {
                                text: [
                                    "• Expand each H2 section to at least 150–200 words of substantive text.",
                                    "• Remove sections that cannot be meaningfully expanded — fewer deep sections beats many shallow ones.",
                                    "• Add real examples, case studies, and step-by-step explanations under each H2.",
                                    "• Target at least 1,000 words for informational content, 500+ for commercial landing pages.",
                                ].join("\n"),
                                priority: "High",
                            }
                            : !isDeep
                                ? {
                                    text: "Aim for 1,500+ words for competitive informational queries. Add sub-sections (H3s) with real examples, FAQs, and supporting data.",
                                    priority: "Low",
                                }
                                : undefined,
                    roiImpact: 82,
                    aiVisibilityImpact: 78,
                    details: { h2Count, h3Count, wordCount, isThin, isDeep },
                })
            }
        }

        // 7. Keyword Cannibalization Signal
        {
            const stripBrand = (s: string) => s.replace(/\s*[|–—-].+$/, "").trim()
            const titleCore = stripBrand(root.querySelector("title")?.textContent?.trim().toLowerCase() ?? "")
            const h1Core = stripBrand(root.querySelector("h1")?.textContent?.trim().toLowerCase() ?? "")
            const isIdentical = titleCore.length > 0 && titleCore === h1Core

            if (titleCore && h1Core) {
                items.push({
                    id: "keyword-cannibalization-hint",
                    label: "Keyword Cannibalization Risk",
                    status: isIdentical ? "Warning" : "Pass",
                    finding:
                        isIdentical
                            ? `Title and H1 are identical ("${titleCore.slice(0, 60)}"). When multiple pages target the same keyword phrase, Google struggles to determine which to rank.`
                            : "Title and H1 are differentiated — no same-page cannibalization signal detected.",
                    recommendation:
                        isIdentical
                            ? {
                                text: [
                                    '• Differentiate the H1 from the title: the title targets the keyword for SERPs; the H1 should expand it with context for the reader.',
                                    '• Example: Title: "SEO Audit Tool" → H1: "Free SEO Audit Tool — Find and Fix Every Technical Issue".',
                                    "• Run the competitor gap tool to check if other pages on your domain target the same primary keyword.",
                                ].join("\n"),
                                priority: "Medium",
                            }
                            : undefined,
                    roiImpact: 72,
                    aiVisibilityImpact: 65,
                    details: { titleCore: titleCore.slice(0, 80), h1Core: h1Core.slice(0, 80), isIdentical },
                })
            }
        }

        // 8. Direct Answer Block
        {
            const h1El = root.querySelector("h1")
            const allParas = Array.from(root.querySelectorAll("p"))
            const h1Idx = h1El ? html.indexOf(h1El.outerHTML) : -1
            const firstPAfterH1 =
                h1Idx >= 0
                    ? allParas.find((p) => html.indexOf(p.outerHTML) > h1Idx) ?? null
                    : root.querySelector("p")

            const introLength = firstPAfterH1?.textContent?.split(/\s+/).filter((w) => w.length > 0).length ?? 0
            const hasDirectAnswer = introLength >= 20 && introLength <= 150

            items.push({
                id: "direct-answer-block",
                label: "Direct Answer / AI-extractable Intro",
                status: hasDirectAnswer ? "Pass" : "Warning",
                finding:
                    hasDirectAnswer
                        ? `Opening paragraph is ${introLength} words — ideal length for AI engine extraction and featured snippet eligibility.`
                        : introLength > 150
                            ? `Opening paragraph is ${introLength} words — too long for AI extraction. Target 40–100 words.`
                            : introLength === 0
                                ? "No introductory paragraph found immediately after the H1."
                                : `Opening paragraph is only ${introLength} words — too short to satisfy search intent.`,
                recommendation:
                    !hasDirectAnswer
                        ? {
                            text: [
                                "• Start every content page with a 40–100 word paragraph that directly answers the implied question of the H1.",
                                '• Format: [What it is] → [Why it matters] → [What this page covers]. No preamble, no "In this article...".',
                                "• This paragraph is what Perplexity, ChatGPT, and Google AI Overviews extract — it is the most valuable real estate on the page.",
                            ].join("\n"),
                            priority: "High",
                        }
                        : undefined,
                roiImpact: 88,
                aiVisibilityImpact: 95,
                details: { introWordCount: introLength, hasDirectAnswer },
            })
        }

        // 9. Author Page Existence
        try {
            const origin = new URL(context.url).origin
            const allHrefs = Array.from(root.querySelectorAll("a[href]")).map((a) =>
                (a.getAttribute("href") ?? "").toLowerCase()
            )

            const authorPageLink = allHrefs.find(
                (h) => AUTHOR_CANDIDATE_PATHS.some((p) => h.includes(p)) || /\/team\/[a-z]/i.test(h) || /\/author\/[a-z]/i.test(h)
            )

            let authorPageExists = false
            let authorPageHasPersonSchema = false

            for (const path of ["/about", "/team", "/authors"]) {
                try {
                    const testUrl = `${origin}${path}`
                    const testRes = await fetch(testUrl, {
                        method: "HEAD",
                        signal: AbortSignal.timeout(4000),
                        headers: { "User-Agent": "OptiAISEO-Audit/1.0" },
                    })
                    if (testRes.ok) {
                        authorPageExists = true
                        const aboutHtml = await fetchHtml(testUrl).catch(() => "")
                        authorPageHasPersonSchema =
                            aboutHtml.toLowerCase().includes('"@type":"person"') ||
                            aboutHtml.toLowerCase().includes('"@type": "person"')
                        break
                    }
                } catch {
                    // unreachable — continue
                }
            }

            const authorScore = (authorPageExists ? 2 : 0) + (authorPageHasPersonSchema ? 2 : 0) + (authorPageLink ? 1 : 0)

            items.push({
                id: "eeat-author-page",
                label: "E-E-A-T: Author / About Page Existence",
                status: authorScore >= 4 ? "Pass" : authorScore >= 2 ? "Warning" : "Fail",
                finding:
                    authorScore >= 4
                        ? `Author/About page confirmed${authorPageHasPersonSchema ? " with Person JSON-LD schema" : ""}.`
                        : authorPageExists
                            ? "Author/About page exists but is missing Person JSON-LD schema."
                            : authorPageLink
                                ? "Author/About link found but the target URL appears unreachable or not indexed."
                                : "No author page or About page found.",
                recommendation:
                    authorScore < 4
                        ? {
                            text: [
                                "• Create a dedicated /about or /team page with a photo, bio, credentials, and links to social profiles.",
                                '• Add Person JSON-LD schema: { "@type": "Person", "name": "...", "jobTitle": "...", "sameAs": [...] }.',
                                "• Link the author's name from every blog post byline to their /team/[slug] page.",
                            ].join("\n"),
                            priority: authorScore === 0 ? "High" : "Medium",
                        }
                        : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 90,
                details: { authorPageExists, authorPageHasPersonSchema, authorPageLinkedFromPage: !!authorPageLink },
            })
        } catch {
            // network error — skip
        }

        // 10. Author Byline
        {
            const bylineEl = root.querySelector('a[rel="author"], [itemprop="author"], .author, .byline, [class*="author"]')
            const hasHtmlByline = (bylineEl?.textContent?.trim().length ?? 0) > 0

            let hasJsonLdAuthorName = false
            for (const obj of jsonLdObjects) {
                const o = obj as Record<string, unknown>
                const type = o["@type"]
                const author = o["author"] as Record<string, unknown> | string | undefined
                if (
                    (type === "Article" || type === "BlogPosting" || type === "NewsArticle") &&
                    author &&
                    (typeof author === "string" || (typeof author === "object" && author["name"]))
                ) {
                    hasJsonLdAuthorName = true
                    break
                }
            }

            const hasAuthorByline = hasHtmlByline || hasJsonLdAuthorName

            items.push({
                id: "eeat-author-byline",
                label: "E-E-A-T: Author Byline",
                status: hasAuthorByline ? "Pass" : "Fail",
                finding:
                    hasAuthorByline
                        ? `Author byline detected (${[hasHtmlByline && "HTML element", hasJsonLdAuthorName && "JSON-LD author.name"].filter(Boolean).join(" + ")}).`
                        : 'No author byline found (<a rel="author">, [itemprop="author"], .byline, or JSON-LD author).',
                recommendation:
                    !hasAuthorByline
                        ? {
                            text: '• Add a visible byline with <a rel="author" href="/team/author-name">Author Name</a>.\n• Add [itemprop="author"] to the byline element.\n• Include author.name in your Article/BlogPosting JSON-LD schema.',
                            priority: "High",
                        }
                        : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 85,
                details: { hasHtmlByline, hasJsonLdAuthorName },
            })
        }

        // 11. Publication & Update Dates
        {
            let hasJsonLdDatePublished = false
            let hasJsonLdDateModified = false

            for (const obj of jsonLdObjects) {
                const o = obj as Record<string, unknown>
                if (o["datePublished"]) hasJsonLdDatePublished = true
                if (o["dateModified"]) hasJsonLdDateModified = true
            }

            const hasDatePublished = !!(root.querySelector("time[datetime]") || root.querySelector('[itemprop="datePublished"]') || hasJsonLdDatePublished)
            const hasDateModified = !!(root.querySelector('[itemprop="dateModified"]') || hasJsonLdDateModified)

            items.push({
                id: "eeat-dates",
                label: "E-E-A-T: Publication & Update Dates",
                status: hasDatePublished ? (hasDateModified ? "Pass" : "Warning") : "Fail",
                finding:
                    hasDatePublished
                        ? `datePublished found. ${hasDateModified ? "dateModified also present — strong freshness signal." : "dateModified absent — AI engines deprioritise content without a last-updated date."}`
                        : "No publication date found. AI engines deprioritise undated content.",
                recommendation:
                    !hasDatePublished
                        ? {
                            text: '• Add <time datetime="YYYY-MM-DD" itemprop="datePublished"> to your article.\n• Add datePublished and dateModified to your Article JSON-LD schema in ISO 8601 format.',
                            priority: "High",
                        }
                        : !hasDateModified
                            ? {
                                text: '• Add dateModified to your Article JSON-LD and a visible "Last updated" label.',
                                priority: "Medium",
                            }
                            : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 80,
                details: { hasDatePublished, hasDateModified, hasJsonLdDatePublished, hasJsonLdDateModified },
            })
        }

        // 12. About / Author Page Link
        {
            const allHrefs = Array.from(root.querySelectorAll("a[href]")).map((a) =>
                (a.getAttribute("href") ?? "").toLowerCase()
            )
            const hasTrustPageLink = allHrefs.some(
                (h) => h.includes("/about") || h.includes("/team") || h.includes("/author") || h.includes("/who-we-are") || h.includes("/about-us")
            )

            items.push({
                id: "eeat-about-page-link",
                label: "E-E-A-T: About / Author Page Link",
                status: hasTrustPageLink ? "Pass" : "Warning",
                finding:
                    hasTrustPageLink
                        ? "Link to About/Team/Author page found — good trust signal for Google Quality Raters and AI engines."
                        : "No links to /about, /team, /author, or /who-we-are found on this page.",
                recommendation:
                    !hasTrustPageLink
                        ? {
                            text: "• Link to your /about or /team page from this page (typically in the header, footer, or author byline).\n• Ensure the target page includes Person JSON-LD schema.",
                            priority: "Medium",
                        }
                        : undefined,
                roiImpact: 60,
                aiVisibilityImpact: 70,
                details: { hasTrustPageLink },
            })
        }

        // 13. External Citations to Authoritative Sources
        {
            const externalHrefs = Array.from(root.querySelectorAll("a[href]"))
                .map((a) => (a.getAttribute("href") ?? "").toLowerCase())
                .filter((h) => h.startsWith("https://") || h.startsWith("http://"))

            const authoritativeLinks = externalHrefs.filter((h) => {
                try {
                    const domain = new URL(h).hostname.replace(/^www\./, "")
                    return domain.endsWith(".gov") || domain.endsWith(".edu") || AUTHORITATIVE_DOMAINS.has(domain)
                } catch {
                    return false
                }
            })

            const authLinkCount = authoritativeLinks.length

            items.push({
                id: "eeat-external-citations",
                label: "E-E-A-T: External Citations to Authoritative Sources",
                status: authLinkCount >= 2 ? "Pass" : authLinkCount === 1 ? "Warning" : "Fail",
                finding:
                    authLinkCount >= 2
                        ? `${authLinkCount} authoritative external citation(s) found — strong E-E-A-T signal.`
                        : authLinkCount === 1
                            ? "Only 1 authoritative external citation found. AI engines prefer content that cites 2+ trusted external sources."
                            : "No authoritative external citations found (.gov, .edu, or known authority domains).",
                recommendation:
                    authLinkCount < 2
                        ? {
                            text: "• Link to at least 2 authoritative sources when making factual claims.\n• Use rel=\"noopener\" on external links.\n• Cite studies or official data sources with specific URLs.",
                            priority: authLinkCount === 0 ? "High" : "Medium",
                        }
                        : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 75,
                details: { authoritativeLinkCount: authLinkCount, examples: authoritativeLinks.slice(0, 3).join(", ") },
            })
        }

        // 14. First-Hand Experience Signals
        {
            const firstPersonRegex = /\b(I |we |my |our )\b/i
            const specificNumbers =
                bodyText.match(/\b(\d[\d,.]*)\s*(\$|%|years?|hours?|days?|miles?|km|kg|lbs?|months?|weeks?|minutes?|seconds?)\b/gi) ?? []
            const locationSignals = bodyText.match(/\b(?:in|at|from)\s+[A-Z][a-z]{2,}/g) ?? []

            const experienceSignals =
                (firstPersonRegex.test(bodyText) ? 1 : 0) +
                (specificNumbers.length >= 2 ? 1 : 0) +
                (locationSignals.length >= 1 ? 1 : 0)

            items.push({
                id: "eeat-first-hand-experience",
                label: "E-E-A-T: First-Hand Experience Signals",
                status: experienceSignals >= 3 ? "Pass" : experienceSignals >= 1 ? "Warning" : "Fail",
                finding:
                    experienceSignals >= 3
                        ? "Strong first-hand experience signals: first-person voice, specific numbers/units, and location references detected."
                        : experienceSignals >= 1
                            ? `Weak experience signals (${experienceSignals}/3). Content lacks first-person voice, specific measurements, or named locations.`
                            : "No first-hand experience signals detected.",
                recommendation:
                    experienceSignals < 3
                        ? {
                            text: [
                                '• Use first-person voice ("I tested this", "We found that...", "In my experience...").',
                                '• Include specific numbers with units (e.g. "$4,200 saved over 6 months", "reduced load time by 340ms").',
                                "• Name specific locations, products, or events you personally encountered.",
                                "• Add a \"Key Takeaways\" section with your unique findings that can't be found elsewhere.",
                            ].join("\n"),
                            priority: experienceSignals === 0 ? "High" : "Medium",
                        }
                        : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 90,
                details: {
                    firstPersonDetected: firstPersonRegex.test(bodyText),
                    specificNumbersFound: specificNumbers.length,
                    locationSignalsFound: locationSignals.length,
                    experienceSignals,
                },
            })
        }

        return scoreItems(items)
    },
}