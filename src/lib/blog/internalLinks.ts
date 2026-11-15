import { logger, formatError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { parse } from "node-html-parser";

export interface InternalLinkSuggestion {
    destination: string;
    relationship: "topical" | "entity" | "keyword" | "title";
    anchorConcept: string;
    relevance: number;
    reason: string;
}

const ENTITY_STOPWORDS = new Set([
    "the",
    "this",
    "that",
    "these",
    "those",
    "when",
    "what",
    "how",
    "why",
    "where",
    "which",
    "who",
    "your",
    "you",
    "our",
    "their",
    "with",
    "from",
    "into",
    "than",
    "then",
    "also",
    "about",
    "after",
    "before",
    "between",
    "using",
    "without",
    "within",
]);

const MIN_TERM_LENGTH = 4;
const SEMANTIC_THRESHOLD = 0.6;
const MAX_INJECTED_LINKS = 3;
const MAX_BLOG_CANDIDATES = 200;
const MAX_LINK_SUGGESTIONS = 10;
const MAX_ENTITY_SUGGESTIONS = 5;

type MatchType =
    | "primary_keyword"
    | "stem"
    | "secondary_keyword"
    | "entity"
    | "title"
    | "semantic";

function normalizeDomain(siteDomain?: string | null): string | null {
    if (!siteDomain) return null;

    return (
        siteDomain
            .replace(/^https?:\/\//i, "")
            .replace(/[/?#].*$/, "")
            .replace(/\/+$/, "")
            .trim() || null
    );
}

function buildBlogUrl(
    slug: string,
    siteDomain?: string | null
): string {
    const domain = normalizeDomain(siteDomain);

    return domain
        ? `https://${domain}/blog/${slug}`
        : `/blog/${slug}`;
}

function buildEntityUrl(
    slug: string,
    siteDomain?: string | null
): string {
    const domain = normalizeDomain(siteDomain);

    return domain
        ? `https://${domain}/services/${slug}`
        : `/services/${slug}`;
}

const INVENTORY_ASSET_EXT_RE = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|xml|txt|json|pdf|woff2?|ttf|eot)$/i;
const INVENTORY_SYSTEM_PATH_RE = /^\/(?:api|_next|wp-admin|wp-json|admin|cgi-bin)(?:\/|$)/i;
const UNHEALTHY_AUDIT_ISSUE_RE = /(?:noindex|server_error|client_error|\b404\b|\b410\b|\b500\b|\b502\b|\b503\b|redirect_loop)/i;

interface SiteInventoryCandidate {
    destination: string;
    path: string;
    slug: string;
    title: string;
    targetKeywords: string[];
    fromPageAudit: boolean;
    fromGsc: boolean;
    impressions: number;
    clicks: number;
    overallScore: number | null;
}

function normalizeHostName(value: string): string {
    return value.toLowerCase().replace(/^www\./, "").trim();
}

function resolveSameOriginUrlAndPath(
    rawUrl: string,
    siteDomain?: string | null
): { destination: string; path: string; slug: string } | null {
    if (typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.startsWith("//")) return null;

    const normalizedSiteHost = normalizeDomain(siteDomain);
    const comparableSiteHost = normalizedSiteHost ? normalizeHostName(normalizedSiteHost) : null;

    let pathname: string;
    if (trimmed.startsWith("/")) {
        try {
            const parsed = new URL(trimmed, "https://local.invalid");
            pathname = parsed.pathname;
        } catch {
            return null;
        }
    } else if (/^https?:\/\//i.test(trimmed)) {
        try {
            const parsed = new URL(trimmed);
            const host = normalizeHostName(parsed.hostname);
            if (!comparableSiteHost || host !== comparableSiteHost) {
                return null;
            }
            pathname = parsed.pathname;
        } catch {
            return null;
        }
    } else {
        return null;
    }

    const cleanPath = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname || "/";
    if (INVENTORY_ASSET_EXT_RE.test(cleanPath) || INVENTORY_SYSTEM_PATH_RE.test(cleanPath)) {
        return null;
    }

    const segments = cleanPath.split("/").filter(Boolean);
    const slug = segments[segments.length - 1] || "home";
    const destination = normalizedSiteHost
        ? `https://${normalizedSiteHost}${cleanPath}`
        : cleanPath;

    return { destination, path: cleanPath, slug };
}

function isHealthyPageAuditRow(row: {
    pageUrl: string;
    issueList?: unknown;
}): boolean {
    if (!row?.pageUrl) return false;
    if (Array.isArray(row.issueList)) {
        for (const item of row.issueList) {
            const text = typeof item === "string"
                ? item
                : JSON.stringify(item ?? "");
            if (UNHEALTHY_AUDIT_ISSUE_RE.test(text)) {
                return false;
            }
        }
    } else if (typeof row.issueList === "string" && UNHEALTHY_AUDIT_ISSUE_RE.test(row.issueList)) {
        return false;
    }
    return true;
}

function deriveTitleFromUrlPath(urlPath: string): string {
    const segments = urlPath.split("/").filter(Boolean);
    const meaningful = segments.filter(
        s => !["blog", "articles", "posts", "pages"].includes(s.toLowerCase())
    );
    const chosen = meaningful[meaningful.length - 1] ?? segments[segments.length - 1] ?? "";
    return chosen.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

function deriveKeywordsFromUrlPath(urlPath: string): string[] {
    const segments = urlPath.split("/").filter(Boolean);
    const phrases: string[] = [];
    for (const seg of segments) {
        if (["blog", "articles", "posts", "pages"].includes(seg.toLowerCase())) continue;
        const phrase = seg.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
        if (phrase.length >= MIN_TERM_LENGTH) {
            phrases.push(phrase);
        }
    }
    return uniqueStrings(phrases);
}

async function fetchSiteInventoryCandidates(
    siteId: string,
    siteDomain?: string | null,
    excludeSlugs?: Set<string>
): Promise<SiteInventoryCandidate[]> {
    const byPath = new Map<string, SiteInventoryCandidate>();

    const upsertCandidate = (
        resolved: { destination: string; path: string; slug: string },
        patch: {
            keyword?: string;
            fromPageAudit?: boolean;
            fromGsc?: boolean;
            impressions?: number;
            clicks?: number;
            overallScore?: number | null;
        }
    ) => {
        if (excludeSlugs && resolved.path.startsWith("/blog/") && excludeSlugs.has(resolved.slug)) {
            return;
        }

        const existing = byPath.get(resolved.path);
        const derivedKeywords = deriveKeywordsFromUrlPath(resolved.path);
        if (existing) {
            if (patch.keyword && patch.keyword.trim().length >= MIN_TERM_LENGTH) {
                existing.targetKeywords = uniqueStrings([...existing.targetKeywords, patch.keyword]);
            }
            if (patch.fromPageAudit) existing.fromPageAudit = true;
            if (patch.fromGsc) existing.fromGsc = true;
            if (typeof patch.impressions === "number") existing.impressions += patch.impressions;
            if (typeof patch.clicks === "number") existing.clicks += patch.clicks;
            if (typeof patch.overallScore === "number" && (existing.overallScore === null || patch.overallScore > existing.overallScore)) {
                existing.overallScore = patch.overallScore;
            }
            return;
        }

        const initialKeywords = uniqueStrings([
            ...(patch.keyword ? [patch.keyword] : []),
            ...derivedKeywords,
        ]).filter(k => k.length >= MIN_TERM_LENGTH);

        const title = deriveTitleFromUrlPath(resolved.path) || patch.keyword?.trim() || resolved.slug;
        byPath.set(resolved.path, {
            destination: resolved.destination,
            path: resolved.path,
            slug: resolved.slug,
            title,
            targetKeywords: initialKeywords,
            fromPageAudit: !!patch.fromPageAudit,
            fromGsc: !!patch.fromGsc,
            impressions: patch.impressions ?? 0,
            clicks: patch.clicks ?? 0,
            overallScore: patch.overallScore ?? null,
        });
    };

    try {
        const pageAuditDelegate = (prisma as unknown as {
            pageAudit?: { findMany: (args: Record<string, unknown>) => Promise<Array<{ pageUrl: string; overallScore?: number; issueList?: unknown }>> };
        }).pageAudit;

        if (typeof pageAuditDelegate?.findMany === "function") {
            const pageAudits = await pageAuditDelegate.findMany({
                where: { siteId },
                orderBy: { runTimestamp: "desc" },
                take: 150,
                select: { pageUrl: true, overallScore: true, issueList: true },
            });

            if (Array.isArray(pageAudits)) {
                for (const row of pageAudits) {
                    if (!isHealthyPageAuditRow(row)) continue;
                    const resolved = resolveSameOriginUrlAndPath(row.pageUrl, siteDomain);
                    if (!resolved || resolved.path === "/") continue;
                    upsertCandidate(resolved, {
                        fromPageAudit: true,
                        overallScore: typeof row.overallScore === "number" ? row.overallScore : null,
                    });
                }
            }
        }
    } catch {
        // Non-fatal — fall back gracefully when PageAudit is unavailable or unmocked
    }

    try {
        const gscDelegate = (prisma as unknown as {
            gscDailyPerformance?: { findMany: (args: Record<string, unknown>) => Promise<Array<{ url: string; keyword: string; clicks?: number; impressions?: number }>> };
        }).gscDailyPerformance;

        if (typeof gscDelegate?.findMany === "function") {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const gscRows = await gscDelegate.findMany({
                where: {
                    siteId,
                    fetchedAt: { gte: ninetyDaysAgo },
                },
                orderBy: { impressions: "desc" },
                take: 200,
                select: { url: true, keyword: true, clicks: true, impressions: true },
            });

            if (Array.isArray(gscRows)) {
                for (const row of gscRows) {
                    const resolved = resolveSameOriginUrlAndPath(row.url, siteDomain);
                    if (!resolved) continue;
                    // Only link homepage when it carries an explicit ranking query from GSC
                    if (resolved.path === "/" && (!row.keyword || row.keyword.trim().length < MIN_TERM_LENGTH)) {
                        continue;
                    }
                    upsertCandidate(resolved, {
                        keyword: row.keyword,
                        fromGsc: true,
                        impressions: Number(row.impressions ?? 0),
                        clicks: Number(row.clicks ?? 0),
                    });
                }
            }
        }
    } catch {
        // Non-fatal — fall back gracefully when GSC performance table is unavailable
    }

    return Array.from(byPath.values());
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function stripHtml(value: string): string {
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeText(value: string): string {
    return stripHtml(value)
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[“”„‟]/g, '"')
        .replace(/[‘’‚‛]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function containsTerm(text: string, term: string): boolean {
    const normalizedText = normalizeText(text);
    const normalizedTerm = normalizeText(term);

    if (!normalizedText || !normalizedTerm) return false;

    const escaped = escapeRegExp(normalizedTerm);

    const regex = new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`,
        "iu"
    );

    return regex.test(normalizedText);
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        if (typeof value !== "string") continue;

        const trimmed = value.trim();
        const normalized = trimmed.toLowerCase();

        if (
            !normalized ||
            normalized.length < MIN_TERM_LENGTH ||
            seen.has(normalized)
        ) {
            continue;
        }

        seen.add(normalized);
        result.push(trimmed);
    }

    return result;
}

function extractEntities(text: string): Set<string> {
    const plain = stripHtml(text);

    const matches =
        plain.match(
            /\b[A-Z][A-Za-z0-9&'’–-]*(?:\s+[A-Z][A-Za-z0-9&'’–-]*){0,3}\b/g
        ) || [];

    const entities = new Set<string>();

    for (const match of matches) {
        const cleaned = match
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");

        if (!cleaned) continue;

        const words = cleaned.split(/\s+/);

        if (words.length === 1) {
            const normalized = words[0].toLowerCase();

            if (
                normalized.length < 3 ||
                ENTITY_STOPWORDS.has(normalized)
            ) {
                continue;
            }

            entities.add(normalized);
            continue;
        }

        const firstWord = words[0].toLowerCase();

        if (ENTITY_STOPWORDS.has(firstWord)) continue;

        const normalized = words
            .map(word => word.toLowerCase())
            .join(" ")
            .trim();

        if (normalized.length >= MIN_TERM_LENGTH) {
            entities.add(normalized);
        }
    }

    return entities;
}

function computeEntityOverlap(
    setA: Set<string>,
    setB: Set<string>
): { score: number; shared: string[] } {
    if (setA.size === 0 || setB.size === 0) {
        return { score: 0, shared: [] };
    }

    const shared = [...setA].filter(term => setB.has(term));
    const union = new Set([...setA, ...setB]).size;

    return {
        score: union > 0 ? shared.length / union : 0,
        shared,
    };
}

function scoreLinkRelevance(
    matchType: MatchType,
    keywordOverlapCount: number
): number {
    const baseScores: Record<MatchType, number> = {
        primary_keyword: 90,
        stem: 72,
        secondary_keyword: 62,
        entity: 56,
        title: 40,
        semantic: 52,
    };

    const base = baseScores[matchType] ?? 30;
    const overlapBoost = Math.min(keywordOverlapCount, 4) * 5;

    return Math.min(100, base + overlapBoost);
}

function classifyRelationship(
    matchType: MatchType,
    entityOverlapScore: number
): InternalLinkSuggestion["relationship"] {
    if (entityOverlapScore >= 0.3) {
        return "entity";
    }

    if (
        matchType === "primary_keyword" ||
        matchType === "stem"
    ) {
        return "keyword";
    }

    if (
        matchType === "secondary_keyword" ||
        matchType === "semantic"
    ) {
        return "topical";
    }

    if (entityOverlapScore > 0) {
        return "entity";
    }

    if (matchType === "title") {
        return "title";
    }

    return "topical";
}

function replaceFirstVisibleTextMatch(
    html: string,
    candidate: string,
    href: string
): { html: string; matched: boolean } {
    const normalizedCandidate = candidate.trim();

    if (normalizedCandidate.length < MIN_TERM_LENGTH) {
        return { html, matched: false };
    }

    const escapedCandidate = escapeRegExp(normalizedCandidate);

    const regex = new RegExp(
        `(^|>)([^<]*?)(?<![\\p{L}\\p{N}_])(${escapedCandidate})(?![\\p{L}\\p{N}_])`,
        "iu"
    );

    const match = html.match(regex);

    if (!match || match.index === undefined) {
        return { html, matched: false };
    }

    const prefix = match[1] || "";
    const textBefore = match[2] || "";
    const matchedText = match[3] || "";

    const link = `<a href="${escapeHtml(
        href
    )}" class="text-primary hover:underline font-medium" title="${escapeHtml(
        matchedText
    )}">${escapeHtml(matchedText)}</a>`;

    const replacement = `${prefix}${textBefore}${link}`;

    const newHtml =
        html.slice(0, match.index) +
        replacement +
        html.slice(match.index + match[0].length);

    return {
        html: newHtml,
        matched: true,
    };
}

function getKeywordCandidates(
    targetKeywords: string[],
    title: string
): { text: string; matchType: MatchType }[] {
    const keywords = uniqueStrings(targetKeywords || []);
    const [primaryKw, ...secondaryKws] = keywords;

    const stem = primaryKw
        ? primaryKw
            .split(/\s+/)
            .map(value => value.trim())
            .filter(Boolean)[0] || null
        : null;

    const candidates: { text: string; matchType: MatchType }[] = [];

    if (primaryKw) {
        candidates.push({
            text: primaryKw,
            matchType: "primary_keyword",
        });
    }

    if (
        stem &&
        stem.length >= MIN_TERM_LENGTH &&
        stem.toLowerCase() !== primaryKw?.toLowerCase()
    ) {
        candidates.push({
            text: stem,
            matchType: "stem",
        });
    }

    for (const keyword of secondaryKws) {
        candidates.push({
            text: keyword,
            matchType: "secondary_keyword",
        });
    }

    const normalizedTitle = title.trim();

    if (normalizedTitle.length >= MIN_TERM_LENGTH) {
        candidates.push({
            text: normalizedTitle,
            matchType: "title",
        });
    }

    const seen = new Set<string>();

    return candidates.filter(candidate => {
        const key = candidate.text.trim().toLowerCase();

        if (!key || seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function hasExistingHref(
    root: ReturnType<typeof parse>,
    href: string
): boolean {
    const normalizedTarget = normalizeText(href);

    if (!normalizedTarget) return false;

    return root
        .querySelectorAll("a")
        .some(anchor =>
            normalizeText(anchor.getAttribute("href") || "") ===
            normalizedTarget
        );
}

export async function injectInternalLinks(
    htmlContent: string,
    siteId: string,
    currentSlug: string,
    siteDomain?: string | null
): Promise<string> {
    try {
        const otherBlogs = await prisma.blog.findMany({
            where: {
                siteId,
                status: "PUBLISHED",
                slug: {
                    not: currentSlug,
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            take: MAX_BLOG_CANDIDATES,
            select: {
                slug: true,
                title: true,
                targetKeywords: true,
            },
        });

        if (otherBlogs.length === 0) {
            return htmlContent;
        }

        const root = parse(htmlContent);
        const passages = root.querySelectorAll(
            "p, li, blockquote"
        );

        let linksAdded = 0;

        for (const blog of otherBlogs) {
            if (linksAdded >= MAX_INJECTED_LINKS) {
                break;
            }

            const href = buildBlogUrl(
                blog.slug,
                siteDomain
            );

            if (hasExistingHref(root, href)) {
                continue;
            }

            const candidates = getKeywordCandidates(
                blog.targetKeywords || [],
                blog.title
            );

            for (const candidate of candidates) {
                if (linksAdded >= MAX_INJECTED_LINKS) {
                    break;
                }

                let linked = false;

                for (const passage of passages) {
                    if (passage.querySelector("a")) {
                        continue;
                    }

                    const result = replaceFirstVisibleTextMatch(
                        passage.innerHTML,
                        candidate.text,
                        href
                    );

                    if (!result.matched) {
                        continue;
                    }

                    passage.set_content(result.html);
                    linksAdded++;
                    linked = true;
                    break;
                }

                if (linked) {
                    break;
                }
            }
        }

        return root.toString();
    } catch (error: unknown) {
        logger.error(
            "[Internal Links] DOM-aware injection failed:",
            { error: formatError(error) }
        );

        return htmlContent;
    }
}

export function injectSpecificInternalLink(
    htmlContent: string,
    target: {
        slug: string;
        url?: string;
        title: string;
        targetKeywords: string[];
    },
    siteDomain?: string | null
): { html: string; linked: boolean } {
    try {
        const root = parse(htmlContent);
        const passages = root.querySelectorAll(
            "p, li, blockquote"
        );

        const href = target.url?.trim() || buildBlogUrl(
            target.slug,
            siteDomain
        );

        if (hasExistingHref(root, href)) {
            return {
                html: htmlContent,
                linked: false,
            };
        }

        const candidates = getKeywordCandidates(
            target.targetKeywords || [],
            target.title
        );

        for (const candidate of candidates) {
            for (const passage of passages) {
                if (passage.querySelector("a")) {
                    continue;
                }

                const result = replaceFirstVisibleTextMatch(
                    passage.innerHTML,
                    candidate.text,
                    href
                );

                if (!result.matched) {
                    continue;
                }

                passage.set_content(result.html);

                return {
                    html: root.toString(),
                    linked: true,
                };
            }
        }

        return {
            html: htmlContent,
            linked: false,
        };
    } catch (error: unknown) {
        logger.error(
            "[Internal Links] injectSpecificInternalLink failed:",
            { error: formatError(error) }
        );

        return {
            html: htmlContent,
            linked: false,
        };
    }
}

export async function suggestInternalLinks(
    currentBlogContent: string,
    currentBlogKeywords: string[],
    siteId: string,
    currentSlug: string,
    siteDomain?: string | null,
    vectorScores?: Map<string, number>
): Promise<InternalLinkSuggestion[]> {
    try {
        const otherBlogs = await prisma.blog.findMany({
            where: {
                siteId,
                status: "PUBLISHED",
                slug: {
                    not: currentSlug,
                },
            },
            orderBy: {
                createdAt: "desc",
            },
            take: MAX_BLOG_CANDIDATES,
            select: {
                id: true,
                slug: true,
                title: true,
                targetKeywords: true,
            },
        });

        if (otherBlogs.length === 0) {
            return [];
        }

        const contentText = stripHtml(currentBlogContent);
        const normalizedContent = normalizeText(currentBlogContent);
        const currentEntities = extractEntities(
            currentBlogContent
        );

        const normalizedCurrentKeywords = uniqueStrings(
            currentBlogKeywords || []
        );

        const suggestions: (
            InternalLinkSuggestion & {
                _score: number;
            }
        )[] = [];

        const seenDestinations = new Set<string>();

        for (const blog of otherBlogs) {
            const destination = buildBlogUrl(
                blog.slug,
                siteDomain
            );

            if (seenDestinations.has(destination)) {
                continue;
            }

            const targetKeywords = uniqueStrings(
                (blog.targetKeywords || []).filter(
                    keyword =>
                        typeof keyword === "string" &&
                        keyword.trim().length >= MIN_TERM_LENGTH
                )
            );

            const [primaryKw, ...secondaryKws] =
                targetKeywords;

            const keywordOverlap = targetKeywords.filter(
                keyword =>
                    containsTerm(contentText, keyword) ||
                    normalizedCurrentKeywords.some(
                        currentKeyword =>
                            containsTerm(
                                currentKeyword,
                                keyword
                            )
                    )
            );

            const candidateEntities = extractEntities(
                `${blog.title} ${targetKeywords.join(" ")}`
            );

            const entityOverlap = computeEntityOverlap(
                currentEntities,
                candidateEntities
            );

            const titleMentioned = containsTerm(
                contentText,
                blog.title
            );

            const hasVectorScore =
                vectorScores?.has(blog.id) ?? false;

            const rawVectorScore = hasVectorScore
                ? Number(vectorScores?.get(blog.id) ?? 0)
                : 0;

            const vectorScore = Number.isFinite(
                rawVectorScore
            )
                ? Math.max(
                    0,
                    Math.min(1, rawVectorScore)
                )
                : 0;

            const hasSemanticMatch =
                hasVectorScore &&
                vectorScore >= SEMANTIC_THRESHOLD;

            if (
                keywordOverlap.length === 0 &&
                entityOverlap.shared.length === 0 &&
                !titleMentioned &&
                !hasSemanticMatch
            ) {
                continue;
            }

            let matchType: MatchType = "title";
            let anchor = blog.title;

            if (
                primaryKw &&
                containsTerm(contentText, primaryKw)
            ) {
                matchType = "primary_keyword";
                anchor = primaryKw;
            } else {
                const matchedSecondary =
                    secondaryKws.find(keyword =>
                        containsTerm(
                            contentText,
                            keyword
                        )
                    );

                if (matchedSecondary) {
                    matchType = "secondary_keyword";
                    anchor = matchedSecondary;
                } else if (
                    entityOverlap.shared.length > 0
                ) {
                    matchType = "entity";
                    anchor = entityOverlap.shared[0];
                } else if (titleMentioned) {
                    matchType = "title";
                    anchor = blog.title;
                } else if (hasSemanticMatch) {
                    matchType = "semantic";
                    anchor = blog.title;
                }
            }

            const keywordScore =
                scoreLinkRelevance(
                    matchType,
                    keywordOverlap.length
                );

            let relevance: number;

            if (hasVectorScore) {
                relevance = Math.round(
                    keywordScore * 0.5 +
                    entityOverlap.score * 100 * 0.25 +
                    vectorScore * 100 * 0.25
                );
            } else {
                relevance = Math.round(
                    keywordScore * 0.65 +
                    entityOverlap.score * 100 * 0.35
                );
            }

            if (
                normalizedContent &&
                containsTerm(
                    normalizedContent,
                    anchor
                )
            ) {
                relevance += 2;
            }

            relevance = Math.max(
                0,
                Math.min(100, relevance)
            );

            const relationship =
                classifyRelationship(
                    matchType,
                    entityOverlap.score
                );

            const reasonParts: string[] = [];

            if (keywordOverlap.length > 0) {
                reasonParts.push(
                    `keyword overlap: ${keywordOverlap
                        .slice(0, 3)
                        .join(", ")}`
                );
            }

            if (entityOverlap.shared.length > 0) {
                reasonParts.push(
                    `shared entities: ${entityOverlap.shared
                        .slice(0, 3)
                        .join(", ")}`
                );
            }

            if (titleMentioned) {
                reasonParts.push(
                    `title "${blog.title}" appears in content`
                );
            }

            if (hasVectorScore) {
                reasonParts.push(
                    `semantic similarity ${vectorScore.toFixed(
                        2
                    )}`
                );
            }

            const reason =
                reasonParts.length > 0
                    ? reasonParts.join("; ")
                    : `Related to "${blog.title}"`;

            suggestions.push({
                destination,
                relationship,
                anchorConcept: anchor,
                relevance,
                reason,
                _score: relevance,
            });

            seenDestinations.add(destination);
        }

        return suggestions
            .sort(
                (a, b) =>
                    b._score - a._score ||
                    b.relevance - a.relevance
            )
            .slice(0, MAX_LINK_SUGGESTIONS)
            .map(
                ({ _score, ...suggestion }) =>
                    suggestion
            );
    } catch (error: unknown) {
        logger.error(
            "[Internal Links] suggestInternalLinks failed:",
            { error: formatError(error) }
        );

        return [];
    }
}

export async function suggestEntityLinks(
    currentBlogContent: string,
    currentBlogKeywords: string[],
    siteId: string,
    siteDomain?: string | null
): Promise<InternalLinkSuggestion[]> {
    try {
        const entityPages = await prisma.blog.findMany({
            where: {
                siteId,
                pipelineType: "ENTITY_PAGE",
                status: "PUBLISHED",
            },
            select: {
                title: true,
                slug: true,
                targetKeywords: true,
            },
        });

        if (entityPages.length === 0) {
            return [];
        }

        const contentText = stripHtml(
            currentBlogContent
        );

        const currentEntities = extractEntities(
            currentBlogContent
        );

        const normalizedCurrentKeywords =
            uniqueStrings(
                currentBlogKeywords || []
            );

        const suggestions: (
            InternalLinkSuggestion & {
                _score: number;
            }
        )[] = [];

        const seenDestinations = new Set<string>();

        for (const entityPage of entityPages) {
            const destination = buildEntityUrl(
                entityPage.slug,
                siteDomain
            );

            if (seenDestinations.has(destination)) {
                continue;
            }

            const targetKeywords = uniqueStrings(
                (entityPage.targetKeywords || []).filter(
                    keyword =>
                        typeof keyword === "string" &&
                        keyword.trim().length >= MIN_TERM_LENGTH
                )
            );

            const keywordOverlap = targetKeywords.filter(
                keyword =>
                    containsTerm(contentText, keyword) ||
                    normalizedCurrentKeywords.some(
                        currentKeyword =>
                            containsTerm(
                                currentKeyword,
                                keyword
                            )
                    )
            );

            const targetEntities = extractEntities(
                `${entityPage.title} ${targetKeywords.join(
                    " "
                )}`
            );

            const entityOverlap =
                computeEntityOverlap(
                    currentEntities,
                    targetEntities
                );

            const titleMentioned = containsTerm(
                contentText,
                entityPage.title
            );

            if (
                keywordOverlap.length === 0 &&
                entityOverlap.shared.length === 0 &&
                !titleMentioned
            ) {
                continue;
            }

            const anchorConcept =
                keywordOverlap[0] ||
                entityOverlap.shared[0] ||
                entityPage.title
                    .replace(/\|.*$/, "")
                    .trim();

            const keywordComponent = Math.min(
                35,
                keywordOverlap.length * 12
            );

            const entityComponent = Math.min(
                45,
                entityOverlap.score * 100 * 0.55
            );

            const titleComponent = titleMentioned
                ? 20
                : 0;

            const relevance = Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        keywordComponent +
                        entityComponent +
                        titleComponent
                    )
                )
            );

            const reasonParts: string[] = [];

            if (keywordOverlap.length > 0) {
                reasonParts.push(
                    `keyword overlap: ${keywordOverlap
                        .slice(0, 3)
                        .join(", ")}`
                );
            }

            if (entityOverlap.shared.length > 0) {
                reasonParts.push(
                    `shared entities: ${entityOverlap.shared
                        .slice(0, 3)
                        .join(", ")}`
                );
            }

            if (titleMentioned) {
                reasonParts.push(
                    `title "${entityPage.title}" appears in content`
                );
            }

            suggestions.push({
                destination,
                relationship: "entity",
                anchorConcept,
                relevance,
                reason:
                    reasonParts.join("; ") ||
                    `Related to entity page "${entityPage.title}"`,
                _score: relevance,
            });

            seenDestinations.add(destination);
        }

        return suggestions
            .sort(
                (a, b) =>
                    b._score - a._score ||
                    b.relevance - a.relevance
            )
            .slice(0, MAX_ENTITY_SUGGESTIONS)
            .map(
                ({ _score, ...suggestion }) =>
                    suggestion
            );
    } catch (error: unknown) {
        logger.error(
            "[Entity Links] suggestEntityLinks failed:",
            { error: formatError(error) }
        );

        return [];
    }
}

export interface TopicLinkContext {
    secondaryKeywords?: string[];
    entities?: string[];
    title?: string;
    excludeSlugs?: string[];
}

interface TopicScoringCandidate {
    id: string;
    slug: string;
    title: string;
    targetKeywords: string[];
    destination: string;
    normalizedPath: string;
    sourceLabel?: string;
    scoreBoost?: number;
}

function scoreTopicLinkCandidate(
    candidate: TopicScoringCandidate,
    ctx: {
        normPrimaryKw: string;
        topicTitle: string;
        topicKeywordsList: string[];
        topicSecondaryKws: string[];
        topicEntities: Set<string>;
        vectorScores?: Map<string, number>;
    }
): (InternalLinkSuggestion & { _score: number }) | null {
    const {
        normPrimaryKw,
        topicTitle,
        topicKeywordsList,
        topicSecondaryKws,
        topicEntities,
        vectorScores,
    } = ctx;

    const candidateTargetKeywords = uniqueStrings(
        (candidate.targetKeywords || []).filter(
            k => typeof k === "string" && k.trim().length >= MIN_TERM_LENGTH
        )
    );

    const [candPrimaryKw] = candidateTargetKeywords;

    const topicKeywordMatches = topicKeywordsList.filter(
        tk =>
            containsTerm(candidate.title, tk) ||
            candidateTargetKeywords.some(ck => containsTerm(ck, tk) || containsTerm(tk, ck))
    );

    const candidateKeywordMatches = candidateTargetKeywords.filter(
        ck =>
            (normPrimaryKw && containsTerm(ck, normPrimaryKw)) ||
            (topicTitle && containsTerm(topicTitle, ck)) ||
            topicSecondaryKws.some(sk => containsTerm(ck, sk) || containsTerm(sk, ck))
    );

    const allKeywordOverlap = uniqueStrings([
        ...topicKeywordMatches,
        ...candidateKeywordMatches,
    ]);

    const candidateEntities = extractEntities(
        `${candidate.title} ${candidateTargetKeywords.join(" ")}`
    );

    const entityOverlap = computeEntityOverlap(topicEntities, candidateEntities);

    const titleMatch =
        (normPrimaryKw && containsTerm(candidate.title, normPrimaryKw)) ||
        (topicTitle && containsTerm(topicTitle, candidate.title)) ||
        (topicTitle && containsTerm(candidate.title, topicTitle));

    const hasVectorScore = vectorScores?.has(candidate.id) ?? false;
    const rawVectorScore = hasVectorScore
        ? Number(vectorScores?.get(candidate.id) ?? 0)
        : 0;
    const vectorScore = Number.isFinite(rawVectorScore)
        ? Math.max(0, Math.min(1, rawVectorScore))
        : 0;

    const hasSemanticMatch = hasVectorScore && vectorScore >= SEMANTIC_THRESHOLD;

    if (
        allKeywordOverlap.length === 0 &&
        entityOverlap.shared.length === 0 &&
        !titleMatch &&
        !hasSemanticMatch
    ) {
        return null;
    }

    let matchType: MatchType = "title";
    let anchorConcept = candidate.title;

    if (candPrimaryKw && (topicKeywordMatches.includes(candPrimaryKw) || (normPrimaryKw && containsTerm(candPrimaryKw, normPrimaryKw)))) {
        matchType = "primary_keyword";
        anchorConcept = candPrimaryKw;
    } else if (normPrimaryKw && containsTerm(candidate.title, normPrimaryKw)) {
        matchType = "primary_keyword";
        anchorConcept = normPrimaryKw;
    } else if (allKeywordOverlap.length > 0) {
        matchType = "secondary_keyword";
        anchorConcept = allKeywordOverlap[0];
    } else if (entityOverlap.shared.length > 0) {
        matchType = "entity";
        anchorConcept = entityOverlap.shared[0];
    } else if (titleMatch) {
        matchType = "title";
        anchorConcept = candidate.title;
    } else if (hasSemanticMatch) {
        matchType = "semantic";
        anchorConcept = candidate.title;
    }

    const keywordScore = scoreLinkRelevance(matchType, allKeywordOverlap.length);

    let relevance: number;
    if (hasVectorScore) {
        relevance = Math.round(
            keywordScore * 0.5 +
            entityOverlap.score * 100 * 0.25 +
            vectorScore * 100 * 0.25
        );
    } else {
        relevance = Math.round(
            keywordScore * 0.65 +
            entityOverlap.score * 100 * 0.35
        );
    }

    if (titleMatch) {
        relevance += 2;
    }
    if (candidate.scoreBoost) {
        relevance += candidate.scoreBoost;
    }

    relevance = Math.max(0, Math.min(100, relevance));

    const relationship = classifyRelationship(matchType, entityOverlap.score);

    const reasonParts: string[] = [];
    if (allKeywordOverlap.length > 0) {
        reasonParts.push(`topic keyword match: ${allKeywordOverlap.slice(0, 3).join(", ")}`);
    }
    if (entityOverlap.shared.length > 0) {
        reasonParts.push(`shared entities: ${entityOverlap.shared.slice(0, 3).join(", ")}`);
    }
    if (titleMatch) {
        reasonParts.push(`title match with "${candidate.title}"`);
    }
    if (hasVectorScore) {
        reasonParts.push(`semantic similarity ${vectorScore.toFixed(2)}`);
    }
    if (candidate.sourceLabel) {
        reasonParts.push(candidate.sourceLabel);
    }

    const reason = reasonParts.length > 0
        ? reasonParts.join("; ")
        : `Topic match with "${candidate.title}"`;

    return {
        destination: candidate.destination,
        relationship,
        anchorConcept,
        relevance,
        reason,
        _score: relevance,
    };
}

export async function findInternalLinkOpportunitiesForTopic(
    primaryKeyword: string,
    siteId: string,
    siteDomain?: string | null,
    topicContext?: TopicLinkContext,
    vectorScores?: Map<string, number>
): Promise<InternalLinkSuggestion[]> {
    try {
        const excludeSlugs = new Set(topicContext?.excludeSlugs || []);

        const searchTerms = uniqueStrings([
            primaryKeyword,
            ...(topicContext?.secondaryKeywords || []),
            topicContext?.title || "",
        ]).filter(t => t.length >= MIN_TERM_LENGTH);

        type BlogCandidateRow = {
            id: string;
            slug: string;
            title: string;
            targetKeywords: string[];
            pipelineType?: string | null;
        };

        let relevantPool: BlogCandidateRow[] = [];
        if (searchTerms.length > 0) {
            try {
                const boundedTerms = searchTerms.slice(0, 5);

                // Prisma's `hasSome` on String[] is an exact, case-sensitive match
                // (same representation used by page-existence-resolver). Include the
                // original and lower-cased forms so keyword casing differences don't
                // cause misses. Bounded: at most 5 terms x 2 variants.
                const keywordVariants = Array.from(
                    new Set(
                        boundedTerms.flatMap(term => [
                            term.trim(),
                            term.trim().toLowerCase(),
                        ])
                    )
                ).filter(Boolean);

                relevantPool = await prisma.blog.findMany({
                    where: {
                        siteId,
                        status: "PUBLISHED",
                        OR: [
                            ...boundedTerms.map(term => ({
                                title: { contains: term, mode: "insensitive" as const },
                            })),
                            { targetKeywords: { hasSome: keywordVariants } },
                        ],
                    },
                    orderBy: {
                        createdAt: "desc",
                    },
                    take: 100,
                    select: {
                        id: true,
                        slug: true,
                        title: true,
                        targetKeywords: true,
                        pipelineType: true,
                    },
                });
            } catch {
                relevantPool = [];
            }
        }

        const recencyPool: BlogCandidateRow[] = await prisma.blog.findMany({
            where: {
                siteId,
                status: "PUBLISHED",
            },
            orderBy: {
                createdAt: "desc",
            },
            take: 100,
            select: {
                id: true,
                slug: true,
                title: true,
                targetKeywords: true,
                pipelineType: true,
            },
        });

        const candidateMap = new Map<string, BlogCandidateRow>();
        for (const blog of relevantPool) {
            candidateMap.set(blog.id, blog);
        }
        for (const blog of recencyPool) {
            candidateMap.set(blog.id, blog);
        }

        const otherBlogs = Array.from(candidateMap.values());
        const inventoryCandidates = await fetchSiteInventoryCandidates(siteId, siteDomain, excludeSlugs);

        if (otherBlogs.length === 0 && inventoryCandidates.length === 0) {
            return [];
        }

        const normPrimaryKw = primaryKeyword ? normalizeText(primaryKeyword) : "";
        const topicSecondaryKws = uniqueStrings(
            (topicContext?.secondaryKeywords || []).filter(
                k => typeof k === "string" && k.trim().length >= MIN_TERM_LENGTH
            )
        );
        const topicTitle = topicContext?.title ? normalizeText(topicContext.title) : "";
        const topicEntitiesFromContext = uniqueStrings(topicContext?.entities || []);

        const topicEntities = extractEntities(
            `${primaryKeyword} ${topicSecondaryKws.join(" ")} ${topicContext?.title || ""}`
        );
        for (const e of topicEntitiesFromContext) {
            topicEntities.add(e.toLowerCase());
        }

        const topicKeywordsList = uniqueStrings([
            primaryKeyword,
            ...topicSecondaryKws,
        ]);

        const scoringContext = {
            normPrimaryKw,
            topicTitle,
            topicKeywordsList,
            topicSecondaryKws,
            topicEntities,
            vectorScores,
        };

        const suggestions: (InternalLinkSuggestion & { _score: number })[] = [];
        const seenDestinations = new Set<string>();
        const seenPaths = new Set<string>();

        for (const blog of otherBlogs) {
            if (excludeSlugs.has(blog.slug)) {
                continue;
            }

            const isEntityPage = blog.pipelineType === "ENTITY_PAGE";
            const destination = isEntityPage
                ? buildEntityUrl(blog.slug, siteDomain)
                : buildBlogUrl(blog.slug, siteDomain);
            const normalizedPath = isEntityPage ? `/services/${blog.slug}` : `/blog/${blog.slug}`;

            if (seenDestinations.has(destination) || seenPaths.has(normalizedPath)) {
                continue;
            }

            const scored = scoreTopicLinkCandidate(
                {
                    id: blog.id,
                    slug: blog.slug,
                    title: blog.title,
                    targetKeywords: blog.targetKeywords || [],
                    destination,
                    normalizedPath,
                    sourceLabel: isEntityPage ? "published entity page" : undefined,
                },
                scoringContext
            );

            if (scored) {
                suggestions.push(scored);
                seenDestinations.add(destination);
                seenPaths.add(normalizedPath);
            }
        }

        for (const inv of inventoryCandidates) {
            if (seenDestinations.has(inv.destination) || seenPaths.has(inv.path)) {
                continue;
            }

            const labels: string[] = [];
            if (inv.fromPageAudit) labels.push("verified crawled site page (PageAudit)");
            if (inv.fromGsc) {
                labels.push(
                    inv.impressions > 0
                        ? `top GSC page (${inv.impressions} impressions)`
                        : "GSC performance page"
                );
            }

            const scoreBoost = (inv.fromPageAudit && inv.fromGsc)
                ? 4
                : inv.fromGsc && inv.impressions >= 100
                    ? 2
                    : 0;

            const scored = scoreTopicLinkCandidate(
                {
                    id: `inventory:${inv.path}`,
                    slug: inv.slug,
                    title: inv.title,
                    targetKeywords: inv.targetKeywords,
                    destination: inv.destination,
                    normalizedPath: inv.path,
                    sourceLabel: labels.join(" + "),
                    scoreBoost,
                },
                scoringContext
            );

            if (scored) {
                suggestions.push(scored);
                seenDestinations.add(inv.destination);
                seenPaths.add(inv.path);
            }
        }

        return suggestions
            .sort(
                (a, b) =>
                    b._score - a._score ||
                    b.relevance - a.relevance ||
                    a.destination.localeCompare(b.destination)
            )
            .slice(0, MAX_LINK_SUGGESTIONS)
            .map(({ _score, ...suggestion }) => suggestion);
    } catch (error: unknown) {
        logger.error(
            "[Internal Links] findInternalLinkOpportunitiesForTopic failed:",
            { error: formatError(error) }
        );

        return [];
    }
}

export async function resolveCanonicalInternalLinks(
    siteId: string,
    opportunities: InternalLinkSuggestion[],
    currentSlug?: string,
    siteDomain?: string | null
): Promise<Array<{ slug: string; url?: string; title: string; targetKeywords: string[] }>> {
    if (!siteId || !Array.isArray(opportunities) || opportunities.length === 0) {
        return [];
    }

    const normCurrentSlug = currentSlug ? currentSlug.toLowerCase().trim() : "";

    type CandidateTarget = {
        opp: InternalLinkSuggestion;
        resolved: { destination: string; path: string; slug: string };
        blogSlug: string | null;
    };

    const candidates: CandidateTarget[] = [];
    const seenPaths = new Set<string>();
    const orderedBlogSlugs: string[] = [];

    for (const opp of opportunities) {
        if (typeof opp?.destination !== "string" || !opp.destination.trim()) {
            continue;
        }

        const resolvedUrl = resolveSameOriginUrlAndPath(opp.destination.trim(), siteDomain);
        if (!resolvedUrl) {
            continue;
        }

        const normPath = resolvedUrl.path.toLowerCase();
        const blogOrServiceMatch = resolvedUrl.path.match(/^\/(?:blog|services)\/([^/?#]+)$/i);
        const blogSlug = blogOrServiceMatch ? blogOrServiceMatch[1].toLowerCase().trim() : null;

        if (normCurrentSlug && blogSlug === normCurrentSlug) {
            continue;
        }

        if (seenPaths.has(normPath)) {
            continue;
        }
        seenPaths.add(normPath);

        candidates.push({ opp, resolved: resolvedUrl, blogSlug });
        if (blogSlug && !orderedBlogSlugs.includes(blogSlug)) {
            orderedBlogSlugs.push(blogSlug);
        }
    }

    if (candidates.length === 0) {
        return [];
    }

    try {
        const blogMap = new Map<string, { slug: string; title: string; targetKeywords: string[]; pipelineType?: string | null }>();

        if (orderedBlogSlugs.length > 0) {
            const matchedBlogs = await prisma.blog.findMany({
                where: {
                    siteId,
                    status: "PUBLISHED",
                    slug: {
                        in: orderedBlogSlugs,
                    },
                },
                select: {
                    slug: true,
                    title: true,
                    targetKeywords: true,
                    pipelineType: true,
                },
            });

            for (const b of matchedBlogs) {
                blogMap.set(b.slug.toLowerCase().trim(), b);
            }
        }

        const needsInventoryLookup = candidates.some(
            c => !c.blogSlug || !blogMap.has(c.blogSlug)
        );

        const inventoryByPath = new Map<string, SiteInventoryCandidate>();
        if (needsInventoryLookup) {
            const inventory = await fetchSiteInventoryCandidates(siteId, siteDomain);
            for (const item of inventory) {
                inventoryByPath.set(item.path.toLowerCase(), item);
            }
        }

        const resolved: Array<{ slug: string; url?: string; title: string; targetKeywords: string[] }> = [];

        for (const item of candidates) {
            const blog = item.blogSlug ? blogMap.get(item.blogSlug) : undefined;
            if (blog) {
                const isEntityPage = blog.pipelineType === "ENTITY_PAGE";
                resolved.push({
                    slug: blog.slug,
                    ...(isEntityPage ? { url: buildEntityUrl(blog.slug, siteDomain) } : {}),
                    title: blog.title,
                    targetKeywords: blog.targetKeywords || [],
                });
                continue;
            }

            const inv = inventoryByPath.get(item.resolved.path.toLowerCase());
            if (inv) {
                resolved.push({
                    slug: inv.slug,
                    url: inv.destination,
                    title: inv.title,
                    targetKeywords: uniqueStrings([
                        ...(item.opp.anchorConcept ? [item.opp.anchorConcept] : []),
                        ...inv.targetKeywords,
                    ]),
                });
            }
        }

        return resolved;
    } catch (error: unknown) {
        logger.error(
            "[Internal Links] resolveCanonicalInternalLinks failed:",
            { error: formatError(error) }
        );
        return [];
    }
}