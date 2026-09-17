import { createHash } from "node:crypto";

export interface BacklinkIdentityInput {
    sourceUrl: string;
    targetUrl: string;
    anchorText: string;
    srcDomain: string;
}

/**
 * Stable identity for an individual backlink. Source URL is intentionally part
 * of the key: a referring domain can link to the same target with the same
 * anchor from multiple pages.
 */
export function createBacklinkLinkKey(input: BacklinkIdentityInput): string {
    const source = input.sourceUrl.trim().toLowerCase() || input.srcDomain.trim().toLowerCase();
    const target = input.targetUrl.trim().toLowerCase();
    const anchor = input.anchorText.trim().toLowerCase();
    return createHash("sha256")
        .update(`${source}\u0000${target}\u0000${anchor}`)
        .digest("hex");
}
