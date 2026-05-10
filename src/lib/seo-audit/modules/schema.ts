import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { parse } from 'node-html-parser';
import { fetchHtml } from '../utils/fetch-html';

const MAX_HTML_BYTES = 10 * 1024 * 1024;

const RICH_RESULT_ELIGIBLE = new Set([
    'Article', 'BlogPosting', 'NewsArticle', 'FAQPage', 'Product',
    'BreadcrumbList', 'LocalBusiness', 'HowTo', 'Review', 'Event',
    'VideoObject', 'JobPosting', 'Course', 'Recipe',
]);

const SCHEMA_FIELD_RULES: Record<string, { required: string[]; recommended: string[] }> = {
    Organization: { required: ['name', 'url'], recommended: ['logo', 'sameAs', 'contactPoint'] },
    LocalBusiness: { required: ['name', 'address', 'telephone'], recommended: ['openingHours', 'geo', 'url', 'image'] },
    WebSite: { required: ['name', 'url'], recommended: ['potentialAction', 'description'] },
    WebPage: { required: ['name', 'url'], recommended: ['description', 'breadcrumb'] },
    Article: { required: ['headline', 'author', 'datePublished'], recommended: ['image', 'description', 'publisher', 'dateModified', 'url'] },
    BlogPosting: { required: ['headline', 'author', 'datePublished'], recommended: ['image', 'description', 'publisher', 'dateModified'] },
    NewsArticle: { required: ['headline', 'author', 'datePublished'], recommended: ['image', 'description', 'publisher'] },
    Product: { required: ['name', 'offers'], recommended: ['description', 'image', 'brand', 'sku', 'aggregateRating', 'review'] },
    FAQPage: { required: ['mainEntity'], recommended: [] },
    HowTo: { required: ['name', 'step'], recommended: ['description', 'image', 'totalTime'] },
    BreadcrumbList: { required: ['itemListElement'], recommended: [] },
    Review: { required: ['reviewRating', 'author', 'itemReviewed'], recommended: ['reviewBody', 'datePublished'] },
    AggregateRating: { required: ['ratingValue', 'reviewCount'], recommended: ['bestRating', 'worstRating'] },
    Event: { required: ['name', 'startDate', 'location'], recommended: ['description', 'endDate', 'image', 'performer', 'offers'] },
    VideoObject: { required: ['name', 'description', 'thumbnailUrl', 'uploadDate'], recommended: ['contentUrl', 'embedUrl', 'duration'] },
    Person: { required: ['name'], recommended: ['url', 'image', 'sameAs', 'jobTitle'] },
    JobPosting: { required: ['title', 'description', 'hiringOrganization', 'jobLocation', 'datePosted'], recommended: ['validThrough', 'baseSalary', 'employmentType'] },
    Course: { required: ['name', 'description', 'provider'], recommended: ['url', 'hasCourseInstance'] },
    Recipe: { required: ['name', 'recipeIngredient', 'recipeInstructions'], recommended: ['image', 'author', 'cookTime', 'recipeYield', 'nutrition'] },
    SiteLinksSearchBox: { required: ['potentialAction'], recommended: [] },
    Service: { required: ['name', 'provider'], recommended: ['description', 'serviceType', 'areaServed', 'url', 'offers'] },
    ProfessionalService: { required: ['name', 'address'], recommended: ['telephone', 'openingHours', 'priceRange', 'url'] },
};

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?)?$/;

interface SchemaValidationResult {
    type: string;
    missingRequired: string[];
    missingRecommended: string[];
    isRichResultEligible: boolean;
    validationErrors: string[];
}

