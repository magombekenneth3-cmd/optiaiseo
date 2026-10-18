import { parse } from "node-html-parser";

export interface GuardrailTarget {
    url: string;
    maxLcpMs?: number;
    maxInpMs?: number;
    maxCls?: number;
}

export interface GuardrailCheckResult {
    url: string;
    passed: boolean;
    errors: string[];
    warnings: string[];
    metrics: {
        title: string | null;
        metaDescription: string | null;
        canonical: string | null;
        hasOgTitle: boolean;
        hasOgImage: boolean;
        isNoIndex: boolean;
        estimatedLcpMs: number;
        estimatedCls: number;
    };
    rollbackPrPayload?: {
        branch: string;
        title: string;
        body: string;
        filesToRevert: string[];
    };
}

export async function runSeoGuardrailCheck(target: GuardrailTarget): Promise<GuardrailCheckResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const startTime = Date.now();

    // FIX #3: Validate target URL against allowlist to prevent auditing
    // non-application URLs (e.g. Railway dashboard, Vercel admin panel)
    const ALLOWED_ORIGINS = [
        "optiaiseo.online",
        "www.optiaiseo.online",
        "localhost",
        "127.0.0.1",
    ];
    try {
        const parsed = new URL(target.url);
        const hostname = parsed.hostname.toLowerCase();
        if (!ALLOWED_ORIGINS.some(origin => hostname === origin || hostname.endsWith(`.${origin}`))) {
            errors.push(`GUARDRAIL CONFIG ERROR: Target URL hostname "${hostname}" is not in the allowed origins list. This may be a CI misconfiguration (e.g. Railway dashboard URL leaking into environment_url).`);
            return {
                url: target.url,
                passed: false,
                errors,
                warnings,
                metrics: {
                    title: null, metaDescription: null, canonical: null,
                    hasOgTitle: false, hasOgImage: false, isNoIndex: true,
                    estimatedLcpMs: 0, estimatedCls: 0,
                },
            };
        }
    } catch {
        errors.push(`GUARDRAIL CONFIG ERROR: Target URL "${target.url}" is not a valid URL.`);
        return {
            url: target.url,
            passed: false,
            errors,
            warnings,
            metrics: {
                title: null, metaDescription: null, canonical: null,
                hasOgTitle: false, hasOgImage: false, isNoIndex: true,
                estimatedLcpMs: 0, estimatedCls: 0,
            },
        };
    }

    let html = "";
    try {
        const res = await fetch(target.url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
            errors.push(`HTTP status error: ${res.status} ${res.statusText}`);
        }
        html = await res.text();
    } catch (err: unknown) {
        errors.push(`Network fetch failed: ${(err as Error)?.message || String(err)}`);
        return {
            url: target.url,
            passed: false,
            errors,
            warnings,
            metrics: {
                title: null,
                metaDescription: null,
                canonical: null,
                hasOgTitle: false,
                hasOgImage: false,
                isNoIndex: true,
                estimatedLcpMs: 9999,
                estimatedCls: 1.0,
            },
        };
    }

    const ttfbMs = Date.now() - startTime;
    const root = parse(html);

    const title = root.querySelector("title")?.textContent.trim() || null;
    const metaDescription = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || null;
    const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() || null;
    const ogTitle = root.querySelector('meta[property="og:title"]');
    const ogImage = root.querySelector('meta[property="og:image"]');
    const robotsMeta = root.querySelector('meta[name="robots"]')?.getAttribute("content")?.toLowerCase() || "";

    const isNoIndex = robotsMeta.includes("noindex");

    if (!title) {
        errors.push("CRITICAL: Missing <title> tag on deployment");
    } else if (title.length < 20 || title.length > 70) {
        warnings.push(`Title length (${title.length} chars) is outside optimal 20-70 range`);
    }

    if (!metaDescription) {
        errors.push("CRITICAL: Missing <meta name=\"description\"> tag");
    }

    if (!canonical) {
        errors.push("CRITICAL: Missing <link rel=\"canonical\"> tag");
    }

    if (isNoIndex) {
        errors.push("CRITICAL: Page contains 'noindex' robots meta tag on production route!");
    }

    if (!ogTitle) warnings.push("Missing og:title meta tag");
    if (!ogImage) warnings.push("Missing og:image meta tag");

    const estimatedLcpMs = Math.round(ttfbMs + 450);
    const maxLcp = target.maxLcpMs ?? 2500;

    if (estimatedLcpMs > maxLcp) {
        // FIX #3: Label as server-side estimate, not actual CWV measurement.
        // Real LCP requires a browser environment (Chrome DevTools, CrUX, etc.).
        errors.push(`SEO ESTIMATE: Server-side estimated LCP (TTFB + 450ms = ${estimatedLcpMs}ms) exceeds threshold (${maxLcp}ms). Note: this is a heuristic, not a real Core Web Vitals measurement.`);
    }

    const estimatedCls = html.includes("width=") && html.includes("height=") ? 0.02 : 0.15;
    const maxCls = target.maxCls ?? 0.10;

    if (estimatedCls > maxCls) {
        // FIX #3: Label as heuristic, not actual CLS measurement.
        warnings.push(`SEO ESTIMATE: Heuristic CLS (${estimatedCls}) exceeds target (${maxCls}). Based on presence of width/height attributes, not real layout shift measurement.`);
    }

    const passed = errors.length === 0;

    let rollbackPrPayload;
    if (!passed) {
        rollbackPrPayload = {
            branch: `rollback-seo-guardrail-${Date.now()}`,
            title: `[AUTONOMOUS ROLLBACK] Revert deployment breaking SEO/CWV on ${new URL(target.url).pathname}`,
            body: `Automated Technical Guardrails caught critical SEO/CWV regressions:\n\n${errors.map(e => `- ❌ ${e}`).join("\n")}\n\nStaging automatic rollback PR.`,
            filesToRevert: ["src/app/layout.tsx", "src/app/page.tsx"],
        };
    }

    return {
        url: target.url,
        passed,
        errors,
        warnings,
        metrics: {
            title,
            metaDescription,
            canonical,
            hasOgTitle: !!ogTitle,
            hasOgImage: !!ogImage,
            isNoIndex,
            estimatedLcpMs,
            estimatedCls,
        },
        rollbackPrPayload,
    };
}

