import { logger, formatError } from "@/lib/logger";
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

function isArticleTyped(node: unknown): node is Record<string, unknown> {
    if (typeof node !== "object" || node === null) return false;
    const type = (node as Record<string, unknown>)["@type"];
    if (Array.isArray(type)) return type.some(t => t === "Article" || t === "BlogPosting");
    return type === "Article" || type === "BlogPosting";
}

function locateArticleNode(parsed: unknown): Record<string, unknown> | null {
    if (Array.isArray(parsed)) {
        const typed = parsed.find(isArticleTyped);
        if (typed) return typed;
        return typeof parsed[0] === "object" && parsed[0] !== null
            ? parsed[0] as Record<string, unknown>
            : null;
    }

    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;

    if (Array.isArray(obj["@graph"])) {
        const graph = obj["@graph"] as unknown[];
        const typed = graph.find(isArticleTyped);
        return typed ?? null;
    }

    return obj;
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

export function validateSchemaOnly(schemaJson: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(schemaJson);
    } catch {
        logger.warn("[SchemaValidation] Malformed JSON — discarding");
        return false;
    }

    const articleNode = locateArticleNode(parsed);
    const errors = validateArticleSchema(articleNode);
    if (errors.length > 0) {
        logger.warn("[SchemaValidation] Invalid schema", { errors });
        return false;
    }
    return true;
}

export async function validateAndSaveSchema(blogId: string, schemaJson: string): Promise<boolean> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(schemaJson);
    } catch {
        logger.warn("[SchemaValidation] Malformed JSON — clearing schemaMarkup", { blogId });
        await prisma.blog.update({ where: { id: blogId }, data: { schemaMarkup: null } });
        return false;
    }

    const articleNode = locateArticleNode(parsed);

    if (articleNode) {
        try {
            const blog = await prisma.blog.findUnique({
                where: { id: blogId },
                select: { publishedAt: true, updatedAt: true, createdAt: true },
            });

            if (!blog) {
                logger.warn("[SchemaValidation] Blog record not found — skipping schema save", { blogId });
                return false;
            }

            if (!blog.publishedAt) {
                logger.warn("[SchemaValidation] Blog has no publishedAt yet — using createdAt for datePublished", { blogId });
            }

            articleNode.datePublished = (blog.publishedAt ?? blog.createdAt).toISOString();
            articleNode.dateModified = blog.updatedAt.toISOString();
        } catch (err: unknown) {
            logger.error("[SchemaValidation] Failed to load blog lifecycle timestamps", { blogId, error: formatError(err) });
            return false;
        }
    }

    const errors = validateArticleSchema(articleNode);

    if (errors.length > 0) {
        logger.warn("[SchemaValidation] Invalid schema — clearing", { blogId, errors });
        await prisma.blog.update({ where: { id: blogId }, data: { schemaMarkup: null } });
        return false;
    }

    await prisma.blog.update({
        where: { id: blogId },
        data: { schemaMarkup: JSON.stringify(parsed) },
    });

    return true;
}