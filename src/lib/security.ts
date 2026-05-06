import { isIP } from "net";

/**
 * Validates a domain to prevent Server-Side Request Forgery (SSRF) vulnerabilities.
 * Explicitly blocks:
 * 1. Direct IP addresses (both IPv4 and IPv6, including 169.254.169.254 metadata endpoint)
 * 2. localhost
 * 3. .local and .internal generic top-level domains
 * 4. Invalid domain formats
 */
export function isValidPublicDomain(domain: string): boolean {
    if (!domain || typeof domain !== "string") return false;

    const lower = domain.trim().toLowerCase();

    // 1. Block localhost and internal TLDs
    if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) {
        return false;
    }

    // 2. Block direct IP addresses (e.g., 127.0.0.1, 169.254.169.254, ::1)
    if (isIP(lower)) {
        return false;
    }

    // 3. Ensure it looks broadly like a valid public domain (contains a dot, standard chars)
    // Basic regex: alphanumeric parts separated by dots, final part is at least 2 chars
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;
    if (!domainRegex.test(lower)) {
        return false;
    }

    return true;
}