export function formatGuardrailReport(res: GuardrailCheckResult): string {
    const lines: string[] = [];
    lines.push("════════════════════════════════════════════════════════════");
    lines.push(" OptiAISEO SEO / Core Web Vitals Guardrail Report");
    lines.push("════════════════════════════════════════════════════════════");
    lines.push(` URL:    ${res.url}`);
    lines.push(` Result: ${res.passed ? "PASS ✅" : "FAIL ❌"}`);
    lines.push("");
    lines.push(` Errors (${res.errors.length}):`);
    if (res.errors.length === 0) lines.push("   (none)");
    for (const e of res.errors) lines.push(`   ❌ ${e}`);
    lines.push("");
    lines.push(` Warnings (${res.warnings.length}):`);
    if (res.warnings.length === 0) lines.push("   (none)");
    for (const w of res.warnings) lines.push(`   ⚠️  ${w}`);
    lines.push("");
    lines.push(" Metrics:");
    lines.push(`   title:           ${res.metrics.title ?? "(missing)"}`);
    lines.push(`   metaDescription: ${res.metrics.metaDescription ?? "(missing)"}`);
    lines.push(`   canonical:       ${res.metrics.canonical ?? "(missing)"}`);
    lines.push(`   og:title:        ${res.metrics.hasOgTitle ? "present" : "missing"}`);
    lines.push(`   og:image:        ${res.metrics.hasOgImage ? "present" : "missing"}`);
    lines.push(`   noindex:         ${res.metrics.isNoIndex}`);
    lines.push(`   estimatedLcpMs:  ${res.metrics.estimatedLcpMs}`);
    lines.push(`   estimatedCls:    ${res.metrics.estimatedCls}`);
    lines.push("════════════════════════════════════════════════════════════");
    return lines.join("\n");
}

// CLI entry. Uses argv-based detection rather than `require.main === module`,
// which throws a ReferenceError when tsx loads this file as an ES module.
const isCliEntry =
    typeof process !== "undefined" &&
    Array.isArray(process.argv) &&
    typeof process.argv[1] === "string" &&
    /guardrails[\\/]ci-check\.(ts|js|mjs|cjs)$/.test(process.argv[1]);

if (isCliEntry) {
    const targetUrl = process.argv[2] || process.env.DEPLOYMENT_URL || "https://optiaiseo.online";
    runSeoGuardrailCheck({ url: targetUrl })
        .then((res) => {
            const report = formatGuardrailReport(res);
            if (res.passed) {
                console.log(report);
                process.exit(0);
            } else {
                console.error(report);
                process.exit(1);
            }
        })
        .catch((err: unknown) => {
            console.error(`Guardrail check crashed for ${targetUrl}:`);
            console.error(err instanceof Error ? err.stack ?? err.message : String(err));
            process.exit(1);
        });
}
