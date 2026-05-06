

const ALLOWED_PROTOCOLS = ["http:", "https:"];

const PRIVATE_IP_RE = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
    /^localhost$/i,
    /\.internal$/i,
    /\.local$/i,
];

export function isSafeUrl(raw: string): { ok: boolean; url?: URL; error?: string } {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return { ok: false, error: "Invalid URL format" };
    }
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
        return { ok: false, error: "Only http/https URLs are allowed" };
    }
    if (PRIVATE_IP_RE.some((re) => re.test(parsed.hostname))) {
        return { ok: false, error: "Private/internal hostnames are not allowed" };
    }
    return { ok: true, url: parsed };
}