function validateSchemaBlock(obj: Record<string, unknown>): SchemaValidationResult {
    const type = typeof obj['@type'] === 'string' ? obj['@type'] : 'Unknown';
    const rules = SCHEMA_FIELD_RULES[type];
    const isRichResultEligible = RICH_RESULT_ELIGIBLE.has(type);
    const validationErrors: string[] = [];

    if (!rules) {
        return { type, missingRequired: [], missingRecommended: [], isRichResultEligible, validationErrors };
    }

    const keys = Object.keys(obj);
    const missingRequired = rules.required.filter(f => !keys.includes(f));
    const missingRecommended = rules.recommended.filter(f => !keys.includes(f));

    if (
        (type === 'Article' || type === 'BlogPosting' || type === 'NewsArticle') &&
        obj['datePublished'] != null
    ) {
        const dp = String(obj['datePublished']);
        if (!ISO8601_RE.test(dp)) {
            validationErrors.push(`datePublished "${dp}" is not a valid ISO 8601 date (expected YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ).`);
        }
    }

    if (type === 'FAQPage' && obj['mainEntity'] != null) {
        const me = obj['mainEntity'];
        if (!Array.isArray(me) || me.length === 0) {
            validationErrors.push('FAQPage mainEntity must be a non-empty array of Question objects.');
        } else {
            const missingAnswers = (me as Record<string, unknown>[]).filter(
                q => typeof q?.acceptedAnswer !== 'object' ||
                    q.acceptedAnswer === null ||
                    typeof (q.acceptedAnswer as Record<string, unknown>).text !== 'string'
            ).length;
            if (missingAnswers > 0) {
                validationErrors.push(`${missingAnswers} FAQ Question(s) are missing acceptedAnswer.text — Google requires this for rich results.`);
            }
        }
    }

    if (type === 'BreadcrumbList' && Array.isArray(obj['itemListElement'])) {
        const ile = obj['itemListElement'] as Record<string, unknown>[];
        if (ile.length > 0) {
            const positions = ile.map(item => item?.position).filter(p => p != null);
            const isSequential = positions.every((p, i) => Number(p) === i + 1);
            if (!isSequential && positions.length > 0) {
                validationErrors.push(`BreadcrumbList itemListElement positions are not sequential starting from 1 (found: ${positions.join(', ')}).`);
            }
        }
    }

    if (type === 'Product' && obj['offers'] != null) {
        const offersArr = Array.isArray(obj['offers'])
            ? (obj['offers'] as Record<string, unknown>[])
            : [obj['offers'] as Record<string, unknown>];
        const missingPrice = offersArr.filter(o => !o?.price && !o?.priceSpecification).length;
        if (missingPrice > 0) {
            validationErrors.push(`Product offers missing price or priceSpecification on ${missingPrice} offer(s).`);
        }
    }

    if (isRichResultEligible && missingRequired.length > 0) {
        validationErrors.push('This schema type is eligible for Google Rich Results but missing required fields will disqualify it.');
    }

    return { type, missingRequired, missingRecommended, isRichResultEligible, validationErrors };
}

function extractBlocks(raw: unknown): Record<string, unknown>[] {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw)) return raw.flatMap(extractBlocks);
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) return (obj['@graph'] as unknown[]).flatMap(extractBlocks);
    return [obj];
}

function assertMaxHtmlSize(html: string, url: string): void {
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        throw new Error(`HTML payload for ${url} exceeds the ${MAX_HTML_BYTES / (1024 * 1024)} MB limit.`);
    }
}

function calculateScore(items: ChecklistItem[]): { score: number; passed: number; failed: number; warnings: number } {
    const analyzable = items.filter(i => i.status !== 'Skipped' && i.status !== 'Info');
    const passed = analyzable.filter(i => i.status === 'Pass').length;
    const failed = analyzable.filter(i => i.status === 'Fail').length;
    const warnings = analyzable.filter(i => i.status === 'Warning').length;
    const score = analyzable.length > 0
        ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
        : 0;
    return { score, passed, failed, warnings };
}

