/**
 * Chunked crawl execution with bounded worker-pool concurrency.
 *
 * Uses CrawlFrontier for BFS state and a semaphore-based WorkerPool
 * to enforce real bounded concurrency (not Promise.allSettled wrapping).
 */
import { logger } from "@/lib/logger";
import { CrawlFrontier, crawlSite } from "./index";
import type { CrawlResult, CrawlOptions, CrawlIssue, FrontierItem } from "./index";
import { isSafeUrl } from "@/lib/security/safe-url";

// ─── Worker Pool ────────────────────────────────────────────────────────────

/**
 * Semaphore-based worker pool.
 * Unlike Promise.allSettled(chunk.map(fn)), this guarantees
 * at most `poolSize` concurrent executions at any time.
 */
class WorkerPool {
    private running = 0;
    private readonly resolvers: Array<() => void> = [];
    private _maxConcurrent = 0;

    constructor(private readonly poolSize: number) {}

    async acquire(): Promise<void> {
        if (this.running < this.poolSize) {
            this.running++;
            if (this.running > this._maxConcurrent) this._maxConcurrent = this.running;
            return;
        }
        await new Promise<void>(resolve => this.resolvers.push(resolve));
        if (this.running > this._maxConcurrent) this._maxConcurrent = this.running;
    }

    release(): void {
        this.running--;
        const next = this.resolvers.shift();
        if (next) {
            this.running++;
            next();
        }
    }

    get currentConcurrency(): number {
        return this.running;
    }

    get maxConcurrentReached(): number {
        return this._maxConcurrent;
    }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemorySnapshot {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
}

export interface ChunkProgress {
    pagesScanned: number;
    totalIssues: number;
    elapsedMs: number;
    currentChunk: number;
    memoryMb: MemorySnapshot;
}

export interface ChunkedCrawlOptions extends CrawlOptions {
    /** Pages per chunk (default: 100). */
    chunkSize?: number;
    /** Max concurrent fetch workers within a chunk (default: 10). */
    workerPoolSize?: number;
    /** Return true to stop early — checked between chunks. */
    shouldAbort?: () => boolean;
    /** Called after each chunk completes. */
    onChunkComplete?: (progress: ChunkProgress) => void;
    /**
     * Skip SSRF-protection URL checks.
     * ONLY set true for synthetic load testing against localhost.
     * Never enable in production crawl paths.
     */
    skipSafeUrlCheck?: boolean;
}

// ─── Memory helpers ─────────────────────────────────────────────────────────

function takeMemorySnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    return {
        rssMb: +(mem.rss / (1024 * 1024)).toFixed(1),
        heapUsedMb: +(mem.heapUsed / (1024 * 1024)).toFixed(1),
        heapTotalMb: +(mem.heapTotal / (1024 * 1024)).toFixed(1),
        externalMb: +(mem.external / (1024 * 1024)).toFixed(1),
    };
}

// ─── Single-page processor ─────────────────────────────────────────────────

interface PageProcessResult {
    url: string;
    discoveredUrls: FrontierItem[];
    issues: CrawlIssue[];
    latencyMs: number;
    success: boolean;
    error?: string;
}

async function processPage(
    item: FrontierItem,
    origin: string,
    usePlaywright: boolean,
    skipSafeUrlCheck = false,
): Promise<PageProcessResult> {
    const start = Date.now();
    const result: PageProcessResult = {
        url: item.url,
        discoveredUrls: [],
        issues: [],
        latencyMs: 0,
        success: false,
    };

    try {
        if (!skipSafeUrlCheck) {
            const guard = isSafeUrl(item.url);
            if (!guard.ok) {
                result.latencyMs = Date.now() - start;
                return result;
            }
        }

        const res = await fetch(item.url, {
            redirect: "follow",
            headers: { "User-Agent": "SEOTool-Bot/1.0 (site audit; read-only)" },
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
            result.issues.push({
                url: item.url,
                type: "broken_link",
                severity: "warning",
                details: `HTTP ${res.status} — linked from ${item.from}`,
            });
            result.latencyMs = Date.now() - start;
            return result;
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) {
            result.success = true;
            result.latencyMs = Date.now() - start;
            return result;
        }

        const html = await res.text();

        // Extract internal links for frontier
        const linkMatches = [...html.matchAll(/href=["']([^"'#?]+)["']/gi)];
        for (const match of linkMatches) {
            let href = match[1];
            if (href.startsWith("/")) href = `${origin}${href}`;
            if (!href.startsWith(origin)) continue;
            if (!skipSafeUrlCheck && !isSafeUrl(href).ok) continue;
            result.discoveredUrls.push({
                url: href,
                depth: item.depth + 1,
                from: item.url,
            });
        }

        // Basic SEO checks
        const wordCount = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => w.length > 2).length;
        if (wordCount < 200) {
            result.issues.push({
                url: item.url,
                type: "thin_content",
                severity: "warning",
                details: `Only ~${wordCount} words — potential thin content penalty`,
            });
        }

        if (item.depth > 3) {
            result.issues.push({
                url: item.url,
                type: "deep_click_depth",
                severity: "warning",
                details: `Click depth of ${item.depth} exceeds recommended maximum.`,
            });
        }

        result.success = true;
    } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        result.error = msg;
        result.issues.push({
            url: item.url,
            type: "broken_link",
            severity: "warning",
            details: `Failed: ${msg}`,
        });
    }

    result.latencyMs = Date.now() - start;
    return result;
}

