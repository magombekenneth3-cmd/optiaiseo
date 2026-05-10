import { logger } from "@/lib/logger";
// AuditResult inline type (avoids importing from ./index which doesn't export it)
type AuditIssue = {
    category: string;
    title: string;
    severity: "error" | "warning" | "info";
    impact: "HIGH" | "MEDIUM" | "LOW";
    description: string;
    fixSuggestion?: string;
};

/**
 * Runs a security audit by analyzing HTTP headers, SSL configuration,
 * and checking against Google Safe Browsing.
 */
export async function runSecurityAudit(domain: string): Promise<AuditIssue[]> {
    logger.debug(`[Security Audit] Starting scan for ${domain}...`);
    const issues: AuditIssue[] = [];
    let urlStr = domain.trim();
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
        urlStr = `https://${urlStr}`;
    }

    try {
        // SSRF guard: follow redirects manually so we can re-validate every hop's hostname.
        // redirect:'follow' would bypass isValidPublicDomain on the final destination.
        let fetchUrl = urlStr;
        // FIX: declare `res` with `let` before the loop so TypeScript's control-flow
        // analysis can prove it is always assigned before use. The previous `var res`
        // inside the loop body was function-scoped but could be undefined if the server
        // returned a redirect with no Location header, and the `if (!res!)` guard
        // silently swallowed that case without logging.
        let res: Response | undefined;
        for (let hop = 0; hop < 5; hop++) {
            const hopRes = await fetch(fetchUrl, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
            if (hopRes.status >= 300 && hopRes.status < 400) {
                const location = hopRes.headers.get('location');
                if (!location) break;
                const { hostname } = new URL(location, fetchUrl);
                const { isValidPublicDomain: isValid } = await import('@/lib/security');
                if (!isValid(hostname)) {
                    logger.warn(`[Security Audit] Blocked redirect to private host: ${hostname}`);
                    return issues; // abort — treat as unreachable
                }
                fetchUrl = new URL(location, fetchUrl).href;
                continue;
            }
            // Non-redirect: use this response for header checks
            res = hopRes;
            break;
        }
        if (!res) {
            logger.warn(`[Security Audit] No successful HTTP response after following redirects for ${domain}`);
            return issues;
        }
        const headers = res.headers;

        const checkHeader = (
            headerName: string,
            issueTitle: string,
            issueDesc: string,
            severity: "error" | "warning" | "info",
            impact: "HIGH" | "MEDIUM" | "LOW",
            recommendation: string
        ) => {
            const val = headers.get(headerName) || headers.get(headerName.toLowerCase());
            if (!val) {
                issues.push({
                    category: "BEST_PRACTICES",
                    title: issueTitle,
                    severity,
                    impact,
                    description: issueDesc,
                    fixSuggestion: recommendation,
                });
            }
        };

        checkHeader("Strict-Transport-Security", "Missing HSTS Header", "HTTP Strict Transport Security (HSTS) ensures browsers only connect over HTTPS.", "error", "HIGH", "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains' to your server headers.");
        checkHeader("Content-Security-Policy", "Missing CSP Header", "Content Security Policy helps prevent XSS and data injection attacks.", "warning", "HIGH", "Implement a basic CSP header like 'Content-Security-Policy: default-src \\'self\\' <other-sources>;'.");
        checkHeader("X-Frame-Options", "Missing X-Frame-Options", "Prevents clickjacking by restricting how your site can be embedded in iframes.", "warning", "MEDIUM", "Add 'X-Frame-Options: SAMEORIGIN' or 'DENY'.");
        checkHeader("X-Content-Type-Options", "Missing X-Content-Type-Options", "Prevents MIME-sniffing, ensuring browsers respect the declared content type.", "warning", "LOW", "Add 'X-Content-Type-Options: nosniff'.");

        const safeBrowsingKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
        if (safeBrowsingKey) {
            try {
                const sbRes = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${safeBrowsingKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        client: { clientId: "seo-tool", clientVersion: "1.0.0" },
                        threatInfo: {
                            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
                            platformTypes: ["ANY_PLATFORM"],
                            threatEntryTypes: ["URL"],
                            threatEntries: [{ url: urlStr }]
                        }
                    })
                });

                if (sbRes.ok) {
                    const sbData = await sbRes.json();
                    if (sbData && sbData.matches && sbData.matches.length > 0) {
                        issues.push({
                            category: "BEST_PRACTICES",
                            title: "Domain Flagged as Unsafe",
                            severity: "error",
                            impact: "HIGH",
                            description: "Google Safe Browsing flagged this domain for malware, phishing, or unwanted software.",
                            fixSuggestion: "Review Google Search Console for security issues, clean your site, and request a review.",
                        });
                    }
                }
             
             
            } catch (err: unknown) {
                logger.error("[Security Audit] Google Safe Browsing check failed:", { error: (err as Error)?.message || String(err) });
            }
        }

        // SSL Labs API can be slow as it triggers a new scan. We use the 'fromCache=on' param first.
        try {
            const parsedUrl = new URL(urlStr);
            const hostname = parsedUrl.hostname;
            // Free API, no key required
            const sslRes = await fetch(`https://api.ssllabs.com/api/v3/analyze?host=${hostname}&fromCache=on&maxAge=24`, {
                signal: AbortSignal.timeout(15000)
            });

            if (sslRes.ok) {
                const sslData = await sslRes.json();
                if (sslData.status === "READY" && sslData.endpoints && sslData.endpoints.length > 0) {
                    const endpoint = sslData.endpoints[0];
                    const grade = endpoint.grade;
                    if (grade && ['B', 'C', 'D', 'E', 'F', 'T', 'M'].includes(grade)) {
                        issues.push({
                            category: "BEST_PRACTICES",
                            title: `Weak SSL Configuration (Grade ${grade})`,
                            severity: grade === 'B' ? "warning" : "error",
                            impact: "HIGH",
                            description: `Qualys SSL Labs rated your SSL configuration a '${grade}'.` + (endpoint.gradeTrustIgnored ? " Trust is ignored (certificate might be expired or untrusted)." : ""),
                            fixSuggestion: `Review detailed SSL Labs report at https://www.ssllabs.com/ssltest/analyze.html?d=${hostname} and upgrade your cipher suites or protocol versions.`,
                        });
                    }
                }
             
            }
         
        } catch (err: unknown) {
            logger.error("[Security Audit] SSL Labs check failed:", { error: (err as Error)?.message || String(err) });
         
        }

     
    } catch (error: unknown) {
        logger.error(`[Security Audit] Failed connecting to ${domain}:`, { error: (error as Error)?.message || String(error) });
        issues.push({
            category: "BEST_PRACTICES",
            title: "Security Scan Connection Failed",
            severity: "warning",
            impact: "LOW",
            description: "Could not connect to the domain to verify HTTP Security headers.",
            fixSuggestion: "Ensure the domain is publicly accessible and responsive.",
        });
    }

    return issues;
}
