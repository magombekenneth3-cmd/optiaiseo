import { parse } from 'node-html-parser';
import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { probeLlmCitation } from '../llm-citation-probe';

const AI_BOTS = [
    { name: 'GPTBot', pattern: 'gptbot' },
    { name: 'ClaudeBot', pattern: 'claudebot' },
    { name: 'PerplexityBot', pattern: 'perplexitybot' },
    { name: 'CCBot', pattern: 'ccbot' },
    { name: 'Google-Extended', pattern: 'google-extended' },
    { name: 'Applebot-Extended', pattern: 'applebot-extended' },
];

function parseRobotsForBot(robotsText: string, botPattern: string): boolean {
    const lines = robotsText.split(/\r?\n/).map(l => l.split('#')[0].trim());
    let inRelevantBlock = false;
    let isBlocked = false;

    for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.startsWith('user-agent:')) {
            const agent = lower.replace('user-agent:', '').trim();
            inRelevantBlock = agent === botPattern || agent === '*';
        }
        if (inRelevantBlock && lower.startsWith('disallow:')) {
            const path = lower.replace('disallow:', '').trim();
            if (path === '/' || path === '/*') isBlocked = true;
        }
        if (inRelevantBlock && lower.startsWith('allow:')) {
            const path = lower.replace('allow:', '').trim();
            if (path === '/' || path === '/*') isBlocked = false;
        }
    }

    return isBlocked;
}

