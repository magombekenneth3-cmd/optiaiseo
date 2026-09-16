#!/usr/bin/env npx tsx
/**
 * Crawler Load Test CLI Harness
 *
 * Usage:
 *   # Deterministic synthetic benchmark (recommended for CI/local)
 *   npx tsx scripts/run-crawl-load-test.ts --synthetic --pages 5000 --workers 10 --chunk 100
 *
 *   # Real-site smoke test (small scale only)
 *   npx tsx scripts/run-crawl-load-test.ts --domain example.com --pages 200 --workers 5
 *
 *   # With failure injection
 *   npx tsx scripts/run-crawl-load-test.ts --synthetic --pages 1000 --404-rate 5 --500-rate 3 --timeout-rate 2
 */

import { runCrawlLoadTest } from "../src/lib/crawler/load-test";
import type { LoadTestConfig } from "../src/lib/crawler/load-test";

// ─── Parse CLI args ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): LoadTestConfig {
    const args = argv.slice(2);

    function getFlag(name: string): boolean {
        return args.includes(`--${name}`);
    }

    function getValue(name: string, defaultVal: string): string {
        const idx = args.indexOf(`--${name}`);
        if (idx === -1 || idx + 1 >= args.length) return defaultVal;
        return args[idx + 1];
    }

    function getNumber(name: string, defaultVal: number): number {
        const val = getValue(name, String(defaultVal));
        const num = parseInt(val, 10);
        return isNaN(num) ? defaultVal : num;
    }

    const isSynthetic = getFlag("synthetic");
    const domain = isSynthetic ? "synthetic" : getValue("domain", "");

    if (!domain) {
        console.error("Error: specify --synthetic or --domain <domain>");
        console.error("");
        console.error("Examples:");
        console.error("  npx tsx scripts/run-crawl-load-test.ts --synthetic --pages 1000 --workers 10");
        console.error("  npx tsx scripts/run-crawl-load-test.ts --domain example.com --pages 200 --workers 5");
        process.exit(1);
    }

    return {
        targetDomain: domain,
        totalPages: getNumber("pages", 1000),
        workerPoolSize: getNumber("workers", 10),
        chunkSize: getNumber("chunk", 100),
        maxDepth: getNumber("depth", 4),
        jsRendering: "never",
        memoryLimitMb: getNumber("memory-limit", 512),
        syntheticServerPort: getNumber("port", 0),
        failureRate404: getNumber("404-rate", 0),
        failureRate500: getNumber("500-rate", 0),
        failureRateTimeout: getNumber("timeout-rate", 0),
        failureRateMalformed: getNumber("malformed-rate", 0),
        linksPerPage: getNumber("links", 5),
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
    const config = parseArgs(process.argv);

    console.log("\n┌──────────────────────────────────────────┐");
    console.log("│  Crawler Load Test                       │");
    console.log("└──────────────────────────────────────────┘\n");

    console.log("Configuration:");
    console.log(`  Target:     ${config.targetDomain}`);
    console.log(`  Pages:      ${config.totalPages}`);
    console.log(`  Workers:    ${config.workerPoolSize}`);
    console.log(`  Chunk size: ${config.chunkSize}`);
    console.log(`  Max depth:  ${config.maxDepth}`);
    console.log(`  Mem limit:  ${config.memoryLimitMb}MB`);

    if (config.targetDomain === "synthetic") {
        console.log(`  Failure injection:`);
        console.log(`    404s:      ${config.failureRate404 ?? 0}%`);
        console.log(`    500s:      ${config.failureRate500 ?? 0}%`);
        console.log(`    Timeouts:  ${config.failureRateTimeout ?? 0}%`);
        console.log(`    Malformed: ${config.failureRateMalformed ?? 0}%`);
        console.log(`    Links/page: ${config.linksPerPage ?? 5}`);
    }

    console.log("\nRunning...\n");

    const startTime = Date.now();
    const result = await runCrawlLoadTest(config);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n\n┌──────────────────────────────────────────┐");
    console.log("│  Results                                 │");
    console.log("└──────────────────────────────────────────┘\n");

    console.log(`  Duration:              ${elapsed}s`);
    console.log(`  Pages attempted:       ${result.totalPagesAttempted}`);
    console.log(`  Pages successful:      ${result.totalPagesSuccessful}`);
    console.log(`  Pages failed:          ${result.totalPagesFailed}`);
    console.log(`  Throughput:            ${result.throughput} pages/s`);
    console.log(`  Chunks processed:      ${result.chunksProcessed}`);
    console.log("");
    console.log(`  Avg latency:           ${result.avgPageLatencyMs}ms`);
    console.log(`  P50 latency:           ${result.p50PageLatencyMs}ms`);
    console.log(`  P95 latency:           ${result.p95PageLatencyMs}ms`);
    console.log(`  P99 latency:           ${result.p99PageLatencyMs}ms`);
    console.log("");
    console.log(`  Peak RSS:              ${result.peakRssMb}MB`);
    console.log(`  Peak Heap:             ${result.peakHeapMb}MB`);
    console.log(`  Max concurrent:        ${result.maxConcurrentRequests}`);
    console.log(`  Browser:               ${result.browser.enabled ? `${result.browser.pagesCreated} created, ${result.browser.pagesFailed} failed` : "not used"}`);
    console.log(`  Redis:                 ${result.redis.enabled ? `${result.redis.calls} calls, ${result.redis.errors} errors` : "not used"}`);
    console.log("");
    console.log(`  Aborted early:         ${result.abortedEarly ? `Yes — ${result.abortReason}` : "No"}`);

    if (result.errors.length > 0) {
        console.log(`\n  First ${Math.min(result.errors.length, 10)} errors:`);
        for (const err of result.errors.slice(0, 10)) {
            console.log(`    ${err.url}: ${err.error}`);
        }
    }

    // Output JSON for automated processing
    console.log("\n── JSON Report ──\n");
    console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
    console.error("Load test failed:", err);
    process.exit(1);
});