// ─── Chunked crawl ──────────────────────────────────────────────────────────

/**
 * Crawl a site in bounded chunks using a semaphore-based worker pool.
 *
 * Unlike the standard `crawlSite`, this:
 * - Processes pages in chunks with progress callbacks
 * - Enforces real bounded concurrency (WorkerPool semaphore)
 * - Yields between chunks to prevent event loop starvation
 * - Supports abort callbacks and memory limit monitoring
 */
export async function crawlSiteChunked(
    domain: string,
    options?: ChunkedCrawlOptions,
): Promise<CrawlResult> {
    const chunkSize = options?.chunkSize ?? 100;
    const poolSize = options?.workerPoolSize ?? 10;
    const maxPages = options?.maxPages ?? 500;
    const maxDepth = options?.maxDepth ?? 4;
    const shouldAbort = options?.shouldAbort;
    const onChunkComplete = options?.onChunkComplete;
    const skipSafeUrlCheck = options?.skipSafeUrlCheck ?? false;

    let origin: string;
    try {
        const parsed = new URL(domain.startsWith("http") ? domain : `https://${domain}`);
        origin = parsed.origin;
    } catch {
        throw new Error(`Invalid domain: ${domain}`);
    }

    const frontier = new CrawlFrontier(origin, maxDepth, maxPages);
    const allIssues: CrawlIssue[] = [];
    const latencies: number[] = [];
    const startTime = Date.now();
    let chunkIndex = 0;
    let totalFailed = 0;

    while (frontier.hasWork()) {
        // ── Abort check ────────────────────────────────────────────
        if (shouldAbort?.()) {
            logger.info("[ChunkedCrawl] Aborted by callback", {
                pagesScanned: frontier.visitedCount,
                chunk: chunkIndex,
            });
            break;
        }

        // ── Take a chunk from the frontier ─────────────────────────
        const batch = frontier.take(chunkSize);
        if (batch.length === 0) break;

        const pool = new WorkerPool(poolSize);
        const chunkResults: PageProcessResult[] = [];

        // ── Process chunk with bounded workers ─────────────────────
        const tasks = batch.map(async (item) => {
            await pool.acquire();
            try {
                frontier.markVisited(item.url);
                const result = await processPage(item, origin, false, skipSafeUrlCheck);
                chunkResults.push(result);

                // Add discovered URLs back to frontier
                if (result.discoveredUrls.length > 0) {
                    frontier.add(result.discoveredUrls);
                }
            } finally {
                pool.release();
            }
        });

        await Promise.allSettled(tasks);

        // ── Aggregate chunk results ────────────────────────────────
        for (const r of chunkResults) {
            allIssues.push(...r.issues);
            latencies.push(r.latencyMs);
            if (!r.success) totalFailed++;
        }

        chunkIndex++;

        // ── Progress callback ──────────────────────────────────────
        if (onChunkComplete) {
            onChunkComplete({
                pagesScanned: frontier.visitedCount,
                totalIssues: allIssues.length,
                elapsedMs: Date.now() - startTime,
                currentChunk: chunkIndex,
                memoryMb: takeMemorySnapshot(),
            });
        }

        // ── Yield to event loop between chunks ─────────────────────
        await new Promise<void>(resolve => setImmediate(resolve));
    }

    return {
        domain,
        pagesScanned: frontier.visitedCount,
        issues: allIssues,
        brokenLinks: [],
        redirectChains: [],
        duplicateTitles: [],
        clickDepthMap: {},
        orphanPages: [],
        deepPages: [],
        linkGraph: [],
        scannedAt: new Date(),
        jsRendered: false,
        spaFrameworkDetected: null,
    };
}

export { WorkerPool, takeMemorySnapshot };
export type { PageProcessResult };
