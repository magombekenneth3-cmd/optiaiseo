import { parse, HTMLElement } from "node-html-parser";
import { logger } from "@/lib/logger";
import { autoFixSchemaMarkup } from "@/lib/schema/rich-results-validator";

export interface AutoFixOptions {
    fixAltText?: boolean;
    fixCanonical?: boolean;
    fix404s?: boolean;
    fixOgMetadata?: boolean;
    fixHeadingHierarchy?: boolean;
    fixSchemaMarkup?: boolean;
}

export interface AppliedFix {
    type: "ALT_TEXT" | "CANONICAL" | "REDIRECT_404" | "OPEN_GRAPH" | "HEADING_HIERARCHY" | "SCHEMA_VALIDATION";
    description: string;
}

export interface AutoFixResult {
    fixedHtml: string;
    changes: AppliedFix[];
}

export function performOneClickAutoFix(
    rawHtml: string,
    targetUrl: string,
    options: AutoFixOptions = {
        fixAltText: true,
        fixCanonical: true,
        fix404s: true,
        fixOgMetadata: true,
        fixHeadingHierarchy: true,
    }
): AutoFixResult {
    const root = parse(rawHtml);
    const changes: AppliedFix[] = [];

    if (options.fixAltText) {
        fixAltTexts(root, changes);
    }

    if (options.fixCanonical) {
        fixCanonicalTag(root, targetUrl, changes);
    }

    if (options.fixOgMetadata) {
        fixOpenGraphMetadata(root, targetUrl, changes);
    }

    if (options.fixHeadingHierarchy) {
        fixHeadingHierarchy(root, changes);
    }

    if (options.fix404s) {
        fixBrokenLinks(root, targetUrl, changes);
    }

    if (options.fixSchemaMarkup !== false) {
        fixSchemaScriptTags(root, changes);
    }

    logger.info("[AutoFix Engine] Successfully performed one-click auto-fix", {
        targetUrl,
        totalFixes: changes.length,
    });

    return {
        fixedHtml: root.toString(),
        changes,
    };
}

function fixAltTexts(root: HTMLElement, changes: AppliedFix[]) {
    const images = root.querySelectorAll("img");
    let count = 0;

    images.forEach((img) => {
        const currentAlt = img.getAttribute("alt");
        if (!currentAlt || currentAlt.trim() === "") {
            const src = img.getAttribute("src") || "";
            const filename = src.split("/").pop()?.split("?")[0]?.replace(/[-_]/g, " ") || "illustration";
            const inferredAlt = `Image depicting ${filename}`;
            img.setAttribute("alt", inferredAlt);
            count++;
        }
    });

    if (count > 0) {
        changes.push({
            type: "ALT_TEXT",
            description: `Generated and injected descriptive alt attributes for ${count} image(s)`,
        });
    }
}

function fixCanonicalTag(root: HTMLElement, targetUrl: string, changes: AppliedFix[]) {
    let head = root.querySelector("head");
    if (!head) {
        const html = root.querySelector("html");
        if (html) {
            head = parse("<head></head>").querySelector("head")!;
            html.appendChild(head);
        }
    }

    const canonicalTag = root.querySelector("link[rel='canonical']");
    if (!canonicalTag) {
        if (head) {
            const newCanonical = parse(`<link rel="canonical" href="${targetUrl}" />`);
            head.appendChild(newCanonical);
            changes.push({
                type: "CANONICAL",
                description: `Injected missing canonical tag with target URL: ${targetUrl}`,
            });
        }
    } else {
        const currentHref = canonicalTag.getAttribute("href");
        if (currentHref !== targetUrl) {
            canonicalTag.setAttribute("href", targetUrl);
            changes.push({
                type: "CANONICAL",
                description: `Corrected canonical URL from '${currentHref}' to '${targetUrl}'`,
            });
        }
    }
}

function fixOpenGraphMetadata(root: HTMLElement, targetUrl: string, changes: AppliedFix[]) {
    let head = root.querySelector("head");
    if (!head) return;

    const pageTitle = root.querySelector("title")?.text || "OptiAISEO Optimized Page";
    const pageDesc = root.querySelector("meta[name='description']")?.getAttribute("content") || "Optimized web page content";

    const requiredOg: Record<string, string> = {
        "og:title": pageTitle,
        "og:description": pageDesc,
        "og:url": targetUrl,
        "og:type": "website",
    };

    let injectedCount = 0;
    Object.entries(requiredOg).forEach(([property, content]) => {
        const existing = head!.querySelector(`meta[property='${property}']`);
        if (!existing) {
            const metaTag = parse(`<meta property="${property}" content="${content}" />`);
            head!.appendChild(metaTag);
            injectedCount++;
        }
    });

    if (injectedCount > 0) {
        changes.push({
            type: "OPEN_GRAPH",
            description: `Injected ${injectedCount} missing OpenGraph metadata tags (og:title, og:description, og:url, og:type)`,
        });
    }
}

function fixHeadingHierarchy(root: HTMLElement, changes: AppliedFix[]) {
    const h1s = root.querySelectorAll("h1");
    if (h1s.length === 0) {
        const firstH2 = root.querySelector("h2");
        if (firstH2) {
            firstH2.tagName = "h1";
            changes.push({
                type: "HEADING_HIERARCHY",
                description: "Promoted orphan top heading from <h2> to <h1> to fix missing <h1> error",
            });
        }
    } else if (h1s.length > 1) {
        for (let i = 1; i < h1s.length; i++) {
            h1s[i].tagName = "h2";
        }
        changes.push({
            type: "HEADING_HIERARCHY",
            description: `Demoted ${h1s.length - 1} extra <h1> tags to <h2> to enforce single <h1> rule`,
        });
    }

    const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
    let currentLevel = 0;
    let gapsFixed = 0;

    headings.forEach((h) => {
        const level = parseInt(h.tagName.substring(1), 10);
        if (currentLevel > 0 && level > currentLevel + 1) {
            const newLevel = currentLevel + 1;
            h.tagName = `h${newLevel}`;
            gapsFixed++;
        }
        currentLevel = parseInt(h.tagName.substring(1), 10);
    });

    if (gapsFixed > 0) {
        changes.push({
            type: "HEADING_HIERARCHY",
            description: `Corrected ${gapsFixed} skipped heading level gaps for strict hierarchy adherence`,
        });
    }
}

function fixBrokenLinks(root: HTMLElement, targetUrl: string, changes: AppliedFix[]) {
    const links = root.querySelectorAll("a");
    let count = 0;

    links.forEach((a) => {
        const href = a.getAttribute("href");
        if (!href || href === "#" || href === "undefined" || href === "null") {
            a.setAttribute("href", targetUrl);
            count++;
        }
    });

    if (count > 0) {
        changes.push({
            type: "REDIRECT_404",
            description: `Fixed ${count} broken/empty anchor href tags by redirecting to canonical target URL`,
        });
    }
}

function fixSchemaScriptTags(root: HTMLElement, changes: AppliedFix[]) {
    const scripts = root.querySelectorAll("script[type='application/ld+json']");
    let totalFixes = 0;

    scripts.forEach((script) => {
        const rawJson = script.text;
        const { fixedJson, fixesApplied } = autoFixSchemaMarkup(rawJson);
        if (fixesApplied.length > 0) {
            script.set_content(fixedJson);
            totalFixes += fixesApplied.length;
        }
    });

    if (totalFixes > 0) {
        changes.push({
            type: "SCHEMA_VALIDATION",
            description: `Auto-corrected ${totalFixes} JSON-LD Schema.org pre-flight syntax and structural errors`,
        });
    }
}
