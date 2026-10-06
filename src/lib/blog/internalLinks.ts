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

        const href = buildBlogUrl(
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

        let relevantPool: Array<{ id: string; slug: string; title: string; targetKeywords: string[] }> = [];
        if (searchTerms.length > 0) {
            try {
                relevantPool = await prisma.blog.findMany({
                    where: {
                        siteId,
                        status: "PUBLISHED",
                        OR: searchTerms.slice(0, 5).map(term => ({
                            title: { contains: term, mode: "insensitive" as const },
                        })),
                    },
                    take: 100,
                    select: {
                        id: true,
                        slug: true,
                        title: true,
                        targetKeywords: true,
                    },
                });
            } catch {
                relevantPool = [];
            }
        }

        const recencyPool = await prisma.blog.findMany({
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
            },
        });

        const candidateMap = new Map<string, typeof recencyPool[0]>();
        for (const blog of relevantPool) {
            candidateMap.set(blog.id, blog);
        }
        for (const blog of recencyPool) {
            candidateMap.set(blog.id, blog);
        }

        const otherBlogs = Array.from(candidateMap.values());

        if (otherBlogs.length === 0) {
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

        const suggestions: (InternalLinkSuggestion & { _score: number })[] = [];
        const seenDestinations = new Set<string>();

        for (const blog of otherBlogs) {
            if (excludeSlugs.has(blog.slug)) {
                continue;
            }

            const destination = buildBlogUrl(blog.slug, siteDomain);
            if (seenDestinations.has(destination)) {
                continue;
            }

            const candidateTargetKeywords = uniqueStrings(
                (blog.targetKeywords || []).filter(
                    k => typeof k === "string" && k.trim().length >= MIN_TERM_LENGTH
                )
            );

            const [candPrimaryKw] = candidateTargetKeywords;

            const topicKeywordMatches = topicKeywordsList.filter(
                tk =>
                    containsTerm(blog.title, tk) ||
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
                `${blog.title} ${candidateTargetKeywords.join(" ")}`
            );

            const entityOverlap = computeEntityOverlap(topicEntities, candidateEntities);

            const titleMatch =
                (normPrimaryKw && containsTerm(blog.title, normPrimaryKw)) ||
                (topicTitle && containsTerm(topicTitle, blog.title)) ||
                (topicTitle && containsTerm(blog.title, topicTitle));

            const hasVectorScore = vectorScores?.has(blog.id) ?? false;
            const rawVectorScore = hasVectorScore
                ? Number(vectorScores?.get(blog.id) ?? 0)
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
                continue;
            }

            let matchType: MatchType = "title";
            let anchorConcept = blog.title;

            if (candPrimaryKw && (topicKeywordMatches.includes(candPrimaryKw) || (normPrimaryKw && containsTerm(candPrimaryKw, normPrimaryKw)))) {
                matchType = "primary_keyword";
                anchorConcept = candPrimaryKw;
            } else if (normPrimaryKw && containsTerm(blog.title, normPrimaryKw)) {
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
                anchorConcept = blog.title;
            } else if (hasSemanticMatch) {
                matchType = "semantic";
                anchorConcept = blog.title;
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
                reasonParts.push(`title match with "${blog.title}"`);
            }
            if (hasVectorScore) {
                reasonParts.push(`semantic similarity ${vectorScore.toFixed(2)}`);
            }

            const reason = reasonParts.length > 0
                ? reasonParts.join("; ")
                : `Topic match with "${blog.title}"`;

            suggestions.push({
                destination,
                relationship,
                anchorConcept,
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
): Promise<Array<{ slug: string; title: string; targetKeywords: string[] }>> {
    if (!siteId || !Array.isArray(opportunities) || opportunities.length === 0) {
        return [];
    }

    const domain = normalizeDomain(siteDomain);
    const targetSlugToOpp = new Map<string, InternalLinkSuggestion>();
    const orderedSlugs: string[] = [];

    for (const opp of opportunities) {
        if (typeof opp?.destination !== "string" || !opp.destination.trim()) {
            continue;
        }

        const dest = opp.destination.trim();
        let extractedSlug: string | null = null;

        if (dest.startsWith("/")) {
            const match = dest.match(/^\/(?:blog|services)\/([^/?#]+)/i);
            if (match) {
                extractedSlug = match[1];
            }
        } else {
            try {
                const parsed = new URL(dest);
                const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
                if (domain && host !== domain && !domain.includes(host)) {
                    continue;
                }
                const match = parsed.pathname.match(/^\/(?:blog|services)\/([^/?#]+)/i);
                if (match) {
                    extractedSlug = match[1];
                }
            } catch {
                continue;
            }
        }

        if (!extractedSlug) {
            continue;
        }

        const normSlug = extractedSlug.toLowerCase().trim();
        const normCurrentSlug = currentSlug ? currentSlug.toLowerCase().trim() : "";

        if (normCurrentSlug && normSlug === normCurrentSlug) {
            continue;
        }

        if (!targetSlugToOpp.has(normSlug)) {
            targetSlugToOpp.set(normSlug, opp);
            orderedSlugs.push(normSlug);
        }
    }

    if (orderedSlugs.length === 0) {
        return [];
    }

    try {
        const matchedBlogs = await prisma.blog.findMany({
            where: {
                siteId,
                status: "PUBLISHED",
                slug: {
                    in: orderedSlugs,
                },
            },
            select: {
                slug: true,
                title: true,
                targetKeywords: true,
            },
        });

        const blogMap = new Map(matchedBlogs.map(b => [b.slug.toLowerCase().trim(), b]));

        const resolved: Array<{ slug: string; title: string; targetKeywords: string[] }> = [];

        for (const slug of orderedSlugs) {
            const blog = blogMap.get(slug);
            if (blog) {
                resolved.push({
                    slug: blog.slug,
                    title: blog.title,
                    targetKeywords: blog.targetKeywords || [],
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