export const AiVisibilityModule: AuditModule = {
    id: 'ai-visibility',
    label: 'AI Visibility',
    requiresHtml: true,
    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        const items: ChecklistItem[] = [];
        const origin = new URL(context.url).origin;

        const [llmsResult, robotsResult] = await Promise.all([
            (async () => {
                try {
                    const headRes = await fetch(`${origin}/llms.txt`, {
                        method: "HEAD",
                        signal: AbortSignal.timeout(6000),
                        headers: { "User-Agent": "Mozilla/5.0 (compatible; AuditBot/1.0)" },
                    });

                    if (!headRes.ok) return { exists: false, hasFullVersion: false, quality: "missing" as const };

                    const bodyRes = await fetch(`${origin}/llms.txt`, {
                        signal: AbortSignal.timeout(8000),
                        headers: { "User-Agent": "Mozilla/5.0 (compatible; AuditBot/1.0)" },
                    });
                    const text = bodyRes.ok ? await bodyRes.text() : "";

                    const hasDescription = text.trim().length > 80;
                    const pageEntries = (text.match(/^- \[.+\]\(.+\)/gm) ?? []).length;
                    const hasSiteHeader = /^>\s?https?:\/\//m.test(text);

                    let quality: "good" | "partial" | "empty";
                    if (hasDescription && pageEntries >= 3 && hasSiteHeader) quality = "good";
                    else if (hasDescription || pageEntries > 0) quality = "partial";
                    else quality = "empty";

                    const fullRes = await fetch(`${origin}/llms-full.txt`, {
                        method: "HEAD",
                        signal: AbortSignal.timeout(4000),
                        headers: { "User-Agent": "Mozilla/5.0 (compatible; AuditBot/1.0)" },
                    }).catch(() => ({ ok: false as const }));

                    return { exists: true, hasFullVersion: fullRes.ok, quality, pageEntries };
                } catch {
                    return { exists: false, hasFullVersion: false, quality: "missing" as const, pageEntries: 0 };
                }
            })(),
            (async () => {
                try {
                    const res = await fetch(`${origin}/robots.txt`, {
                        signal: AbortSignal.timeout(6000),
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuditBot/1.0)' },
                    });
                    if (!res.ok) return { text: '', exists: false };
                    return { text: await res.text(), exists: true };
                } catch {
                    return { text: '', exists: false };
                }
            })(),
        ]);

        items.push({
            id: 'llms-txt',
            label: 'llms.txt (AI crawler directives)',
            status: llmsResult.quality === "good"
                ? 'Pass'
                : llmsResult.quality === "partial"
                ? 'Warning'
                : 'Fail',
            finding: llmsResult.quality === "good"
                ? `llms.txt found and well-formed: site header, description, and ${llmsResult.pageEntries} page entries detected.${llmsResult.hasFullVersion ? ' llms-full.txt also present.' : ''}`
                : llmsResult.quality === "partial"
                ? `llms.txt exists at ${origin}/llms.txt but content is incomplete (${llmsResult.pageEntries ?? 0} page entries found, expected ≥3). AI crawlers may index your site poorly.`
                : `No llms.txt found at ${origin}/llms.txt. AI crawlers cannot discover your content structure.`,
            recommendation: llmsResult.quality !== "good" ? {
                text: `Create /llms.txt at your domain root with:\n\n> ${origin}\n\n# [Your site name]\n[One paragraph description.]\n\n## Pages\n- [Home](${origin}/): Homepage\n- [Blog](${origin}/blog/): Blog\n\nSee https://llmstxt.org for the full spec.`,
                priority: llmsResult.quality === "missing" ? 'High' : 'Medium',
            } : undefined,
            roiImpact: 80,
            aiVisibilityImpact: 100,
            details: {
                exists:         llmsResult.exists,
                hasFullVersion: llmsResult.hasFullVersion,
                quality:        llmsResult.quality,
                pageEntries:    llmsResult.pageEntries ?? 0,
            },
        });

        if (robotsResult.exists) {
            const blockedBots: string[] = [];
            const allowedBots: string[] = [];

            for (const bot of AI_BOTS) {
                if (parseRobotsForBot(robotsResult.text, bot.pattern)) {
                    blockedBots.push(bot.name);
                } else {
                    allowedBots.push(bot.name);
                }
            }

            const allBlocked = blockedBots.length === AI_BOTS.length;
            const someBlocked = blockedBots.length > 0 && !allBlocked;

            items.push({
                id: 'ai-bot-robots',
                label: 'AI Crawler Access (robots.txt)',
                status: blockedBots.length === 0 ? 'Pass' : allBlocked ? 'Fail' : 'Warning',
                finding: blockedBots.length === 0
                    ? `All checked AI crawlers are permitted: ${allowedBots.join(', ')}.`
                    : `${blockedBots.length} AI crawler(s) blocked via robots.txt: ${blockedBots.join(', ')}.${someBlocked ? ` Allowed: ${allowedBots.join(', ')}.` : ' All checked AI crawlers are blocked.'}`,
                recommendation: blockedBots.length > 0 ? {
                    text: `Blocking ${blockedBots.join(', ')} prevents your content from surfacing in AI-generated answers. If this is intentional, no action needed. To allow them, remove or update their robots.txt rules:\n\nUser-agent: ${blockedBots[0]}\nAllow: /`,
                    priority: allBlocked ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 100,
                details: { blockedBots: blockedBots.join(', '), allowedBots: allowedBots.join(', ') },
            });
        } else {
            items.push({
                id: 'ai-bot-robots',
                label: 'AI Crawler Access (robots.txt)',
                status: 'Warning',
                finding: 'Could not fetch robots.txt to verify AI crawler access rules.',
                roiImpact: 70,
                aiVisibilityImpact: 100,
            });
        }

        if (context.html) {
            const root = parse(context.html);
            const combinedSchema = root
                .querySelectorAll('script[type="application/ld+json"]')
                .map((el) => el.text.toLowerCase())
                .join(' ');

            const hasArticleSchema = /\"@type\"\s*:\s*\"(article|blogposting|newsarticle)\"/i.test(combinedSchema);
            const hasAuthorInSchema = combinedSchema.includes('"author"');
            const hasDateModified = combinedSchema.includes('"datemodified"') || combinedSchema.includes('"datepublished"');

            const AUTHORITATIVE_DOMAINS = [
                'gov', 'edu', 'who.int', 'pubmed', 'ncbi.nlm.nih.gov',
                'reuters.com', 'bbc.com', 'apnews.com', 'nature.com',
            ];
            const externalLinks = root.querySelectorAll('a[href^="http"]');
            const hasAuthoritativeLink = externalLinks.some((a) => {
                const href = a.getAttribute('href') ?? '';
                return AUTHORITATIVE_DOMAINS.some((d) => href.includes(d));
            });

            const citationSignals = [hasArticleSchema, hasAuthorInSchema, hasDateModified, hasAuthoritativeLink];
            const citationScore = citationSignals.filter(Boolean).length;

            items.push({
                id: 'aeo-citation-readiness',
                label: 'Citation Readiness (AI engines)',
                status: citationScore >= 3 ? 'Pass' : citationScore >= 2 ? 'Warning' : 'Fail',
                finding: citationScore >= 3
                    ? `Strong citation signals: Article/BlogPosting schema${hasAuthorInSchema ? ', named author' : ''}${hasDateModified ? ', publication date' : ''}${hasAuthoritativeLink ? ', authoritative outbound link' : ''}.`
                    : `Weak citation signals (${citationScore}/4): missing ${[
                          !hasArticleSchema && 'Article/BlogPosting schema',
                          !hasAuthorInSchema && 'author attribution in schema',
                          !hasDateModified && 'datePublished/dateModified',
                          !hasAuthoritativeLink && 'authoritative outbound link',
                      ].filter(Boolean).join(', ')}.`,
                recommendation: citationScore < 3 ? {
                    text: [
                        !hasArticleSchema && '• Add "@type": "Article" or "BlogPosting" to your JSON-LD schema.',
                        !hasAuthorInSchema && '• Include an "author" field in schema.',
                        !hasDateModified && '• Add "datePublished" and "dateModified" to your Article schema.',
                        !hasAuthoritativeLink && '• Link out to at least one authoritative external source.',
                    ].filter(Boolean).join('\n'),
                    priority: citationScore === 0 ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 75,
                aiVisibilityImpact: 95,
                details: { hasArticleSchema, hasAuthorInSchema, hasDateModified, hasAuthoritativeLink, citationScore },
            });

            const h1Text = root.querySelector('h1')?.text.trim().toLowerCase() ?? '';
            const bodyContainer = root.querySelector('main, article, [role="main"]')
                ?? root.querySelector('.content, .post-content, .entry-content')
                ?? root.querySelector('body');

            const bodyText = (bodyContainer?.text ?? '').replace(/\s+/g, ' ').trim();
            const first100Words = bodyText.split(/\s+/).slice(0, 100).join(' ').toLowerCase();

            const H1_STOP = new Set(['a','an','the','and','or','in','on','at','to','for','of','with','is','are','how','what','why','when','where','does','do']);
            const h1Keywords = h1Text
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length > 3 && !H1_STOP.has(w));

            const matchedKeywords = h1Keywords.filter((kw) => first100Words.includes(kw));
            const keywordCoverage = h1Keywords.length > 0 ? matchedKeywords.length / h1Keywords.length : 0;

            const firstSentenceMatch = first100Words.match(/[^.!?]+[.!?]/);
            const hasDirectOpeningSentence = (firstSentenceMatch?.[0]?.split(/\s+/).length ?? 0) >= 8;
            const answerBoxReady = keywordCoverage >= 0.5 && hasDirectOpeningSentence;
            const answerBoxPartial = keywordCoverage >= 0.3 || hasDirectOpeningSentence;

            items.push({
                id: 'aeo-answer-box-structure',
                label: 'Answer-box structure',
                status: answerBoxReady ? 'Pass' : answerBoxPartial ? 'Warning' : 'Fail',
                finding: answerBoxReady
                    ? 'Opening paragraph directly addresses the page topic — well-positioned for AI answer extraction.'
                    : `Opening paragraph ${answerBoxPartial ? 'partially matches' : 'does not clearly address'} the H1 topic (${Math.round(keywordCoverage * 100)}% keyword coverage).`,
                recommendation: !answerBoxReady ? {
                    text: '• Start the first paragraph with a direct, complete-sentence answer to the implied question in your H1.\n• Aim for 40–80 words that stand alone as a useful answer.',
                    priority: !answerBoxPartial ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 70,
                aiVisibilityImpact: 90,
                details: { keywordCoveragePercent: Math.round(keywordCoverage * 100), hasDirectOpeningSentence },
            });

            const QUESTION_RE = /^(what|how|why|is|are|can|does|do|should|which|when|where|who|will)\b/i;
            const subheadings = root.querySelectorAll('h2, h3');
            const totalHeadings = subheadings.length;
            const questionHeadings = subheadings.filter((h) => QUESTION_RE.test(h.text.trim()));
            const questionCount = questionHeadings.length;
            const questionRatio = totalHeadings > 0 ? questionCount / totalHeadings : 0;

            const convStatus = (questionCount >= 2 && questionRatio >= 0.25) ? 'Pass'
                : questionCount >= 1 ? 'Warning'
                : 'Fail';

            items.push({
                id: 'aeo-conversational-headings',
                label: 'Conversational headings (AEO)',
                status: convStatus,
                finding: convStatus === 'Pass'
                    ? `${questionCount} of ${totalHeadings} subheadings are question-formatted.`
                    : totalHeadings === 0
                    ? 'No H2/H3 subheadings found.'
                    : `Only ${questionCount} of ${totalHeadings} subheadings are question-formatted (${Math.round(questionRatio * 100)}%).`,
                recommendation: convStatus !== 'Pass' ? {
                    text: '• Rewrite at least 2–3 subheadings as direct questions (How/What/Why…).\n• Each question heading should be followed by a concise 2–4 sentence answer.',
                    priority: questionCount === 0 ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 65,
                aiVisibilityImpact: 88,
                details: { totalHeadings, questionHeadings: questionCount, questionRatioPercent: Math.round(questionRatio * 100) },
            });

            if (!process.env.GEMINI_API_KEY) {
                items.push({
                    id: 'aeo-llm-citation-probe',
                    label: 'AI Citation Probe (Gemini)',
                    status: 'Info',
                    finding: 'AI citation probe is not configured. Add GEMINI_API_KEY to your environment to enable it.',
                    recommendation: {
                        text: 'Add GEMINI_API_KEY to your environment variables. This check simulates whether Gemini would cite this page in an AI search answer — it is one of the highest-signal checks in the audit.',
                        priority: 'Medium',
                    },
                    roiImpact: 90,
                    aiVisibilityImpact: 100,
                });
            } else {
                try {
                    const h1Text = root.querySelector('h1')?.text.trim() ?? '';
                    const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
                    const bodyEl = root.querySelector('main, article, [role="main"]') ?? root.querySelector('body');
                    const bodyWords = (bodyEl?.text ?? '').replace(/\s+/g, ' ').trim().split(/\s+/).slice(0, 400).join(' ');
                    const schemaTypes = root
                        .querySelectorAll('script[type="application/ld+json"]')
                        .map(el => { try { return (JSON.parse(el.text) as { '@type'?: string })['@type'] ?? ''; } catch { return ''; } })
                        .filter(Boolean)
                        .join(', ');

                    const probe = await probeLlmCitation(
                        context.url,
                        h1Text || 'this page',
                        metaDesc,
                        bodyWords,
                        schemaTypes,
                    );

                    const probeStatus = probe.score >= 4 ? 'Pass'
                        : probe.score === 3 ? 'Warning'
                        : probe.score === 0 ? 'Info'   // API unavailable
                        : 'Fail';

                    const perEngineLines: string[] = [];
                    if (probe.geminiScore != null)     perEngineLines.push(`Gemini Search: ${probe.geminiScore}/5`);
                    if (probe.perplexityScore != null) perEngineLines.push(`Perplexity: ${probe.perplexityScore}/5`);
                    if (probe.chatGptScore != null)    perEngineLines.push(`ChatGPT Search: ${probe.chatGptScore}/5`);
                    const perEngineSuffix = perEngineLines.length > 0
                        ? ` Per-engine: ${perEngineLines.join(', ')}.`
                        : '';

                    const groundingSuffix = probe.groundingUsed
                        ? ` (scored against live web search results)${probe.groundingSources?.length ? ` — grounded on ${probe.groundingSources.length} real-time source(s)` : ''}.`
                        : ' (scored against model training data — add PAGESPEED_API_KEY and ensure Google Search grounding is enabled for live results).';

                    items.push({
                        id: 'aeo-llm-citation-probe',
                        label: `AI Citation Probe (Gemini${probe.groundingUsed ? ' + Live Web' : ''})`,
                        status: probeStatus,
                        finding: probe.score === 0
                            ? 'Citation probe skipped (API unavailable).'
                            : probe.wouldCite
                            ? `AI engines would cite this page (score ${probe.score}/5): ${probe.reasoning}${perEngineSuffix}${groundingSuffix}`
                            : `AI engines would NOT cite this page (score ${probe.score}/5): ${probe.reasoning}${perEngineSuffix}${groundingSuffix}`,
                        recommendation: !probe.wouldCite && probe.missingSignals.length > 0 ? {
                            text: [
                                `Top missing citation signals:\n${probe.missingSignals.map(s => `• ${s}`).join('\n')}`,
                                probe.wouldCiteIf ? `\nQuick win: ${probe.wouldCiteIf}` : '',
                                probe.engineDifference && probe.engineDifference !== 'No significant difference'
                                    ? `\nEngine difference: ${probe.engineDifference}` : '',
                            ].filter(Boolean).join(''),
                            priority: probe.score <= 2 ? 'High' : 'Medium',
                        } : undefined,
                        roiImpact: 90,
                        aiVisibilityImpact: 100,
                        details: {
                            probeScore:       probe.score,
                            wouldCite:        probe.wouldCite,
                            groundingUsed:    probe.groundingUsed,
                            missingSignals:   probe.missingSignals.join('; '),
                            geminiScore:      probe.geminiScore ?? 0,
                            perplexityScore:  probe.perplexityScore ?? 0,
                            chatGptScore:     probe.chatGptScore ?? 0,
                            cachedAt:         probe.cachedAt,
                        } as Record<string, string | number | boolean>,
                    });
                } catch {
                    items.push({
                        id: 'aeo-llm-citation-probe',
                        label: 'AI Citation Probe (Gemini)',
                        status: 'Info',
                        finding: 'Citation probe could not complete.',
                        roiImpact: 90,
                        aiVisibilityImpact: 100,
                    });
                }
            }
            // Semantic Entity Authority: Google KG + Wikidata + sameAs + Topic Entities
            const kgApiKey = process.env.GOOGLE_KG_API_KEY;

            const allSchemaBlocks = root.querySelectorAll('script[type="application/ld+json"]')
                .map(s => { try { return JSON.parse(s.text) as Record<string, unknown>; } catch { return null; } })
                .filter((b): b is Record<string, unknown> => b !== null);

            const orgBlock = allSchemaBlocks.find(b =>
                b['@type'] === 'Organization' || b['@type'] === 'LocalBusiness'
            );

            const brandName = (() => {
                if (orgBlock?.name) return String(orgBlock.name).trim();
                return root.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()
                    ?? root.querySelector('title')?.text?.split(/[|\-\u2013]/)[0]?.trim()
                    ?? '';
            })();

            const declaredSameAs: string[] = (() => {
                const raw = orgBlock?.sameAs;
                if (!raw) return [];
                return (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean);
            })();

            const hasDeclaredWikidata   = declaredSameAs.some(u => u.includes('wikidata.org'));
            const hasDeclaredWikipedia  = declaredSameAs.some(u => u.includes('wikipedia.org'));
            const hasDeclaredLinkedIn   = declaredSameAs.some(u => u.includes('linkedin.com'));
            const hasDeclaredCrunchbase = declaredSameAs.some(u => u.includes('crunchbase.com'));

            const headingTexts = root.querySelectorAll('h1, h2, h3')
                .map(h => h.text.trim())
                .filter(t => t.length > 3)
                .slice(0, 12);

            const candidateTopics = Array.from(new Set([
                ...headingTexts.flatMap(t =>
                    t.split(/[\s,\u2013\-:]+/).filter(w => w.length > 4 && /^[A-Z]/.test(w))
                ),
            ])).filter(t => t !== brandName).slice(0, 4);

            type KgResponse = {
                itemListElement?: Array<{
                    result?: {
                        name?: string;
                        '@type'?: string[];
                        description?: string;
                        detailedDescription?: { articleBody?: string; url?: string };
                        '@id'?: string;
                        url?: string;
                    };
                    resultScore?: number;
                }>;
            };
            type WdResponse = {
                search?: Array<{ id?: string; label?: string; description?: string; concepturi?: string }>;
            };

            const [kgResult, wikidataResult] = await Promise.all([
                (async (): Promise<KgResponse | null> => {
                    if (!kgApiKey || !brandName) return null;
                    try {
                        const res = await fetch(
                            `https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(brandName)}&key=${kgApiKey}&limit=3&types=Organization,Person,Product,SoftwareApplication,Brand`,
                            { signal: AbortSignal.timeout(8000) }
                        );
                        if (!res.ok) return null;
                        return await res.json() as KgResponse;
                    } catch { return null; }
                })(),
                (async (): Promise<WdResponse | null> => {
                    if (!brandName) return null;
                    try {
                        const res = await fetch(
                            `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brandName)}&language=en&limit=3&format=json&type=item`,
                            { headers: { 'User-Agent': 'SEOAuditBot/1.0' }, signal: AbortSignal.timeout(8000) }
                        );
                        if (!res.ok) return null;
                        return await res.json() as WdResponse;
                    } catch { return null; }
                })(),
            ]);

            type TopicEntity = { topic: string; qid: string; label: string; description: string };
            const topicEntityResults = await Promise.all(
                candidateTopics.map(async (topic): Promise<TopicEntity | null> => {
                    try {
                        const res = await fetch(
                            `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(topic)}&language=en&limit=1&format=json&type=item`,
                            { headers: { 'User-Agent': 'SEOAuditBot/1.0' }, signal: AbortSignal.timeout(5000) }
                        );
                        if (!res.ok) return null;
                        const data = await res.json() as WdResponse;
                        const hit = data.search?.[0];
                        return hit?.id ? { topic, qid: hit.id, label: hit.label ?? topic, description: hit.description ?? '' } : null;
                    } catch { return null; }
                })
            );
            const foundTopicEntities = topicEntityResults.filter((r): r is TopicEntity => r !== null);

            const kgTop    = kgResult?.itemListElement?.[0]?.result;
            const kgScore  = kgResult?.itemListElement?.[0]?.resultScore ?? 0;
            const hasGoogleKgEntity = !!kgTop;
            const kgId          = kgTop?.['@id'] ?? '';
            const kgTypes       = (kgTop?.['@type'] ?? []).join(', ');
            const kgDescription = kgTop?.description ?? kgTop?.detailedDescription?.articleBody ?? '';
            const kgWikipediaUrl = kgTop?.detailedDescription?.url ?? '';

            const wdTop = wikidataResult?.search?.[0];
            const hasWikidataEntity = !!wdTop;
            const wikidataQid  = wdTop?.id ?? '';
            const wikidataUrl  = wdTop?.concepturi ?? (wikidataQid ? `https://www.wikidata.org/wiki/${wikidataQid}` : '');
            const hasWikipedia = !!kgWikipediaUrl || hasDeclaredWikipedia;

            const sameAsIssues: string[] = [];
            if (hasGoogleKgEntity && kgId && !declaredSameAs.some(u => kgId && u.includes(kgId.replace('kg:/g/', '')))) {
                sameAsIssues.push(`Add Google KG ID "${kgId}" as a sameAs entry in your Organization schema.`);
            }
            if (hasWikidataEntity && wikidataQid && !hasDeclaredWikidata) {
                sameAsIssues.push(`Add Wikidata URL "https://www.wikidata.org/wiki/${wikidataQid}" as sameAs in your Organization schema.`);
            }
            if (!hasDeclaredWikipedia && hasWikipedia) {
                sameAsIssues.push('Add your Wikipedia article URL as sameAs — strongest LLM training signal available.');
            }
            if (!hasDeclaredLinkedIn) {
                sameAsIssues.push('Add your LinkedIn company URL as sameAs to reinforce entity signals in business knowledge graphs.');
            }
            if (!hasDeclaredCrunchbase) {
                sameAsIssues.push('Add your Crunchbase URL as sameAs — indexed by Perplexity and ChatGPT Search as an authoritative org source.');
            }

            const authoritySignals = [
                hasGoogleKgEntity,
                hasWikidataEntity,
                hasWikipedia,
                hasDeclaredWikidata,
                hasDeclaredLinkedIn,
                declaredSameAs.length >= 3,
            ].filter(Boolean).length;

            const entityStatus: 'Pass' | 'Warning' | 'Fail' =
                authoritySignals >= 4 ? 'Pass'
                : authoritySignals >= 2 ? 'Warning'
                : 'Fail';

            const entityFindings: string[] = [
                `Entity authority: ${authoritySignals}/6 signals.`,
                hasGoogleKgEntity
                    ? `Google KG: "${kgTop?.name ?? brandName}" found (${kgTypes}, relevance=${Math.round(kgScore)}${kgId ? `, mid=${kgId}` : ''}).`
                    : kgApiKey ? `Google KG: "${brandName}" not found.` : 'Google KG: skipped (GOOGLE_KG_API_KEY not set).',
                hasWikidataEntity
                    ? `Wikidata: ${wikidataQid} "${wdTop?.label}" — ${(wdTop?.description ?? '').slice(0, 80)}.`
                    : `Wikidata: "${brandName}" not found.`,
                kgDescription ? `KG description: "${kgDescription.slice(0, 100)}\u2026"` : '',
                declaredSameAs.length > 0
                    ? `sameAs declared (${declaredSameAs.length}): ${declaredSameAs.slice(0, 3).join(', ')}${declaredSameAs.length > 3 ? '\u2026' : ''}.`
                    : 'sameAs: none declared in Organization schema.',
                foundTopicEntities.length > 0
                    ? `Topic entities with Wikidata IDs: ${foundTopicEntities.map(e => `${e.label} (${e.qid})`).join(', ')}.`
                    : '',
            ].filter(Boolean);

            const sameAsRec = [
                sameAsIssues.length > 0 ? `sameAs fixes:\n${sameAsIssues.map(i => `\u2022 ${i}`).join('\n')}` : '',
                !hasGoogleKgEntity
                    ? '\nBuild KG entity authority:\n\u2022 Create/claim a Wikipedia article or Wikidata item for your brand.\n\u2022 Deploy Organization schema with a full sameAs array.\n\u2022 Publish consistent NAP across directories, press, and partner sites.\n\u2022 KG recognition typically takes 3\u20136 months of accumulated E-E-A-T signals.'
                    : '',
                foundTopicEntities.length === 0 && candidateTopics.length > 0
                    ? '\nTopic entity optimisation:\n\u2022 Add schema types (Person, Product, Event) with sameAs Wikidata QIDs for key topics on this page.\n\u2022 LLMs use entity co-occurrence to score topical authority — tagging topics with machine IDs strengthens AI citation signals.'
                    : '',
            ].filter(Boolean).join('\n').trim();

            items.push({
                id: 'aeo-kg-entity',
                label: 'Semantic Entity Authority (KG + Wikidata)',
                status: entityStatus,
                finding: entityFindings.join(' '),
                recommendation: (sameAsIssues.length > 0 || !hasGoogleKgEntity || !hasWikidataEntity) ? {
                    text: sameAsRec || 'Add sameAs links to Wikidata, Wikipedia, LinkedIn, and Crunchbase in your Organization schema.',
                    priority: entityStatus === 'Fail' ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 90,
                aiVisibilityImpact: 100,
                details: {
                    brandName,
                    authorityScore:      authoritySignals,
                    hasGoogleKgEntity,
                    kgId:               kgId || 'none',
                    kgTypes:            kgTypes || 'none',
                    hasWikidataEntity,
                    wikidataQid:        wikidataQid || 'none',
                    wikidataUrl:        wikidataUrl || 'none',
                    hasWikipedia,
                    sameAsCount:        declaredSameAs.length,
                    hasDeclaredWikidata,
                    hasDeclaredLinkedIn,
                    topicEntitiesFound: foundTopicEntities.length,
                    topicEntities:      foundTopicEntities.map(e => `${e.label}:${e.qid}`).join(', ') || 'none',
                    sameAsIssueCount:   sameAsIssues.length,
                } as Record<string, string | number | boolean>,
            });

            // Speakable schema + voice/AI search readiness
            const combinedSchemaText = root
                .querySelectorAll('script[type="application/ld+json"]')
                .map(el => el.text.toLowerCase())
                .join(' ');

            const hasSpeakable  = combinedSchemaText.includes('"speakable"') || combinedSchemaText.includes('speakable');
            const hasQAPage     = /"@type"\s*:\s*"qapage"/i.test(combinedSchemaText);
            const hasHowTo      = /"@type"\s*:\s*"howto"/i.test(combinedSchemaText);
            const hasFAQPage    = /"@type"\s*:\s*"faqpage"/i.test(combinedSchemaText);

            const voicePatterns = [
                root.querySelectorAll('h2, h3').filter(h =>
                    /^(what|how|why|is|are|can|does|do|should|which|when|where|who|will)\b/i.test(h.text.trim())
                ).length >= 2,
                hasSpeakable,
                hasQAPage,
                hasHowTo || hasFAQPage,
            ].filter(Boolean).length;

            const voiceMissing: string[] = [
                !hasSpeakable ? 'Speakable schema (@type: Speakable with cssSelector or xPath)' : '',
                !hasQAPage    ? 'QAPage schema for Q&A content' : '',
                !hasHowTo     ? 'HowTo schema for instructional content' : '',
                !hasFAQPage   ? 'FAQPage schema for FAQ content' : '',
            ].filter(Boolean);

            items.push({
                id: 'aeo-voice-speakable',
                label: 'Voice Search & Speakable Schema (AEO)',
                status: voicePatterns >= 3 ? 'Pass' : voicePatterns >= 2 ? 'Warning' : 'Fail',
                finding: voicePatterns >= 3
                    ? `Voice/AI search readiness: Speakable=${hasSpeakable ? '✓' : '✗'}, QAPage=${hasQAPage ? '✓' : '✗'}, HowTo=${hasHowTo ? '✓' : '✗'}, FAQPage=${hasFAQPage ? '✓' : '✗'}. Page is well-configured for voice answer extraction.`
                    : `Voice/AI search readiness score: ${voicePatterns}/4 signals. Missing: ${voiceMissing.join(', ')}. Voice search and AI answer engines (Siri, Alexa, Google Assistant, Perplexity) rely on these schemas to extract spoken answers.`,
                recommendation: voicePatterns < 3 ? {
                    text: [
                        !hasSpeakable
                            ? '• Add Speakable JSON-LD to mark sections suitable for text-to-speech:\n  {"@type":"WebPage","speakable":{"@type":"SpeakableSpecification","cssSelector":[".article-intro",".article-summary"]}}'
                            : '',
                        !hasQAPage && root.querySelectorAll('details, summary').length > 0
                            ? '• Wrap Q&A content in QAPage schema with Question/Answer objects (similar to FAQPage but for single primary questions).'
                            : '',
                        !hasHowTo && (context.html.includes('step') || context.html.includes('Step'))
                            ? '• Add HowTo schema for step-by-step instructional content — eligible for How-to rich results in Google and voice answers in Google Assistant.'
                            : '',
                    ].filter(Boolean).join('\n') || 'Add Speakable, FAQPage, HowTo, or QAPage schema to make content extractable by voice AI engines.',
                    priority: voicePatterns === 0 ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 78,
                aiVisibilityImpact: 95,
                details: {
                    hasSpeakable,
                    hasQAPage,
                    hasHowTo,
                    hasFAQPage,
                    voiceReadinessScore: voicePatterns,
                } as Record<string, string | number | boolean>,
            });
        }

        const analyzable = items.filter(i => i.status !== 'Skipped' && i.status !== 'Info');
        const passed = analyzable.filter(i => i.status === 'Pass').length;
        const failed = analyzable.filter(i => i.status === 'Fail').length;
        const warnings = analyzable.filter(i => i.status === 'Warning').length;
        const score = analyzable.length > 0 ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100) : 0;

        return {
            id: AiVisibilityModule.id,
            label: AiVisibilityModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    },
};