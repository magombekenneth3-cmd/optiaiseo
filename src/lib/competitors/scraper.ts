// =============================================================================
// Competitor detection engine — multi-page scraper
// Fetches homepage + service-specific pages and returns structured signal text.
// =============================================================================

const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_COMBINED_CHARS = 8_000;

/** Pages probed for service context, in priority order. */
const SERVICE_PATHS = ["", "/services", "/products", "/solutions", "/about", "/offerings", "/pricing"];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches the homepage and up to 2 service-specific sub-pages, returning
 * combined signal text capped at 8 000 chars.
 *
 * Richer, service-focused input → Claude identifies what the site SELLS,
 * not just what it mentions.
 */
export async function fetchSiteServicesText(
    domain: string,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
    const segments: string[] = [];
    let collected = 0;
    let pagesHit = 0;

    for (const path of SERVICE_PATHS) {
        if (collected >= MAX_COMBINED_CHARS || pagesHit >= 3) break;
        const text = await fetchPageText(`https://${domain}${path}`, timeoutMs);
        if (text && text.length > 50) {
            const room  = MAX_COMBINED_CHARS - collected;
            const slice = text.slice(0, room);
            segments.push(path ? `[Page: ${path}]\n${slice}` : slice);
            collected += slice.length;
            pagesHit++;
        }
    }

    return segments.join("\n\n");
}

/**
 * Original single-page homepage scraper — kept for backward compatibility.
 */
export async function fetchSiteText(
    domain: string,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
    return (
        (await fetchPageText(`https://${domain}`, timeoutMs)) ??
        (await fetchPageText(`http://${domain}`, timeoutMs)) ??
        ""
    );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchPageText(url: string, timeoutMs: number): Promise<string> {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept":
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            redirect: "follow",
        });

        if (!res.ok) return "";
        if (!(res.headers.get("content-type") ?? "").includes("text/html")) return "";
        return extractSignalText(await res.text());
    } catch {
        return "";
    }
}

// ---------------------------------------------------------------------------
// HTML signal extractor — no DOM parser dependency
// ---------------------------------------------------------------------------

function extractSignalText(html: string): string {
    // Strip script/style blocks first
    const stripped = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");

    const segments: string[] = [];

    // 1. Page title
    const title = stripped.match(/<title[^>]*>([^<]{3,120})<\/title>/i)?.[1]?.trim();
    if (title) segments.push(title);

    // 2. Meta / OG description — prefer OG if longer
    const metaDesc = stripped.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})["']/i
    )?.[1]?.trim();
    const ogDesc = stripped.match(
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,400})["']/i
    )?.[1]?.trim();
    const desc = (ogDesc?.length ?? 0) > (metaDesc?.length ?? 0) ? ogDesc : metaDesc;
    if (desc) segments.push(desc);

    // 3. Nav links that hint at service categories
    const serviceNavPattern =
        /\/(services?|products?|pricing|solutions?|plans?|packages?|offerings?|features?|capabilities)/i;

    const navLabels = [...stripped.matchAll(
        /<a[^>]+href=["']([^"'#?]{1,200})["'][^>]*>([\s\S]{2,80}?)<\/a>/gi
    )]
        .filter((m) => serviceNavPattern.test(m[1]))
        .map((m) => m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
        .filter((t) => t.length > 1 && t.length < 60)
        .slice(0, 10);

    if (navLabels.length > 0) segments.push(`Nav: ${navLabels.join(", ")}`);

    // 4. H1–H3 headings
    const headings = [...stripped.matchAll(/<h[123][^>]*>([\s\S]{5,150}?)<\/h[123]>/gi)]
        .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
        .filter((h) => h.length > 4)
        .slice(0, 12);

    if (headings.length > 0) segments.push(headings.join(" | "));

    // 5. First visible paragraphs
    const paragraphs = [...stripped.matchAll(/<p[^>]*>([\s\S]{20,400}?)<\/p>/gi)]
        .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
        .filter((p) => p.length > 20)
        .slice(0, 8);

    if (paragraphs.length > 0) segments.push(paragraphs.join(" "));

    return segments.filter(Boolean).join("\n");
}
