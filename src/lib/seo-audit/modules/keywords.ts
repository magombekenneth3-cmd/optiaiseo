import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem, AuditStatus } from "../types"
import { parse } from "node-html-parser"
import { getKeywordMetricsBatch, getSerpData, resolveLocationCode, DATAFORSEO_LOCATION_CODES } from "@/lib/keywords/dataforseo"

const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "shall", "can", "need", "your", "my",
    "our", "its", "this", "that", "these", "those", "it", "we", "they", "he", "she", "you",
    "not", "no", "so", "if", "as", "up", "out", "about", "from", "into", "through", "during",
    "before", "after", "above", "below", "between", "each", "all", "both", "few", "more",
    "most", "other", "some", "such", "than", "too", "very", "just", "then", "when", "where",
    "how", "what", "which", "who", "whom", "there", "here", "only", "also", "even", "still",
    "back", "use", "used", "using", "get", "make", "like", "time", "way", "see", "now", "know",
    "take", "come", "go", "new", "want", "look", "first", "one", "two", "three",
    "best", "guide", "complete", "proven", "ultimate", "expert", "top", "professional",
])

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

function extractPrimaryKeyword(title: string | null, h1: string | null): string {
    const words = tokenize(title ?? h1 ?? "")
    if (words.length === 0) return ""
    return words.length >= 2 && words[0].length > 3 && words[1].length > 3
        ? `${words[0]} ${words[1]}`
        : words[0] ?? ""
}

function countOccurrences(text: string, keyword: string): number {
    if (!keyword) return 0
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return (text.match(new RegExp(`\\b${escaped}\\b`, "gi")) ?? []).length
}

