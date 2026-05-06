/**
 * schema-completeness.ts — Phase 2.3
 *
 * Scores how complete a detected schema type is against required property lists.
 * Used by SchemaModule to report actual completeness % instead of just presence.
 */

// ─── Required properties per schema type ─────────────────────────────────────

const REQUIRED_PROPS: Record<string, string[]> = {
    Article: ["headline", "author", "datePublished", "dateModified", "image"],
    BlogPosting: ["headline", "author", "datePublished", "dateModified"],
    NewsArticle: ["headline", "author", "datePublished", "image"],
    Product: ["name", "description", "offers", "image"],
    LocalBusiness: ["name", "address", "telephone"],
    Restaurant: ["name", "address", "telephone", "servesCuisine"],
    FAQPage: ["mainEntity"],
    HowTo: ["name", "step"],
    Recipe: ["name", "recipeIngredient", "recipeInstructions", "image"],
    Event: ["name", "startDate", "location"],
    JobPosting: ["title", "description", "datePosted", "hiringOrganization"],
    Review: ["itemReviewed", "reviewRating", "author"],
    Person: ["name"],
    Organization: ["name", "url"],
    WebSite: ["name", "url"],
    WebPage: ["name", "url"],
    BreadcrumbList: ["itemListElement"],
    VideoObject: ["name", "description", "thumbnailUrl", "uploadDate"],
    ImageObject: ["contentUrl", "width", "height"],
    Dataset: ["name", "description"],
    Course: ["name", "description", "provider"],
    SoftwareApplication: ["name", "applicationCategory", "operatingSystem"],
    MedicalCondition: ["name"],
    Drug: ["name", "nonProprietaryName"],
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SchemaCompletenessResult {
    schemaType: string;
    score: number;         // 0–100
    present: string[];     // required props found
    missing: string[];     // required props absent
    isComplete: boolean;   // score === 100
}

/**
 * Scores a parsed schema object against the required property list for its type.
 * Returns 100 if the type is unknown (no required props to check).
 */
export function scoreSchemaCompleteness(
    schemaType: string,
    schemaObj: Record<string, unknown>,
): SchemaCompletenessResult {
    const required = REQUIRED_PROPS[schemaType];
    if (!required || required.length === 0) {
        return {
            schemaType,
            score: 100,
            present: [],
            missing: [],
            isComplete: true,
        };
    }

    const present: string[] = [];
    const missing: string[] = [];

    for (const prop of required) {
        const val = schemaObj[prop];
        const hasValue =
            val !== undefined &&
            val !== null &&
            val !== "" &&
            !(Array.isArray(val) && val.length === 0);

        if (hasValue) {
            present.push(prop);
        } else {
            missing.push(prop);
        }
    }

    const score = Math.round((present.length / required.length) * 100);

    return {
        schemaType,
        score,
        present,
        missing,
        isComplete: missing.length === 0,
    };
}

/**
 * Parses all JSON-LD blocks from HTML and returns completeness results.
 */
export function analyzeSchemaCompleteness(
    html: string,
): SchemaCompletenessResult[] {
    const results: SchemaCompletenessResult[] = [];
    const ldJsonRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match: RegExpExecArray | null;
    while ((match = ldJsonRegex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1]) as Record<string, unknown> | Record<string, unknown>[];
            const schemas = Array.isArray(parsed)
                ? parsed
                : parsed["@graph"]
                    ? (parsed["@graph"] as Record<string, unknown>[])
                    : [parsed];

            for (const schema of schemas) {
                const type = String(schema["@type"] ?? "");
                if (type) {
                    results.push(scoreSchemaCompleteness(type, schema));
                }
            }
        } catch {
            // Malformed JSON — skip
        }
    }

    return results;
}
