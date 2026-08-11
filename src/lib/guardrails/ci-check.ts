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
        errors.push(`CORE WEB VITALS REGRESSION: Estimated LCP (${estimatedLcpMs}ms) exceeds threshold (${maxLcp}ms)`);
    }

    const estimatedCls = html.includes("width=") && html.includes("height=") ? 0.02 : 0.15;
    const maxCls = target.maxCls ?? 0.10;

    if (estimatedCls > maxCls) {
        warnings.push(`CORE WEB VITALS WARN: Estimated CLS (${estimatedCls}) exceeds target (${maxCls})`);
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

if (require.main === module) {
    const targetUrl = process.argv[2] || process.env.DEPLOYMENT_URL || "https://optiaiseo.online";
    runSeoGuardrailCheck({ url: targetUrl }).then(res => {
        if (!res.passed) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    }).catch(() => process.exit(1));
}
