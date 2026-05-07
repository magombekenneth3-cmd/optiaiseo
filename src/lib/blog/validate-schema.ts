import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const ARTICLE_SCHEMA = {
    required: ["@context", "@type", "headline", "author"],
    properties: {
        "@context": "https://schema.org",
        "@type": ["Article", "BlogPosting"],
        headline: { maxLength: 110 },
        author: { required: ["@type", "name"] },
        datePublished: { format: "date-time" },
        dateModified: { format: "date-time" },
    },
};

function isIso8601(value: unknown): boolean {
    if (typeof value !== "string") return true;
    return !Number.isNaN(Date.parse(value));
}

function validateArticleSchema(parsed: unknown): string[] {
    if (typeof parsed !== "object" || parsed === null) return ["Root must be an object"];

    const obj = parsed as Record<string, unknown>;
    const errors: string[] = [];

    for (const req of ARTICLE_SCHEMA.required) {
        if (!(req in obj)) errors.push(`Missing required field: ${req}`);
    }

    if (obj["@context"] && obj["@context"] !== "https://schema.org") {
        errors.push(`@context must be "https://schema.org"`);
    }

    if (obj["@type"] && !["Article", "BlogPosting"].includes(obj["@type"] as string)) {
        errors.push(`@type must be "Article" or "BlogPosting"`);
    }

    if (typeof obj.headline === "string" && obj.headline.length > 110) {
        errors.push(`headline exceeds 110 characters (${obj.headline.length})`);
    }

    if (obj.author && typeof obj.author === "object") {
        const author = obj.author as Record<string, unknown>;
        if (!author["@type"] || !author.name) {
            errors.push("author must have @type and name");
        }
    }

    if (!isIso8601(obj.datePublished)) errors.push("datePublished must be ISO 8601");
    if (!isIso8601(obj.dateModified)) errors.push("dateModified must be ISO 8601");

    return errors;
}

/**
 * Synchronous, DB-free validation — use this when the Blog record does not yet
 * exist (e.g. during blog generation before the save step).
 */
export function validateSchemaOnly(schemaJson: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(schemaJson);
    } catch {
        logger.warn("[SchemaValidation] Malformed JSON — discarding");
        return false;
    }
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    const errors = validateArticleSchema(root);
    if (errors.length > 0) {
        logger.warn("[SchemaValidation] Invalid schema", { errors });
        return false;
    }
    return true;
}

/**
 * Async variant that also clears schemaMarkup on the Blog record when invalid.
 * Only call this when the blog already exists in the DB.
 */
export async function validateAndSaveSchema(blogId: string, schemaJson: string): Promise<boolean> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(schemaJson);
    } catch {
        logger.warn("[SchemaValidation] Malformed JSON — clearing schemaMarkup", { blogId });
        await prisma.blog.update({ where: { id: blogId }, data: { schemaMarkup: null } });
        return false;
    }

    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    const errors = validateArticleSchema(root);

    if (errors.length > 0) {
        logger.warn("[SchemaValidation] Invalid schema — clearing", { blogId, errors });
        await prisma.blog.update({ where: { id: blogId }, data: { schemaMarkup: null } });
        return false;
    }

    return true;
}