export const SchemaModule: AuditModule = {
    id: 'schema-markup',
    label: 'Schema Markup & Structured Data',

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        const html = context.html;

        if (!html) {
            return {
                id: SchemaModule.id,
                label: SchemaModule.label,
                items: [],
                score: 0,
                passed: 0,
                failed: 1,
                warnings: 0,
            };
        }

        assertMaxHtmlSize(html, context.url);

        const root = parse(html);
        const items: ChecklistItem[] = [];
        const schemaScripts = root.querySelectorAll('script[type="application/ld+json"]');

        const parsedBlocks: Record<string, unknown>[] = [];
        let parseErrors = 0;

        for (const script of schemaScripts) {
            const text = script.textContent?.trim() ?? '';
            if (!text) continue;
            try {
                parsedBlocks.push(...extractBlocks(JSON.parse(text)));
            } catch {
                parseErrors++;
            }
        }

        const hasMicrodata = html.includes('itemtype=') && html.includes('itemprop=');

        if (schemaScripts.length === 0 && !hasMicrodata) {
            items.push({
                id: 'schema-presence',
                label: 'Structured Data Presence',
                status: 'Fail',
                finding: 'No structured data found (no JSON-LD, Microdata, or RDFa). Rich snippet eligibility is lost.',
                recommendation: {
                    text: 'Add JSON-LD structured data. Minimum: Organization + WebSite. Then add page-specific types: Article, Product, FAQPage, BreadcrumbList as applicable.',
                    priority: 'High',
                },
                roiImpact: 85,
                aiVisibilityImpact: 100,
            });
        } else {
            const detectedTypes = parsedBlocks.map(b => (typeof b['@type'] === 'string' ? b['@type'] : 'Unknown'));
            items.push({
                id: 'schema-presence',
                label: 'Structured Data Presence',
                status: parseErrors > 0 ? 'Warning' : 'Pass',
                finding: `${schemaScripts.length} JSON-LD block(s) detected. Types: ${detectedTypes.join(', ')}${hasMicrodata ? '. Microdata also detected.' : ''}${parseErrors > 0 ? ` ${parseErrors} block(s) had JSON parse errors.` : ''}`,
                recommendation: parseErrors > 0
                    ? { text: "Fix JSON parse errors in your schema scripts. Use Google's Rich Results Test to validate.", priority: 'High' }
                    : undefined,
                roiImpact: 85,
                aiVisibilityImpact: 100,
                details: { blocks: schemaScripts.length, types: detectedTypes.join(', '), parseErrors },
            });
        }

        if (parseErrors > 0) {
            items.push({
                id: 'schema-parse-errors',
                label: 'Schema JSON Parse Errors',
                status: 'Fail',
                finding: `${parseErrors} JSON-LD block(s) could not be parsed (invalid JSON). Google will ignore these entirely.`,
                recommendation: {
                    text: 'Fix the malformed JSON in your schema scripts. Common causes: unescaped quotes, trailing commas. Validate at schema.org/validator.',
                    priority: 'High',
                },
                roiImpact: 80,
                aiVisibilityImpact: 90,
                details: { parseErrors },
            });
        }

        const checkedTypes = new Set<string>();

        for (const block of parsedBlocks) {
            const type = typeof block['@type'] === 'string' ? block['@type'] : 'Unknown';
            if (checkedTypes.has(type)) continue;
            checkedTypes.add(type);

            const { missingRequired, missingRecommended, isRichResultEligible, validationErrors } =
                validateSchemaBlock(block);

            if (!SCHEMA_FIELD_RULES[type]) {
                items.push({
                    id: `schema-type-${type.toLowerCase()}`,
                    label: `Schema: ${type}`,
                    status: 'Pass',
                    finding: `${type} detected. No custom validation rules defined — ensure it meets schema.org requirements.`,
                    roiImpact: 50,
                    aiVisibilityImpact: 60,
                });
                continue;
            }

            const deepErrors = validationErrors.filter(e =>
                !e.includes('eligible for Google Rich Results')
            );
            const hasDeepErrors = deepErrors.length > 0;
            const hasMissingReq = missingRequired.length > 0;
            const hasMissingRec = missingRecommended.length > 0;

            const status: 'Pass' | 'Warning' | 'Fail' =
                hasMissingReq || hasDeepErrors ? 'Warning' : hasMissingRec ? 'Warning' : 'Pass';

            const findingParts: string[] = [];
            if (hasMissingReq) findingParts.push(`Missing required field(s): ${missingRequired.join(', ')}.`);
            if (hasMissingRec) findingParts.push(`Missing recommended: ${missingRecommended.join(', ')}.`);
            if (hasDeepErrors) findingParts.push(...deepErrors);

            items.push({
                id: `schema-type-${type.toLowerCase()}`,
                label: `Schema: ${type}`,
                status,
                finding: findingParts.length > 0
                    ? findingParts.join(' ')
                    : `${type} schema is fully valid with all required and recommended fields.`,
                recommendation: (hasMissingReq || hasMissingRec || hasDeepErrors) ? {
                    text: hasMissingReq
                        ? `Add the missing required fields to your ${type} schema: ${missingRequired.join(', ')}.`
                        : hasMissingRec
                            ? `Add recommended fields to enhance your ${type} rich snippet: ${missingRecommended.join(', ')}.`
                            : deepErrors[0] ?? `Fix validation issues in your ${type} schema.`,
                    priority: hasMissingReq ? 'High' : 'Medium',
                } : undefined,
                roiImpact: 80,
                aiVisibilityImpact: 95,
                details: {
                    type,
                    missingRequired: missingRequired.join(', ') || 'none',
                    missingRecommended: missingRecommended.join(', ') || 'none',
                    isRichResultEligible,
                    validationErrors: deepErrors.join(' | ') || 'none',
                },
            });
        }

        const detectedTypeNames = new Set(
            parsedBlocks.map(b => (typeof b['@type'] === 'string' ? b['@type'] : ''))
        );

        if (!detectedTypeNames.has('WebSite') && !detectedTypeNames.has('SiteLinksSearchBox')) {
            items.push({
                id: 'schema-missing-website',
                label: 'Schema: WebSite (Missing)',
                status: 'Warning',
                finding: 'No WebSite schema detected. This enables the Google Sitelinks Search Box and establishes site identity for AI/LLM citation.',
                recommendation: {
                    text: 'Add WebSite schema with name, url, and a SearchAction potentialAction for sitelinks search box eligibility.',
                    priority: 'Medium',
                },
                roiImpact: 65,
                aiVisibilityImpact: 90,
            });
        }

        if (!detectedTypeNames.has('Organization') && !detectedTypeNames.has('LocalBusiness')) {
            items.push({
                id: 'schema-missing-org',
                label: 'Schema: Organization (Missing)',
                status: 'Warning',
                finding: 'No Organization or LocalBusiness schema detected. This is critical for Google Knowledge Panel and brand entity recognition.',
                recommendation: {
                    text: 'Add Organization schema with name, url, logo (as ImageObject), and sameAs links to your social profiles.',
                    priority: 'High',
                },
                roiImpact: 75,
                aiVisibilityImpact: 100,
            });
        }

        const hasBreadcrumbNav = root.querySelectorAll('[class*="breadcrumb"], nav[aria-label*="readcrumb"]').length > 0;
        if (hasBreadcrumbNav && !detectedTypeNames.has('BreadcrumbList')) {
            items.push({
                id: 'schema-missing-breadcrumb',
                label: 'Schema: BreadcrumbList (Missing)',
                status: 'Warning',
                finding: 'Breadcrumb navigation detected in HTML but no BreadcrumbList schema found. Breadcrumb rich results in SERPs are being missed.',
                recommendation: {
                    text: 'Add BreadcrumbList JSON-LD to match your visual breadcrumbs. This shows the navigation path in search results.',
                    priority: 'Medium',
                },
                roiImpact: 55,
                aiVisibilityImpact: 70,
            });
        }

        const hasFaqPattern =
            html.includes('accordion') ||
            root.querySelectorAll('[class*="faq"], details, summary').length > 2;
        if (hasFaqPattern && !detectedTypeNames.has('FAQPage')) {
            items.push({
                id: 'schema-missing-faq',
                label: 'Schema: FAQPage (Missing)',
                status: 'Warning',
                finding: 'FAQ or accordion content pattern detected in HTML but no FAQPage schema found. This content is eligible for PAA and FAQ rich results.',
                recommendation: {
                    text: 'Add FAQPage JSON-LD with mainEntity Question/Answer pairs to win People Also Ask placement.',
                    priority: 'Medium',
                },
                roiImpact: 70,
                aiVisibilityImpact: 85,
            });
        }

        const hasCoreServices = !!(context as AuditModuleContext & { site?: { coreServices?: string | null } }).site?.coreServices;
        const hasServiceSchema = detectedTypeNames.has('Service') || detectedTypeNames.has('ProfessionalService');
        if (hasCoreServices && !hasServiceSchema) {
            items.push({
                id: 'schema-missing-service',
                label: 'Schema: Service (Missing)',
                status: 'Warning',
                finding: 'Core services are defined but no Service or ProfessionalService schema detected. AI engines use this type to extract offering data.',
                recommendation: {
                    text: 'Add Service JSON-LD to each service page. Required: name, provider. Recommended: description, serviceType, areaServed, url.',
                    priority: 'High',
                },
                roiImpact: 90,
                aiVisibilityImpact: 100,
            });
        }

        if (hasMicrodata) {
            items.push({
                id: 'schema-microdata',
                label: 'Microdata Detected (Legacy)',
                status: 'Info',
                finding: "Inline Microdata (itemtype/itemprop) detected. Microdata is still supported but JSON-LD is Google's preferred format.",
                recommendation: {
                    text: 'Consider migrating Microdata to JSON-LD for easier maintenance and better Google support.',
                    priority: 'Low',
                },
                roiImpact: 40,
                aiVisibilityImpact: 50,
            });
        }

        const { score, passed, failed, warnings } = calculateScore(items);

        return {
            id: SchemaModule.id,
            label: SchemaModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    },
};