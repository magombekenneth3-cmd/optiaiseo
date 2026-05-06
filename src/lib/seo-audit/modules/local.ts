import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from '../types';
import { parse, HTMLElement } from 'node-html-parser';
import { fetchHtml } from '../utils/fetch-html';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max HTML size accepted for parsing (10 MB). Prevents memory exhaustion. */
const MAX_HTML_BYTES = 10 * 1024 * 1024;

/**
 * Universal local-directory hostnames we look for in outbound links.
 * Kept as plain hostname substrings so matching stays O(n) and easy to extend.
 */
const LOCAL_DIRECTORY_PATTERNS: readonly string[] = [
    'google.com/maps',
    'maps.google',
    'maps.apple.com',
    'bing.com/maps',
    'yelp.com',
    'yp.com',
    'yellowpages.com',
    'bbb.org',
    'foursquare.com',
    'tripadvisor.com',
    'facebook.com/pages',
    'facebook.com/business',
    'nextdoor.com',
    'angieslist.com',
    'houzz.com',
] as const;

/**
 * Schema @type values that qualify as a local-business context.
 * Includes common sub-types so "Restaurant", "Hotel", etc. are all caught.
 * Source: https://schema.org/LocalBusiness
 */
const LOCAL_BUSINESS_TYPES = new Set([
    'LocalBusiness',
    'AnimalShelter', 'ArchiveOrganization', 'AutomotiveBusiness', 'ChildCare',
    'Dentist', 'DryCleaningOrLaundry', 'EmergencyService', 'EmploymentAgency',
    'EntertainmentBusiness', 'FinancialService', 'FoodEstablishment',
    'GovernmentOffice', 'HealthAndBeautyBusiness', 'HomeAndConstructionBusiness',
    'InternetCafe', 'LegalService', 'Library', 'LodgingBusiness',
    'MedicalBusiness', 'ProfessionalService', 'RadioStation', 'RealEstateAgent',
    'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'SportsActivityLocation',
    'Store', 'TelevisionStation', 'TouristInformationCenter',
    'TravelAgency', 'Restaurant', 'Hotel', 'Bar', 'Cafe', 'Bakery',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a schema @type value (string or string[]) matches any
 * recognised local-business type.
 */
function isLocalBusinessType(type: unknown): boolean {
    if (typeof type === 'string') return LOCAL_BUSINESS_TYPES.has(type);
    if (Array.isArray(type)) return type.some(t => typeof t === 'string' && LOCAL_BUSINESS_TYPES.has(t));
    return false;
}

interface NapCheckResult {
    hasLocalBusinessSchema: boolean;
    hasValidNap: boolean;
    hasReviewSchema: boolean;
}

/**
 * Parses all JSON-LD <script> blocks and extracts NAP/review signals.
 * Fails gracefully per-block so one malformed script doesn't abort the rest.
 */
function checkSchemas(schemaElements: HTMLElement[]): NapCheckResult {
    let hasLocalBusinessSchema = false;
    let hasValidNap = false;
    let hasReviewSchema = false;

    for (const script of schemaElements) {
        const raw = script.textContent?.trim();
        if (!raw) continue;

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            // Malformed JSON-LD — skip; don't infer intent from raw text
            continue;
        }

        const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            const node = entry as Record<string, unknown>;

            // --- Local business type detection ---
            if (isLocalBusinessType(node['@type'])) {
                hasLocalBusinessSchema = true;

                const hasName =
                    typeof node.name === 'string' && node.name.trim().length > 0;

                const addr = node.address;
                const hasAddress =
                    typeof addr === 'string' ||
                    (addr !== null &&
                        typeof addr === 'object' &&
                        typeof (addr as Record<string, unknown>).streetAddress === 'string' &&
                        ((addr as Record<string, unknown>).streetAddress as string).trim().length > 0);

                const hasPhone =
                    typeof node.telephone === 'string' && node.telephone.trim().length > 0;

                if (hasName && hasAddress && hasPhone) {
                    hasValidNap = true;
                }
            }

            // --- Review / rating detection ---
            // Check both the entry itself and nested graph nodes
            if (containsReviewSchema(node)) {
                hasReviewSchema = true;
            }
        }
    }

    return { hasLocalBusinessSchema, hasValidNap, hasReviewSchema };
}

/**
 * Recursively checks whether a parsed JSON-LD node contains AggregateRating
 * or Review @type declarations (handles @graph arrays too).
 */