export const KeywordsModule: AuditModule = {
    id: "keywords",
    label: "Keyword Optimization",

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        if (!context.html) {
            return {
                id: KeywordsModule.id,
                label: KeywordsModule.label,
                items: [],
                score: 0,
                passed: 0,
                failed: 1,
                warnings: 0,
            }
        }

        const html = context.html
        const root = parse(html)
        const items: ChecklistItem[] = []

        const rawTitle = root.querySelector("title")?.textContent.trim().replace(/\s+/g, " ") ?? null
        const rawH1 = root.querySelector("h1")?.textContent.trim() ?? null
        const rawMetaDesc = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? null
        const cleanBodyText = (root.querySelector("body")?.textContent ?? "").replace(/\s+/g, " ").trim()
        const bodyWords = tokenize(cleanBodyText)
        const first100Words = cleanBodyText.split(/\s+/).slice(0, 150).join(" ").toLowerCase()

        let urlSlug = ""
        try {
            urlSlug = new URL(context.url).pathname.toLowerCase()
        } catch {
            // invalid URL — leave slug empty
        }

        const primaryKeyword =
            (context as any).targetKeyword as string | undefined
            ?? extractPrimaryKeyword(rawTitle, rawH1)
        const pkLabel = primaryKeyword ? `"${primaryKeyword}"` : "(could not detect)"

        // 0. Hidden Text
        {
            let hiddenStuffing = false

            if (primaryKeyword) {
                const styledNodes = root.querySelectorAll(
                    '[style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"], [style*="opacity:0"], [style*="opacity: 0"]'
                )
                for (const node of styledNodes) {
                    if (node.textContent.toLowerCase().includes(primaryKeyword.toLowerCase())) {
                        hiddenStuffing = true
                        break
                    }
                }
            }

            items.push({
                id: "hidden-text",
                label: "Hidden Text (Black-hat Check)",
                status: hiddenStuffing ? "Fail" : "Pass",
                finding: hiddenStuffing
                    ? `CRITICAL PENALTY RISK: Primary keyword ${pkLabel} was found inside a visually hidden container (display:none, visibility:hidden, etc.). This is a heavily penalized black-hat tactic.`
                    : "No hidden keyword text detected in inline styles.",
                recommendation: hiddenStuffing
                    ? { text: "Remove any hidden elements containing the keyword immediately. If injected by a CMS plugin, audit your plugins.", priority: "High" }
                    : undefined,
                roiImpact: 100,
                aiVisibilityImpact: 100,
            })
        }

        // 1. Keyword in Title
        {
            const inTitle = rawTitle ? rawTitle.toLowerCase().includes(primaryKeyword.toLowerCase()) : false
            const keywordIndex = rawTitle && primaryKeyword ? rawTitle.toLowerCase().indexOf(primaryKeyword.toLowerCase()) : -1
            const keywordCount = rawTitle && primaryKeyword ? countOccurrences(rawTitle.toLowerCase(), primaryKeyword.toLowerCase()) : 0
            const hasMultipleSeparators = rawTitle ? rawTitle.split(/\||-/).length > 3 : false

            let titleStatus: AuditStatus = "Pass"
            let titleFinding = ""
            let titleRec: ChecklistItem["recommendation"] = undefined

            if (!primaryKeyword) {
                titleStatus = "Warning"
                titleFinding = "Could not detect a primary keyword (title or H1 is missing)."
            } else if (!inTitle) {
                titleStatus = "Fail"
                titleFinding = `Primary keyword ${pkLabel} not found in the title tag. This is a high-impact SEO miss.`
                titleRec = {
                    text: `Add your primary keyword ${pkLabel} to the title tag — ideally in the first 3 words. Example: "${primaryKeyword} – [Brand]".`,
                    priority: "High",
                }
            } else if (keywordCount > 1 || hasMultipleSeparators) {
                titleStatus = "Warning"
                titleFinding = `[Over-optimized] Title tag appears spammy. Keyword ${pkLabel} appears ${keywordCount} times, or uses excessive dividers.`
                titleRec = {
                    text: `Write a natural title targeting ${pkLabel}. Repetitive keyword titles are a spam signal to Google.`,
                    priority: "Medium",
                }
            } else if (keywordIndex > 40) {
                titleStatus = "Warning"
                titleFinding = `Primary keyword ${pkLabel} appears late in the title tag (at character ${keywordIndex}). Words earlier in the title carry more weight.`
                titleRec = {
                    text: `Move ${pkLabel} to the beginning of your title tag to maximise its ranking power.`,
                    priority: "Medium",
                }
            } else {
                titleFinding = `Primary keyword ${pkLabel} is positioned well in the title tag.`
            }

            items.push({
                id: "keyword-in-title",
                label: "Primary Keyword in Title",
                status: titleStatus,
                finding: titleFinding,
                recommendation: titleRec,
                roiImpact: 90,
                aiVisibilityImpact: 85,
                details: { primaryKeyword, inTitle, keywordIndex, keywordCount },
            })
        }

        // 2. Keyword in H1
        {
            const inH1 = rawH1 ? rawH1.toLowerCase().includes(primaryKeyword.toLowerCase()) : false

            items.push({
                id: "keyword-in-h1",
                label: "Primary Keyword in H1",
                status: !rawH1 ? "Fail" : inH1 ? "Pass" : "Warning",
                finding: !rawH1
                    ? "No H1 found — search engines cannot confirm the page topic."
                    : inH1
                        ? `Primary keyword ${pkLabel} is present in the H1 tag.`
                        : `H1 does not contain primary keyword ${pkLabel}. H1 is the strongest on-page topical signal.`,
                recommendation:
                    rawH1 && !inH1
                        ? {
                            text: `Rewrite your H1 to naturally include the primary keyword ${pkLabel}.`,
                            priority: "High",
                        }
                        : undefined,
                roiImpact: 85,
                aiVisibilityImpact: 80,
                details: { h1Text: rawH1?.slice(0, 80) ?? "", inH1 },
            })
        }

        // 3. Keyword in Meta Description
        {
            const inMeta = rawMetaDesc ? rawMetaDesc.toLowerCase().includes(primaryKeyword.toLowerCase()) : false

            items.push({
                id: "keyword-in-meta-description",
                label: "Primary Keyword in Meta Description",
                status: !rawMetaDesc ? "Fail" : inMeta ? "Pass" : "Warning",
                finding: !rawMetaDesc
                    ? "No meta description — Google auto-generates one, usually suboptimally."
                    : inMeta
                        ? `Primary keyword ${pkLabel} found in meta description.`
                        : `Primary keyword ${pkLabel} is absent from the meta description. Google bolds the searched keyword in SERPs, improving CTR.`,
                recommendation:
                    rawMetaDesc && !inMeta
                        ? {
                            text: `Include ${pkLabel} naturally in your meta description. Google bolds keywords matching the search query, which increases click-through rate.`,
                            priority: "Medium",
                        }
                        : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 70,
                details: { primaryKeyword, inMeta },
            })
        }

        // 4. Keyword in First 100 Words
        {
            const inFirstWords = primaryKeyword ? first100Words.includes(primaryKeyword.toLowerCase()) : false

            items.push({
                id: "keyword-in-first-100-words",
                label: "Keyword in First 100 Words",
                status: !primaryKeyword ? "Warning" : inFirstWords ? "Pass" : "Warning",
                finding: !primaryKeyword
                    ? "Primary keyword could not be detected."
                    : inFirstWords
                        ? `Primary keyword ${pkLabel} appears in the first ~100 words.`
                        : `Primary keyword ${pkLabel} does not appear in the first 100 words. Google weighs early mention more heavily.`,
                recommendation:
                    primaryKeyword && !inFirstWords
                        ? {
                            text: `Place your primary keyword ${pkLabel} in the first paragraph (within the first 100 words).`,
                            priority: "Medium",
                        }
                        : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 65,
                details: { primaryKeyword, inFirstWords },
            })
        }

        // 5. Keyword in URL Slug
        {
            const kwSlug = primaryKeyword ? primaryKeyword.toLowerCase().replace(/\s+/g, "-") : ""
            const kwWords = primaryKeyword ? primaryKeyword.toLowerCase().split(/\s+/) : []
            const inUrl =
                !!primaryKeyword && (urlSlug.includes(kwSlug) || kwWords.every((w) => urlSlug.includes(w)))

            const isHomepage = urlSlug === "/" || urlSlug === ""
            const pathParts = urlSlug.split("/").filter(Boolean)
            const lastPart = pathParts[pathParts.length - 1] ?? ""
            const slugWordCount = lastPart.split(/[-_]/).length
            const hasQueryParams = context.url.includes("?")
            const hasUnderscores = urlSlug.includes("_")

            let urlStatus: AuditStatus = "Pass"
            let urlFinding = ""
            let urlRec: ChecklistItem["recommendation"] = undefined

            if (isHomepage) {
                urlFinding = "Homepage URL — no slug keyword required."
            } else if (!primaryKeyword) {
                urlStatus = "Warning"
                urlFinding = "Could not detect a primary keyword."
            } else if (hasQueryParams) {
                urlStatus = "Fail"
                urlFinding = "URL contains query parameters instead of a clean, static slug. This reduces indexing efficiency."
                urlRec = { text: "Configure clean routing (e.g., /category/shoes instead of /products?cat=shoes).", priority: "High" }
            } else if (!inUrl) {
                urlStatus = "Warning"
                urlFinding = `URL slug does not contain primary keyword ${pkLabel}. Current path: "${urlSlug}".`
                urlRec = {
                    text: `Include your primary keyword in the URL slug. Ideal: /${kwSlug}/. Keep URLs short, lowercase, and hyphen-separated. Note: changing URLs requires a 301 redirect.`,
                    priority: "Medium",
                }
            } else if (slugWordCount > 5) {
                urlStatus = "Warning"
                urlFinding = `URL slug is too long (${slugWordCount} words). Long URLs dilute keyword focus.`
                urlRec = { text: `Shorten the URL slug to 2–5 words focusing solely on ${pkLabel}.`, priority: "Medium" }
            } else if (hasUnderscores) {
                urlStatus = "Warning"
                urlFinding = "URL slug uses underscores instead of hyphens. Google treats hyphens as word separators, underscores as word joiners."
                urlRec = { text: "Replace underscores with hyphens in your URLs.", priority: "Medium" }
            } else {
                urlFinding = `URL slug is concise, uses hyphens, and contains primary keyword ${pkLabel}.`
            }

            items.push({
                id: "keyword-in-url",
                label: "URL Structure & Keyword Strategy",
                status: urlStatus,
                finding: urlFinding,
                recommendation: urlRec,
                roiImpact: 60,
                aiVisibilityImpact: 55,
                details: { urlSlug, primaryKeyword, kwSlug, inUrl },
            })
        }

        // 6. Keyword Density
        {
            const totalWordCount = bodyWords.length
            const keywordOccurrences = primaryKeyword ? countOccurrences(cleanBodyText, primaryKeyword) : 0
            const phraseWordCount = primaryKeyword.split(/\s+/).length
            const density =
                totalWordCount > 0
                    ? parseFloat(((keywordOccurrences * phraseWordCount) / totalWordCount * 100).toFixed(2))
                    : 0

            let densityStatus: AuditStatus = "Pass"
            let densityFinding = ""
            let densityRec: ChecklistItem["recommendation"] = undefined

            if (!primaryKeyword || totalWordCount < 100) {
                densityStatus = "Warning"
                densityFinding = `Not enough body text (${totalWordCount} words) to calculate meaningful keyword density.`
                densityRec = { text: "Write at least 300 words of substantive content to allow accurate keyword density analysis.", priority: "Medium" }
            } else if (density < 0.5) {
                densityStatus = "Warning"
                densityFinding = `[Under-optimized] Keyword density too low: ${pkLabel} appears ${keywordOccurrences} time(s) in ${totalWordCount} words (${density}%).`
                densityRec = {
                    text: `Increase natural usage of ${pkLabel} — aim for 0.5%–1.5% density. Add it to subheadings, image alt text, and the conclusion.`,
                    priority: "Medium",
                }
            } else if (density > 4.0) {
                densityStatus = "Fail"
                densityFinding = `[Keyword Stuffing] ${pkLabel} appears ${keywordOccurrences} time(s) (${density}% density). Google penalises over-optimised content.`
                densityRec = {
                    text: `Reduce ${pkLabel} usage to 1–1.5% density. Use semantic variations and related terms instead of repeating the exact phrase.`,
                    priority: "High",
                }
            } else if (density > 2.0) {
                densityStatus = "Warning"
                densityFinding = `[Over-optimized] Keyword density is high: ${pkLabel} appears ${keywordOccurrences} time(s) (${density}%). You are risking a penalty.`
                densityRec = { text: `Reduce ${pkLabel} usage slightly. Target 1–1.5% density.`, priority: "Medium" }
            } else {
                densityFinding = `[Ideal] Keyword density is healthy: ${pkLabel} appears ${keywordOccurrences} time(s) (${density}% — ideal range: 0.5%–1.5%).`
            }

            items.push({
                id: "keyword-density",
                label: "Keyword Density",
                status: densityStatus,
                finding: densityFinding,
                recommendation: densityRec,
                roiImpact: 75,
                aiVisibilityImpact: 70,
                details: { primaryKeyword, occurrences: keywordOccurrences, totalWords: totalWordCount, density },
            })
        }

        // 7. LSI / Semantic Keyword Variety
        {
            const allSubheadings = root.querySelectorAll("h2, h3")
            const pkTokens = new Set(tokenize(primaryKeyword))
            const semanticTokens = [...new Set(bodyWords)].filter((t) => !pkTokens.has(t))
            const semanticDiversity = semanticTokens.length

            const subheadingsWithVariety = Array.from(allSubheadings).filter((h) =>
                tokenize(h.textContent).some((t) => !pkTokens.has(t) && t.length > 3)
            ).length

            const subheadingsWithExactKeyword = Array.from(allSubheadings).filter(
                (h) => primaryKeyword && h.textContent.toLowerCase().includes(primaryKeyword.toLowerCase())
            ).length

            const exactKeywordPercent =
                allSubheadings.length > 0 ? subheadingsWithExactKeyword / allSubheadings.length : 0

            let lsiStatus: AuditStatus = "Pass"
            let lsiFinding = ""
            let lsiRec: ChecklistItem["recommendation"] = undefined

            if (allSubheadings.length === 0) {
                lsiStatus = "Warning"
                lsiFinding = "No H2/H3 subheadings found. Semantic keyword variety cannot be assessed from structure."
                lsiRec = { text: "Add H2/H3 subheadings throughout the page. Each should introduce a subtopic with related (LSI) keywords.", priority: "Medium" }
            } else if (exactKeywordPercent > 0.6) {
                lsiStatus = "Fail"
                lsiFinding = `[Over-optimized] Primary keyword appears in ${Math.round(exactKeywordPercent * 100)}% of subheadings. Subheadings should introduce topic depth, not repeat the exact keyword.`
                lsiRec = {
                    text: "Rewrite subheadings to cover related subtopics instead of repeating the primary keyword.",
                    priority: "High",
                }
            } else if (semanticDiversity < 30) {
                lsiStatus = "Warning"
                lsiFinding = `Low semantic keyword variety: only ${semanticDiversity} unique meaningful words detected in the body.`
                lsiRec = {
                    text: 'Enrich your content with semantically related terms, synonyms, and entity names. Use Google "People also ask" and "Related searches" to find LSI terms to weave in.',
                    priority: "Medium",
                }
            } else if (subheadingsWithVariety < Math.max(1, Math.floor(allSubheadings.length * 0.7))) {
                lsiStatus = "Warning"
                lsiFinding = `Only ${subheadingsWithVariety}/${allSubheadings.length} subheadings contain semantic variety.`
                lsiRec = {
                    text: 'Rewrite subheadings to cover related subtopics (e.g. "Benefits of X", "How X Works", "X vs Y Alternatives").',
                    priority: "Medium",
                }
            } else {
                lsiFinding = `Good semantic keyword variety: ${semanticDiversity} unique meaningful terms across ${allSubheadings.length} subheadings.`
            }

            items.push({
                id: "lsi-semantic-variety",
                label: "LSI / Semantic Keyword Variety",
                status: lsiStatus,
                finding: lsiFinding,
                recommendation: lsiRec,
                roiImpact: 72,
                aiVisibilityImpact: 85,
                details: { subheadings: allSubheadings.length, subheadingsWithVariety, semanticDiversity },
            })
        }

        // 8. Keyword in Image Alt Text
        {
            const images = root.querySelectorAll("img")
            const infoImages = Array.from(images).filter((img) => img.getAttribute("alt") !== "")
            const imagesWithKeywordInAlt = infoImages.filter((img) => {
                const alt = img.getAttribute("alt")?.toLowerCase() ?? ""
                return primaryKeyword && alt.includes(primaryKeyword.toLowerCase())
            })

            const hasImages = images.length > 0
            const kwInAlt = imagesWithKeywordInAlt.length > 0

            items.push({
                id: "keyword-in-image-alt",
                label: "Keyword in Image Alt Text",
                status: !hasImages ? "Info" : kwInAlt ? "Pass" : "Warning",
                finding: !hasImages
                    ? "No images found on this page. Consider adding relevant images with keyword-optimised alt text."
                    : kwInAlt
                        ? `${imagesWithKeywordInAlt.length} image(s) contain primary keyword ${pkLabel} in alt text.`
                        : `None of the ${infoImages.length} image(s) mention primary keyword ${pkLabel} in alt text.`,
                recommendation:
                    hasImages && !kwInAlt
                        ? {
                            text: `Add ${pkLabel} naturally to the alt text of your most relevant image. Include the keyword once — do not stuff every image.`,
                            priority: "Low",
                        }
                        : undefined,
                roiImpact: 50,
                aiVisibilityImpact: 45,
                details: {
                    totalImages: images.length,
                    informationalImages: infoImages.length,
                    imagesWithKeywordAlt: imagesWithKeywordInAlt.length,
                },
            })
        }

        // 9. Keyword Cannibalization
        items.push({
            id: "keyword-cannibalization",
            label: "Keyword Cannibalization",
            status: "Info",
            finding: `Keyword cannibalization check (multiple pages targeting "${primaryKeyword || "the same keyword"}") requires a full site crawl. Use Google Search Console's Performance report to identify URLs competing for the same query.`,
            recommendation: {
                text: "In GSC, filter by query → check if multiple URLs rank for the same keyword. If so: (a) merge competing pages with a 301 redirect, (b) add a canonical pointing duplicates to the primary page, or (c) differentiate content to target different search intents.",
                priority: "High",
            },
            roiImpact: 85,
            aiVisibilityImpact: 75,
        })

        // ── DataForSEO Keyword Metrics + Intent Classification ─────────────────
        if (primaryKeyword) {
            const locationCode = resolveLocationCode((context as { targetLocation?: string }).targetLocation)

            const [metricsMap, serpData] = await Promise.all([
                getKeywordMetricsBatch([primaryKeyword], locationCode).catch(() => new Map()),
                getSerpData(primaryKeyword, locationCode, 10).catch(() => null),
            ])

            const metrics = metricsMap.get(primaryKeyword.toLowerCase().trim())

            if (metrics) {
                const msv  = metrics.searchVolume
                const kd   = metrics.difficulty
                const cpc  = metrics.cpc
                const trend = metrics.trend ?? []

                const trendDir = (() => {
                    if (trend.length < 3) return 'stable'
                    const recent = trend.slice(-3).reduce((a: number, b: number) => a + b, 0) / 3
                    const older  = trend.slice(0, 3).reduce((a: number, b: number) => a + b, 0) / 3
                    if (older === 0) return 'stable'
                    const pct = (recent - older) / older
                    return pct > 0.1 ? 'growing' : pct < -0.1 ? 'declining' : 'stable'
                })()

                const kdStatus: AuditStatus = kd < 30 ? 'Pass' : kd < 60 ? 'Warning' : 'Fail'
                const trendEmoji = trendDir === 'growing' ? '📈' : trendDir === 'declining' ? '📉' : '→'

                items.push({
                    id: 'keyword-market-metrics',
                    label: 'Keyword Market Metrics (MSV / KD / CPC)',
                    status: kdStatus,
                    finding: [
                        `Monthly Search Volume: ${msv.toLocaleString()}/mo.`,
                        `Keyword Difficulty: ${kd}/100 (${kd < 30 ? 'Low — good opportunity' : kd < 60 ? 'Medium — competitive' : 'High — very competitive'}).`,
                        `CPC: $${cpc.toFixed(2)} — ${cpc > 5 ? 'High commercial intent' : cpc > 1 ? 'Moderate commercial value' : 'Low commercial value'}.`,
                        trend.length > 0 ? `12-month trend: ${trendEmoji} ${trendDir} (recent avg: ${Math.round(trend.slice(-3).reduce((a: number, b: number) => a + b, 0) / Math.max(trend.slice(-3).length, 1)).toLocaleString()}/mo).` : '',
                    ].filter(Boolean).join(' '),
                    recommendation: kd >= 60 ? {
                        text: [
                            `KD ${kd}/100 means this keyword is highly competitive. Strategies for high-KD keywords:`,
                            '• Target long-tail variations (3–5 words) with KD < 40 to build topical authority first.',
                            `• Build 20+ high-DR backlinks specifically to this page before expecting top-10 rankings.`,
                            `• Target "People Also Ask" and featured snippet opportunities — these are achievable even at KD ${kd}.`,
                            cpc > 3 ? `• High CPC ($${cpc.toFixed(2)}) signals strong commercial intent — consider PPC while building organic authority.` : '',
                        ].filter(Boolean).join('\n'),
                        priority: 'High',
                    } : kd >= 30 ? {
                        text: `KD ${kd}/100 is competitive but achievable. Build 10–15 quality backlinks and ensure on-page optimisation is complete. Estimated time to top 5: 6–12 months at current domain authority.`,
                        priority: 'Medium',
                    } : undefined,
                    roiImpact: 95,
                    aiVisibilityImpact: 75,
                    details: {
                        keyword: primaryKeyword,
                        monthlySearchVolume: msv,
                        keywordDifficulty: kd,
                        cpc,
                        trendDirection: trendDir,
                        locationCode,
                    } as Record<string, string | number | boolean>,
                })
            } else {
                items.push({
                    id: 'keyword-market-metrics',
                    label: 'Keyword Market Metrics (MSV / KD / CPC)',
                    status: 'Info',
                    finding: `Keyword metrics (search volume, difficulty, CPC) are not available — set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your environment to enable live DataForSEO metrics for "${primaryKeyword}".`,
                    recommendation: {
                        text: 'Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to .env. DataForSEO provides MSV, KD, CPC, and 12-month trend data at $0.0006/keyword via their Google Ads Search Volume API.',
                        priority: 'Medium',
                    },
                    roiImpact: 90,
                    aiVisibilityImpact: 70,
                })
            }

            // ── Search Intent Classification ──────────────────────────────────
            const intentModifiers = {
                informational: /\b(what|how|why|guide|tutorial|learn|understand|definition|tips|examples?|overview|introduction|basics?)\b/i,
                navigational:  /\b(login|sign in|download|official|website|app|contact|support|portal)\b/i,
                commercial:    /\b(best|top|review|vs|compare|comparison|alternative|alternatives|rated|recommended|ranking|list)\b/i,
                transactional: /\b(buy|purchase|price|pricing|cost|cheap|discount|deal|coupon|order|shop|subscription|free trial|get started|hire|book|schedule)\b/i,
            }

            const intentScores: Record<string, number> = {
                informational: 0,
                navigational: 0,
                commercial: 0,
                transactional: 0,
            }

            for (const [intent, regex] of Object.entries(intentModifiers)) {
                if (regex.test(primaryKeyword)) intentScores[intent]! += 3
            }

            if (metrics) {
                if (metrics.cpc > 3) { intentScores['transactional']! += 2; intentScores['commercial']! += 1 }
                else if (metrics.cpc > 1) { intentScores['commercial']! += 1 }
                if (metrics.competition > 0.6) { intentScores['transactional']! += 1; intentScores['commercial']! += 1 }
            }

            if (serpData) {
                if (serpData.features.hasAnswerBox)  intentScores['informational']! += 2
                if (serpData.features.hasShopping)   intentScores['transactional']! += 3
                if (serpData.features.hasLocalPack)  intentScores['transactional']! += 1
            }

            const topIntentEntry = Object.entries(intentScores).sort((a, b) => b[1] - a[1])[0]
            const detectedIntent = topIntentEntry?.[0] ?? 'informational'
            const secondEntry    = Object.entries(intentScores).sort((a, b) => b[1] - a[1])[1]
            const isMixed = secondEntry && secondEntry[1] > 0 && topIntentEntry && secondEntry[1] >= topIntentEntry[1] * 0.7
            const intentLabel  = isMixed ? `Mixed (${detectedIntent} + ${secondEntry[0]})` : detectedIntent.charAt(0).toUpperCase() + detectedIntent.slice(1)

            const intentAligned = (() => {
                const bodyLower = cleanBodyText.toLowerCase()
                if (detectedIntent === 'informational' && (bodyLower.includes('what') || bodyLower.includes('how') || bodyLower.includes('why') || rawH1?.toLowerCase().includes('guide'))) return true
                if (detectedIntent === 'transactional' && (bodyLower.includes('buy') || bodyLower.includes('price') || bodyLower.includes('sign up') || rawH1?.toLowerCase().includes('get'))) return true
                if (detectedIntent === 'commercial' && (bodyLower.includes('review') || bodyLower.includes('compare') || bodyLower.includes('best'))) return true
                return null // cannot determine
            })()

            const serpFeatureNote = serpData ? [
                serpData.features.hasAnswerBox ? 'Featured Snippet opportunity detected' : '',
                serpData.features.hasShopping  ? 'Shopping carousel present' : '',
                serpData.features.hasLocalPack  ? 'Local Pack present' : '',
            ].filter(Boolean).join(', ') : ''

            const intentStatus: AuditStatus =
                intentAligned === true  ? 'Pass'
                : intentAligned === null ? 'Info'
                : 'Warning'
            const needsRec = intentAligned !== true

            items.push({
                id: 'keyword-search-intent',
                label: 'Search Intent Classification',
                status: intentStatus,
                finding: [
                    `Detected intent: ${intentLabel}.`,
                    intentAligned === true  ? `Page content appears aligned with ${detectedIntent} intent.` : '',
                    intentAligned === null  ? '' : `Page content may be misaligned with ${detectedIntent} intent — this causes poor engagement signals and high bounce rate.`,
                    serpFeatureNote ? `SERP features: ${serpFeatureNote}.` : '',
                ].filter(Boolean).join(' '),
                recommendation: needsRec ? {
                    text: {
                        informational: `This keyword has informational intent. Ensure the page:\n• Opens with a direct answer to the implied question.\n• Uses H2/H3 headings that mirror "People Also Ask" queries.\n• Includes definitions, how-to steps, or explanatory content.\n• Avoids heavy product promotion in the first fold (signals misaligned intent to Google).`,
                        transactional:  `This keyword has transactional intent. Ensure the page:\n• Has a clear CTA (Buy Now, Get Started, Book) above the fold.\n• Includes pricing, trust signals (reviews, guarantees), and urgency.\n• Is a product/service/landing page, NOT a blog post.\n• Lacks excessive informational content that pushes CTAs below the fold.`,
                        commercial:     `This keyword has commercial investigation intent (comparing options). Ensure the page:\n• Is structured as a comparison, review, or "best X" list.\n• Includes feature tables, pros/cons, and clear recommendations.\n• Contains structured Product or Review schema for Rich Results eligibility.`,
                        navigational:   `This keyword has navigational intent. Users are looking for a specific brand/tool. Ensure:\n• The page is the official brand/product page.\n• Title and H1 clearly state the brand name.\n• No SEO tricks — just ensure the correct page ranks.`,
                    }[detectedIntent as 'informational' | 'transactional' | 'commercial' | 'navigational'] ?? 'Align page content with the detected search intent.',
                    priority: intentAligned === null ? 'Medium' : 'High',
                } : undefined,
                roiImpact: 88,
                aiVisibilityImpact: 85,
                details: {
                    primaryKeyword,
                    detectedIntent: intentLabel,
                    intentScores: JSON.stringify(intentScores),
                    serpHasAnswerBox: serpData?.features.hasAnswerBox ?? false,
                    serpHasShopping:  serpData?.features.hasShopping  ?? false,
                    serpHasLocalPack: serpData?.features.hasLocalPack  ?? false,
                } as Record<string, string | number | boolean>,
            })
        }

        const analyzable = items.filter((i) => i.status !== "Skipped" && i.status !== "Info")
        const passed = analyzable.filter((i) => i.status === "Pass").length
        const failed = analyzable.filter((i) => i.status === "Fail").length
        const warnings = analyzable.filter((i) => i.status === "Warning").length
        const score = analyzable.length > 0
            ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
            : 0

        return {
            id: KeywordsModule.id,
            label: KeywordsModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        }
    },
}