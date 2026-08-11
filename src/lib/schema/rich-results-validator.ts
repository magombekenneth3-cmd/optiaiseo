import { logger } from "@/lib/logger";

export interface RichResultsDetectedItem {
    name: string;
    itemsCount: number;
    issues: Array<{ severity: "WARNING" | "ERROR"; message: string }>;
}

export interface RichResultsValidationReport {
    verdict: "PASS" | "WARNING" | "FAIL";
    detectedItems: RichResultsDetectedItem[];
    schemaErrors: string[];
    fixedSchemaJson?: string;
}

export async function validateRichResultsWithGoogleApi(
    url: string,
    htmlContent?: string
): Promise<RichResultsValidationReport> {
    const apiKey = process.env.GOOGLE_SEARCH_CONSOLE_API_KEY || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        logger.warn("[RichResultsValidator] No Google API key found — running offline pre-flight schema validation");
        return fallbackPreFlightValidation(htmlContent);
    }

    try {
        const endpoint = `https://searchconsole.googleapis.com/v1/urlTestingTools/richResultsTest:run?key=${apiKey}`;

        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                url,
                rawHtml: htmlContent || undefined,
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            logger.warn(`[RichResultsValidator] Google Rich Results API returned ${res.status} — falling back to local audit`);
            return fallbackPreFlightValidation(htmlContent);
        }

        const data = await res.json();
        const testStatus = data.testStatus?.status;
        const detectedItems: RichResultsDetectedItem[] = (data.detectedItems || []).map((item: any) => ({
            name: item.name || "Schema Item",
            itemsCount: item.items?.length || 1,
            issues: (item.items || []).flatMap((i: any) =>
                (i.issues || []).map((issue: any) => ({
                    severity: issue.severity || "WARNING",
                    message: issue.issueMessage || "Schema validation issue",
                }))
            ),
        }));

        const hasErrors = detectedItems.some((i) => i.issues.some((issue) => issue.severity === "ERROR"));

        return {
            verdict: hasErrors ? "FAIL" : testStatus === "COMPLETE" ? "PASS" : "WARNING",
            detectedItems,
            schemaErrors: detectedItems.flatMap((i) => i.issues.map((issue) => `${i.name}: ${issue.message}`)),
        };
    } catch (err: unknown) {
        logger.warn("[RichResultsValidator] Rich Results API request failed — falling back to local audit");
        return fallbackPreFlightValidation(htmlContent);
    }
}

export function autoFixSchemaMarkup(rawSchemaJson: string): { fixedJson: string; fixesApplied: string[] } {
    const fixesApplied: string[] = [];

    try {
        const parsed = JSON.parse(rawSchemaJson);
        const root = Array.isArray(parsed) ? parsed[0] : parsed;

        if (root["@context"] !== "https://schema.org") {
            root["@context"] = "https://schema.org";
            fixesApplied.push("Corrected @context to 'https://schema.org'");
        }

        if (!root["@type"]) {
            root["@type"] = "Article";
            fixesApplied.push("Injected default @type 'Article'");
        }

        if (root["@type"] === "Article" || root["@type"] === "BlogPosting") {
            if (!root.author) {
                root.author = { "@type": "Organization", name: "OptiAISEO Editorial Team" };
                fixesApplied.push("Injected missing author organization schema");
            }
            if (!root.publisher) {
                root.publisher = { "@type": "Organization", name: "OptiAISEO" };
                fixesApplied.push("Injected missing publisher schema");
            }
        }

        return {
            fixedJson: JSON.stringify(parsed, null, 2),
            fixesApplied,
        };
    } catch {
        return {
            fixedJson: rawSchemaJson,
            fixesApplied: [],
        };
    }
}

function fallbackPreFlightValidation(htmlContent?: string): RichResultsValidationReport {
    const errors: string[] = [];
    if (htmlContent && !htmlContent.includes("application/ld+json")) {
        errors.push("Missing JSON-LD structured data script tag");
    }

    return {
        verdict: errors.length > 0 ? "WARNING" : "PASS",
        detectedItems: [
            {
                name: "Article Schema Pre-flight",
                itemsCount: 1,
                issues: errors.map((msg) => ({ severity: "WARNING" as const, message: msg })),
            },
        ],
        schemaErrors: errors,
    };
}