function containsReviewSchema(node: Record<string, unknown>): boolean {
    const type = node['@type'];
    if (
        type === 'AggregateRating' ||
        type === 'Review' ||
        (Array.isArray(type) && (type.includes('AggregateRating') || type.includes('Review')))
    ) {
        return true;
    }

    // Check aggregateRating / review sub-properties
    for (const key of ['aggregateRating', 'review', '@graph'] as const) {
        const child = node[key];
        if (!child) continue;
        const children = Array.isArray(child) ? child : [child];
        for (const c of children) {
            if (c && typeof c === 'object' && containsReviewSchema(c as Record<string, unknown>)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Phone-number detection.
 *
 * Uses two explicit, bounded patterns instead of one open-ended regex to
 * prevent catastrophic backtracking (ReDoS).
 *
 * Pattern A — E.164 / international:  +CountryCode digits, min 7 digits total
 * Pattern B — local formats:          3-digit area code + 7-digit number,
 *             optionally separated by spaces, dashes, dots, or parens.
 */
const PHONE_PATTERN_INTL = /\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/;
const PHONE_PATTERN_LOCAL = /\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/;

function hasPhoneNumber(pageText: string, links: HTMLElement[]): boolean {
    if (links.some(a => (a.getAttribute('href') ?? '').startsWith('tel:'))) return true;
    // Truncate to first 50 000 chars to avoid scanning enormous text blobs
    const sample = pageText.length > 50_000 ? pageText.slice(0, 50_000) : pageText;
    return PHONE_PATTERN_INTL.test(sample) || PHONE_PATTERN_LOCAL.test(sample);
}

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const LocalModule: AuditModule = {
    id: 'local-seo',
    label: 'Local SEO',

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        const items: ChecklistItem[] = [];

        // ── 1. Resolve HTML ────────────────────────────────────────────────
        const html = context.html;

        if (!html) {
            return {
                id: LocalModule.id,
                label: LocalModule.label,
                items,
                score: 0,
                passed: 0,
                failed: 1,
                warnings: 0,
            };
        }

        // Guard against pathologically large payloads
        if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
            throw new Error(
                `HTML payload for ${context.url} exceeds the ${MAX_HTML_BYTES / (1024 * 1024)} MB limit.`
            );
        }

        const root = parse(html);

        // Collect links once; reused by multiple checks
        const links = root.querySelectorAll('a[href]');

        // ── 2. Local directory / Google Business links ─────────────────────
        const directoryLinksFound = links.reduce((count, a) => {
            const href = a.getAttribute('href') ?? '';
            return count + (LOCAL_DIRECTORY_PATTERNS.some(pattern => href.includes(pattern)) ? 1 : 0);
        }, 0);

        items.push({
            id: 'local-directories',
            label: 'Local Directories & Google Business',
            status: directoryLinksFound > 0 ? 'Pass' : 'Warning',
            finding: directoryLinksFound > 0
                ? `Found ${directoryLinksFound} link${directoryLinksFound === 1 ? '' : 's'} to local directories or Google Maps.`
                : 'No links to local directories or Google Maps detected.',
            recommendation: directoryLinksFound > 0 ? undefined : {
                text: 'Create or claim a Google Business Profile and link to it from your site footer or contact page. Submit to Yelp, BBB, and other relevant directories for local visibility.',
                priority: 'High',
            },
            roiImpact: 90,
            aiVisibilityImpact: 85,
        });

        // ── 3. Map embed ───────────────────────────────────────────────────
        // NOTE: Map embeds typically live on /contact pages rather than the
        // homepage. A Warning here is expected for non-contact pages — filter
        // by audit URL before acting on this signal.
        const hasMapEmbed = root.querySelectorAll('iframe').some(iframe =>
            (iframe.getAttribute('src') ?? '').includes('google.com/maps/embed')
        );

        items.push({
            id: 'map-embed',
            label: 'Embedded Google Map',
            status: hasMapEmbed ? 'Pass' : 'Warning',
            finding: hasMapEmbed
                ? 'Google Maps embed found on this page.'
                : 'No Google Maps embed found on this page.',
            recommendation: hasMapEmbed ? undefined : {
                text: 'Embed a Google Map on your contact page to strengthen local trust signals and help Google associate your address with your domain.',
                priority: 'Medium',
            },
            roiImpact: 50,
            aiVisibilityImpact: 60,
        });

        // ── 4. NAP schema & reviews ────────────────────────────────────────
        const schemaElements = root.querySelectorAll('script[type="application/ld+json"]');
        const { hasLocalBusinessSchema, hasValidNap, hasReviewSchema } = checkSchemas(schemaElements);

        items.push({
            id: 'nap-schema',
            label: 'NAP Consistency (Schema)',
            status: hasValidNap ? 'Pass' : 'Warning',
            finding: hasValidNap
                ? 'LocalBusiness schema with valid name, address, and telephone detected.'
                : hasLocalBusinessSchema
                    ? 'LocalBusiness schema found but is missing one or more required NAP fields (name, address, or telephone).'
                    : 'No LocalBusiness schema found.',
            recommendation: hasValidNap ? undefined : {
                text: hasLocalBusinessSchema
                    ? 'Your LocalBusiness schema exists but is missing name, address, or telephone. Add all three to satisfy NAP consistency checks used by Google and local directories.'
                    : 'Add LocalBusiness schema markup with your business name, full street address, and telephone number. This is one of the most impactful local SEO signals.',
                priority: 'High',
            },
            roiImpact: 80,
            aiVisibilityImpact: 95,
        });

        items.push({
            id: 'reviews-schema',
            label: 'Customer Reviews (Schema)',
            status: hasReviewSchema ? 'Pass' : 'Warning',
            finding: hasReviewSchema
                ? 'Review or AggregateRating schema detected.'
                : 'No aggregate rating or review structured data found.',
            recommendation: hasReviewSchema ? undefined : {
                text: 'Add AggregateRating schema to enable rich star-rating snippets in search results, significantly improving click-through rate for local businesses.',
                priority: 'Medium',
            },
            roiImpact: 85,
            aiVisibilityImpact: 70,
        });

        // ── 5. Phone number visibility ─────────────────────────────────────
        const pageText = root.querySelector('body')?.textContent ?? '';
        const phoneVisible = hasPhoneNumber(pageText, links);

        items.push({
            id: 'phone-visibility',
            label: 'Phone Number Visible',
            status: phoneVisible ? 'Pass' : 'Warning',
            finding: phoneVisible
                ? 'Phone number or tel: link detected on page.'
                : 'No phone number or tel: link found on page.',
            recommendation: phoneVisible ? undefined : {
                text: 'Display your phone number prominently (header and footer) with a clickable tel: link. This is a key NAP consistency signal for local SEO.',
                priority: 'Medium',
            },
            roiImpact: 70,
            aiVisibilityImpact: 65,
        });

        // ── 6. Score ───────────────────────────────────────────────────────
        const { score, passed, failed, warnings } = calculateScore(items);

        return {
            id: LocalModule.id,
            label: LocalModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        };
    },
};