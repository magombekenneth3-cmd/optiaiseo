# AISEO Codebase — Full Technical Audit & Senior-Level Recommendation Guide

**Codebase:** `aiseo_light.zip`  
**Stack:** Next.js 14 (App Router) · TypeScript · Prisma · Inngest · Redis · Gemini · Google APIs  
**Audit date:** May 2026  
**Auditor scope:** Audit engine, Inngest job pipeline, module system, crawler, data layer, security, performance, AI features

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Audit Engine — Core (`engine.ts`)](#3-audit-engine--core-enginets)
4. [Module System (`src/lib/seo-audit/modules/`)](#4-module-system)
5. [Inngest Job Pipeline](#5-inngest-job-pipeline)
6. [Page Discovery & Crawler (`crawler.ts`)](#6-page-discovery--crawler-crawlerts)
7. [Data Layer (Prisma + Redis)](#7-data-layer-prisma--redis)
8. [Security](#8-security)
9. [AI Feature Layer](#9-ai-feature-layer)
10. [Frontend & UX](#10-frontend--ux)
11. [Scoring & Prioritisation System](#11-scoring--prioritisation-system)
12. [Full Issue Register](#12-full-issue-register)
13. [Recommendation Roadmap](#13-recommendation-roadmap)

---

## 1. Executive Summary

The codebase is architecturally mature. Inngest fan-out, Redis locking, DB-first page discovery, PSI caching, SSRF guards, and a declarative module registry are all solid production patterns. The system handles scale correctly in most places.

The critical gaps are concentrated in three areas:

**Correctness** — Per-page audits run the wrong engine profile (full 15-module engine instead of the 9-module page profile), store an incomplete data shape (`categories[]` instead of `FullAuditReport`), and never receive the `targetKeyword` that keyword modules depend on.

**Efficiency** — These engine mismatches create ~40% unnecessary compute per page audit. The 90-second module timeout is also shared across all modules with no per-module budget, meaning one slow LLM call can stall fast HTML-parsing checks.

**Reliability** — The audit lock is released before the page fan-out completes, the weekly audit regression threshold is hardcoded and too coarse, and the `AuditPoller` can time out on ENTERPRISE sites before audits finish.

None of these are showstoppers. All are fixable in a single sprint.

---

## 2. Architecture Overview

```
User action
  └─ runAudit() server action
       ├─ Creates PENDING Audit record
       ├─ Acquires Redis lock (600s TTL backstop)
       └─ inngest.send("audit.run.manual")
            │
            ├─ processManualAuditJob
            │    ├─ step: run-homepage-audit   → AuditEngine (full, 15 modules)
            │    ├─ step: save-homepage-audit  → prisma.audit.update
            │    ├─ step: release-audit-lock   → redis.del  ← [ISSUE: too early]
            │    └─ step: queue-page-audits    → inngest.send("audit.pages.run")
            │
            ├─ runPageAuditJob ("audit.pages.run")
            │    ├─ step: verify-parent        → prisma.audit.findUnique
            │    ├─ step: discover-pages       → discoverPages() (7-tier DB+GSC+crawl)
            │    └─ step: fan-out-page-audits  → N × inngest.send("audit.page.single")
            │
            └─ processPageAuditJob ("audit.page.single") [concurrency: pageAuditChild per site]
                 ├─ step: run-page-audit       → AuditEngine (FULL — [ISSUE: should be PAGE profile])
                 └─ step: save-page-audit      → prisma.pageAudit.createMany (categories[] — [ISSUE: wrong shape])

Weekly:   runWeeklyAuditJob (cron "audit.run") — full engine, diff, healing plan
Free:     free-audit.ts → 3-module FREE profile
Magic:    magicFirstAuditJob — lightweight 5-point AEO check on signup
```

**Module profiles:**

| Profile | Modules | Used by |
|---|---|---|
| `full` | 15 modules | Homepage, weekly, post-fix |
| `free` | 3 modules | Unauthenticated trial |
| `page` | 7 modules | Per-page fan-out — **currently unused** (bug) |

---

## 3. Audit Engine — Core (`engine.ts`)

### 3.1 HTML pre-fetch strategy

**What it does:** Fetches HTML once before running modules in parallel, caching it in `context.html`. This is correct — without it, 15 modules × 4 retries = 60 cold-start network calls.

**Issue — no per-module HTML validation:** Modules that declare `requiresHtml: false` skip the fetch, but modules that need HTML and receive an empty string from a failed fetch currently receive `""` silently. Only `AiVisibilityModule` declares `requiresHtml: true`; most others have no declaration at all and fall through to their own `fetchHtml()` calls as a backup. This creates inconsistency.

**Recommendation:** Add a guard in the engine:

```typescript
// engine.ts — after pre-fetch
if (needsHtml && !html) {
    throw new Error(`Failed to reach ${url}. It may be down or blocking crawlers.`);
}
// Modules with requiresHtml: false that also have a fetchHtml fallback will
// double-fetch. Audit each module's fallback and remove redundant fetches.
```

Audit every module for the pattern `if (!context.html) { html = await fetchHtml(...) }` and remove those fallbacks. The engine's pre-fetch should be the single source of truth.

### 3.2 Module timeout

**What it does:** A 90-second `Promise.race` guards the entire `Promise.all`. If any single module exceeds 90s, the whole audit fails.

**Issue:** There is no per-module timeout. A slow `AiVisibilityModule` LLM probe or a hanging PSI API call can block the 14 other fast modules indefinitely up to the 90s ceiling.

**Recommendation:** Wrap each module invocation with its own timeout:

```typescript
const MODULE_TIMEOUT_MS: Record<string, number> = {
    'ai-visibility':   30_000,  // LLM probe is slow by nature
    'technical-seo':   25_000,  // PSI + CrUX API calls
    'performance':     20_000,
    'offpage':         15_000,  // external link checking
    // fast HTML-parsing modules get a tighter budget
    'onpage':          10_000,
    'basics':          10_000,
    'content-quality': 10_000,
    'keywords':         8_000,
    'image-seo':        8_000,
    'schema':           8_000,
    'keyword-optimisation': 8_000,
    'brand-entity':     8_000,
    'accessibility':    8_000,
    'social-branding':  8_000,
    'local-seo':        8_000,
};

// In the module runner:
const moduleTimeout = MODULE_TIMEOUT_MS[module.id] ?? 15_000;
const result = await Promise.race([
    module.run(context),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Module ${module.id} timed out after ${moduleTimeout}ms`)), moduleTimeout)
    ),
]);
```

This makes per-module failure granular without failing the whole audit.

### 3.3 Score calculation excludes crashed modules correctly

The engine filters out `crashed: true` modules from the overall score average. This is correct. Modules that ran cleanly and found zero issues contribute a score of 100, which is the intended behaviour.

### 3.4 AEO score computation

The AEO score is computed from `ai-visibility` module items using hardcoded weights. The weights sum to 1.0 and the calculation is correct. One gap: if the `ai-visibility` module crashes, `aeoScore` is `undefined` but the `FullAuditReport` type marks it as `number | undefined`, so downstream consumers must null-check. This is handled correctly in the rendering layer.

---

## 4. Module System

### 4.1 Module profile mismatch — `PAGE_MODULES` is never used in production

**Severity: High**

`src/lib/seo-audit/index.ts` defines three profiles: `full`, `free`, `page`. The `page` profile has 7 modules and is clearly designed for per-page fan-out. But `processPageAuditJob` calls `getFullAuditEngine()`, which loads the deprecated alias pointing at the full 15-module set.

```typescript
// src/lib/inngest/functions/page-audit.ts — current (wrong)
const engine = getFullAuditEngine();  // 15 modules

// Fix
import { getAuditEngine } from '@/lib/seo-audit';
const engine = getAuditEngine('page'); // 9 modules (after additions below)
```

Impact: Every sub-page audit runs `OffPageModule` (external link checking — up to 50 outbound HTTP calls), `LocalModule`, `SocialModule`, `PerformanceModule`, `KeywordsModule`, and `BasicsAnalyticsModule` — none of which provide value that varies page-to-page in a meaningful way. On an ENTERPRISE 100-page audit, this is ~600 unnecessary module executions per run.

### 4.2 `PAGE_MODULES` definition needs two additions

The current `PAGE_MODULES` definition omits `ContentQualityModule` and `AccessibilityModule`. Both are fast (HTML-parsing only, no external calls) and both produce meaningful per-page findings (word count, reading level, duplicate content signals, lang attribute, ARIA roles, skip-nav). Add them:

```typescript
const PAGE_MODULES: AuditModule[] = [
    OnPageModule,
    TechnicalModule,
    ContentQualityModule,        // add — fast, high per-page value
    KeywordOptimisationModule,
    ImageSeoModule,
    SchemaModule,
    AiVisibilityModule,
    BrandEntityModule,
    AccessibilityModule,         // add — fast, signals vary per page
];
```

Do not add `PerformanceModule` here — it calls PSI API which is expensive and the results are the same for all pages on the same domain. Run it only on the homepage.

### 4.3 Redundant `fetchHtml` fallbacks inside modules

Modules that use `context.html` also contain a guard like:

```typescript
if (!context.html) {
    html = await fetchHtml(context.url);
}
```

This existed before the engine's pre-fetch was introduced. Now that the engine pre-fetches and throws on failure, these fallbacks are dead code that adds confusion. They should be removed from: `TechnicalModule`, `OnPageModule`, `KeywordsModule`, `OffPageModule`, `LocalModule`, `SocialModule`, `PerformanceModule`, `ContentQualityModule`.

### 4.4 `KeywordsModule` has a bug — unused variable

```typescript
// src/lib/seo-audit/modules/keywords.ts
if (!context.html) {
    const html = (await fetchHtml(context.url)) ?? ""  // ← result never used
}
```

The fetched `html` is assigned to a block-scoped `const` inside the `if` and then immediately discarded. The module continues using `context.html` which is still empty. This means if the pre-fetch fails and somehow the module still runs, its output will be incorrect. Fix: remove the dead guard entirely; the engine now guarantees `context.html` or throws.

### 4.5 `TechnicalModule` fetches PSI twice (mobile + desktop) with no deduplication between audits of the same URL on the same day

**What it does:** PSI results are Redis-cached with a 24-hour TTL per URL per strategy. This is correct for a single audit run.

**Gap:** When the weekly cron triggers for 1,000 sites simultaneously, up to 2,000 PSI API calls may fire in the first few seconds before cache is warm. Add a short random jitter (0–5s) to the PSI fetch inside `TechnicalModule` to spread the thundering herd:

```typescript
// Before the PSI fetch
const jitter = Math.random() * 5000;
await new Promise(resolve => setTimeout(resolve, jitter));
```

### 4.6 `OffPageModule` — serial link checking fixed but chunk size is still risky

The module now uses `FETCH_CHUNK_SIZE = 20` and checks all links in one parallel batch. For sites with many outbound links, 20 simultaneous outbound HTTP requests from a Vercel function is close to the connection pool limit. If any 20 links are on the same slow domain, this will cause the module to approach its timeout budget.

**Recommendation:** Cap at 10 parallel and add a hard per-link timeout of 3s:

```typescript
const FETCH_CHUNK_SIZE = 10;
const FETCH_TIMEOUT_MS = 3_000; // current is 5_000
```

### 4.7 `ContentQualityModule` — E-E-A-T author detection is fragile

The module checks for author signals by looking at `AUTHOR_CANDIDATE_PATHS` (`/about`, `/team`, `/author`, etc.). This only helps if those pages exist and are crawlable. It doesn't check for `Person` schema or `<meta name="author">` on the current page. Add these as primary signals before falling back to path guessing.

### 4.8 `BrandEntityModule` — `sameAs` check doesn't validate URLs

The module checks that `sameAs` is a non-empty array but doesn't validate that the entries are actual social profile URLs. A site could pass with `sameAs: ["not-a-url"]`. Add a basic URL parse validation:

```typescript
const validSameAs = (org.sameAs as string[]).filter(url => {
    try { return new URL(url).protocol.startsWith('http'); }
    catch { return false; }
});
```

### 4.9 `AiVisibilityModule` — AI bot blocking detection is read-only

The module checks `robots.txt` for blocked AI bots (GPTBot, ClaudeBot, etc.) and reports it, but the result only surfaces as a `Warning`. For a product whose core value proposition is AI visibility, a blocked GPTBot should be a `Fail` with `priority: 'High'` and `aiVisibilityImpact: 100`.

---

## 5. Inngest Job Pipeline

### 5.1 `processPageAuditJob` — wrong engine and wrong data shape

Already covered in §4.1. Two separate issues in the same step:

**Issue A:** Uses full engine (15 modules) instead of page profile (7–9 modules).

**Issue B:** Stores `result.categories as any` instead of the full `FullAuditReport`:

```typescript
// Current — drops recommendations[], aeoScore, aeoBreakdown, moduleTelemetry
issueList: result.categories as any,

// Fix — consistent with homepage audit shape
issueList: result as any,
```

This inconsistency means `PageAuditSection.tsx` either can't show recommendations for sub-pages or contains fragile shape-detection logic.

### 5.2 `processPageAuditJob` — no `targetKeyword` passed

The site's `targetKeyword` is never retrieved or forwarded to the page audit engine. `KeywordOptimisationModule` and `ImageSeoModule` both use `context.targetKeyword` — without it, they fall back to extracting a keyword from the page title, which is less accurate and produces inconsistent findings across pages.

```typescript
// Fix — add to the run-page-audit step
const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { targetKeyword: true },
});
const result = await engine.runAudit(pageUrl, {
    targetKeyword: site?.targetKeyword ?? undefined,
});
```

### 5.3 Audit lock released before fan-out completes

In `processManualAuditJob`:

```typescript
// Step order (current):
// 1. run-homepage-audit
// 2. save-homepage-audit
// 3. release-audit-lock   ← lock released here
// 4. queue-page-audits    ← but fan-out happens after
```

The comment in the code says "unlocks immediately even if page audits take another few minutes" and frames this as intentional. However, a user who clicks "Run Audit" again immediately after will create a new Audit record while 100 page audit workers are still writing `PageAudit` rows against the previous `auditId`. The parent audit's `fixStatus` will be set to `COMPLETED` by `runPageAuditJob` on the old record while the new audit is already `IN_PROGRESS`.

This is a data integrity issue, not just a UX one. The fix depends on business priorities:

**Option A (minimal):** Keep early unlock for UX but add a check in `runPageAuditJob` that aborts fan-out if a newer audit for the same site already exists:

```typescript
const newerAudit = await prisma.audit.findFirst({
    where: { siteId, runTimestamp: { gt: parentAudit.runTimestamp } },
});
if (newerAudit) {
    logger.info('[PageAudit] Newer audit exists — aborting fan-out');
    return { skipped: true, reason: 'Superseded by newer audit' };
}
```

**Option B (correct):** Use a separate `page-audit-lock:${siteId}` key released by `runPageAuditJob` on completion, independent of the homepage lock.

### 5.4 Weekly audit regression threshold is too coarse and hardcoded

```typescript
const REGRESSION_THRESHOLD = 10;
```

This constant is hardcoded in `runWeeklyAuditJob`. A 10-point drop in `overallScore` (which is an average of 15 module scores) represents a large regression — a single module going from 80 to 30 would move the overall score by ~3 points. Most legitimate regressions that users would care about (a broken canonical, a removed schema block, a new noindex) would move the score 3–6 points.

**Recommendation:** Lower to 5 and make it configurable per-tier or via environment variable:

```typescript
const REGRESSION_THRESHOLD = parseInt(process.env.AUDIT_REGRESSION_THRESHOLD ?? '5', 10);
```

### 5.5 `runWeeklyAuditJob` — `issueList` shape compatibility shim will grow forever

The weekly job contains this branching logic to handle two historical data shapes:

```typescript
if (!Array.isArray(il) && Array.isArray(il.categories)) { ... } // new shape
if (Array.isArray(il)) { ... }                                   // old shape
```

This will need to be maintained forever as long as old records exist in the database. The correct fix is a data migration, not an ever-growing compatibility shim.

**Recommendation:** Write a one-time migration script:

```typescript
// scripts/migrate-audit-issue-list.ts
const oldAudits = await prisma.audit.findMany({
    where: { issueList: { not: undefined } },
    select: { id: true, issueList: true },
});
for (const audit of oldAudits) {
    const il = audit.issueList as any;
    if (Array.isArray(il)) {
        // Old shape: raw categories[] — wrap in FullAuditReport shell
        await prisma.audit.update({
            where: { id: audit.id },
            data: {
                issueList: {
                    schemaVersion: 2,
                    url: '',
                    timestamp: '',
                    overallScore: 0,
                    categories: il,
                    recommendations: [],
                } as any,
            },
        });
    }
}
```

Add `schemaVersion: 2` to all new `FullAuditReport` objects so the shim can be reduced to a single version check.

### 5.6 `magicFirstAuditJob` — health check uses a hardcoded 5-point check that duplicates module logic

The magic first audit runs a lightweight 5-point check (title, meta, HTTPS, speed proxy, AEO score) using bespoke inline logic. This is a maintenance burden — changes to how the real audit evaluates titles or meta will not be reflected in the activation email.

**Recommendation:** Run the `free` profile engine (3 modules: `OnPage`, `Technical`, `ContentQuality`) instead. It's fast, uses the same logic as the real audit, and produces richer findings for the activation email without adding LLM cost.

### 5.7 `processGsovSiteJob` and `processGscSiteJob` — no dead-letter handling

Both jobs have `retries: 2` and `onFailure` handlers that log errors. But if a site consistently fails (e.g. the domain no longer resolves), it will retry every hour indefinitely via the cron fan-out. Add a failure counter per site and skip sites that have failed more than N consecutive times:

```typescript
// On each failure, increment a Redis counter
await redis.incr(`gsov:fail:${siteId}`);
await redis.expire(`gsov:fail:${siteId}`, 7 * 24 * 60 * 60); // 7 days

// At the start of processGsovSiteJob
const failCount = parseInt(await redis.get(`gsov:fail:${siteId}`) ?? '0', 10);
if (failCount > 5) {
    logger.warn('[GSoV] Site has failed 5+ times — skipping', { siteId });
    return { skipped: true };
}
```

---

## 6. Page Discovery & Crawler (`crawler.ts`)

### 6.1 Discovery strategy is correct and well-prioritised

The 7-tier strategy (IndexingLog → blogs → past audits → GSC → sitemap → homepage crawl) is the right priority order. DB-first avoids unnecessary external calls and GSC impressions-sorted ordering ensures the highest-traffic pages are audited within tier limits.

### 6.2 Homepage is always first but is already audited

The crawler returns `[homepage, ...subPages]` and `runPageAuditJob` slices with `pageUrls.slice(1)` to skip the homepage. This is correct. But if the homepage URL format differs between what the crawler returns and what the engine was already called with (e.g. `https://example.com` vs `https://example.com/`), a trailing-slash mismatch could cause a duplicate homepage audit.

**Recommendation:** Normalise all URLs through a shared utility before comparison:

```typescript
function normaliseUrl(url: string): string {
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname.replace(/\/$/, '') || '/'}`;
    } catch { return url; }
}
```

### 6.3 GSC `resolveGscProperty` makes a live API call on every discovery run

The function tries multiple candidate property URL formats against the GSC API to find the verified property. This is correct for accuracy but adds latency to every page discovery run. Cache the resolved property URL in Redis:

```typescript
const cacheKey = `gsc:property:${userId}:${domain}`;
const cached = await redis.get(cacheKey);
if (cached) return cached as string;

const resolved = await resolveGscProperty(token, domain);
if (resolved) await redis.set(cacheKey, resolved, { ex: 86400 }); // 24hr
return resolved;
```

### 6.4 Sitemap parsing has no size guard

If a site's `sitemap_index.xml` lists 500 sitemaps each with 50,000 URLs, the crawler will attempt to fetch all of them before applying the page limit cap. Add a hard limit on sitemap fetch operations:

```typescript
const MAX_SITEMAP_FETCHES = 5; // only follow the first N sitemaps in an index
```

---

## 7. Data Layer (Prisma + Redis)

### 7.1 `prisma.pageAudit.createMany` with `skipDuplicates: true` silently swallows retry failures

On Inngest retry, the page audit step re-runs the full engine and tries to `createMany` with `skipDuplicates: true`. If the first attempt partially wrote some data (e.g. the `issueList` was truncated due to a DB timeout), the retry will skip the duplicate row and leave incorrect data in place. The correct pattern for retry-safe upserts is:

```typescript
await prisma.pageAudit.upsert({
    where: { auditId_pageUrl: { auditId, pageUrl } },
    create: { auditId, siteId, pageUrl, overallScore, categoryScores, issueList },
    update: { overallScore, categoryScores, issueList, runTimestamp: new Date() },
});
```

This requires a compound unique index on `(auditId, pageUrl)`, which the migration `20260416051600_add_page_audit_unique` already adds. Use it.

### 7.2 `writeMetricSnapshot` is called without await in multiple places

```typescript
await writeMetricSnapshot({ ... }).catch(() => { /* non-fatal */ });
```

The `.catch(() => {})` suppresses errors silently. Use a shared utility that logs failures:

```typescript
async function safeWriteMetricSnapshot(params: MetricSnapshotParams): Promise<void> {
    try {
        await writeMetricSnapshot(params);
    } catch (err) {
        logger.warn('[MetricSnapshot] Write failed (non-fatal)', { error: (err as Error).message });
    }
}
```

### 7.3 Audit cursor pagination uses `skip: 1` which is O(offset) for large datasets

```typescript
// getUserAudits
...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
```

Prisma cursor pagination with `skip: 1` is efficient only if the cursor is the first row in the page. For `orderBy: { runTimestamp: 'desc' }`, the cursor-based pagination should work correctly as Prisma uses the cursor record's position in the B-tree, not a numeric offset. This is fine — no change needed, but confirm that the `id` field used as cursor is indexed (it is, as the PK).

### 7.4 Redis lock TTL backstop of 600s may be too long for failed Inngest jobs

If an Inngest job fails before releasing the lock (e.g. the function crashes before the `release-audit-lock` step), the user is blocked from running a new audit for up to 10 minutes. For most audits that finish in 2–5 minutes, a 600s TTL is unnecessarily long. Reduce to 300s and add a Inngest `onFailure` handler that explicitly releases the lock:

```typescript
onFailure: async ({ event }) => {
    const { lockKey } = event.data?.event?.data ?? {};
    if (lockKey) await redis.del(lockKey).catch(() => null);
},
```

---

## 8. Security

### 8.1 SSRF protection is thorough and correctly layered

`fetchHtml` implements two-layer SSRF protection: string-level validation via `isValidPublicDomain()` and DNS-level resolution checking for private IP ranges (10.x, 172.16–31.x, 192.168.x, 127.x, 169.254.x). This is production-grade.

One gap: the DNS check uses `dns.resolve4()` which only checks IPv4. A host that resolves to a private IPv6 address (e.g. `::1` or `fd00::/8`) would pass. Add IPv6 checking:

```typescript
const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
const isPrivateV6 = (ip: string): boolean => {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
};
for (const addr of addresses6) {
    if (isPrivateV6(addr)) throw new Error(`[fetchHtml] Blocked SSRF: ${hostname} resolves to private IPv6 ${addr}`);
}
```

### 8.2 `isSafeUrl` in `OffPageModule` — confirm it handles the same private IP ranges

`OffPageModule` uses a separate `isSafeUrl` utility from `@/lib/security/safe-url` for outbound link checking. Verify this utility covers the same IP ranges as `fetchHtml`'s SSRF guard. If they diverge, a crafted outbound link could be used to probe internal infrastructure.

### 8.3 Audit input — `idSchema` validation is correct but limited

```typescript
const idSchema = z.string().min(1).max(50);
```

CUID v2 format (used by Prisma) produces strings of exactly 25 characters starting with `c`. The current schema accepts any 1–50 char string, which is broader than necessary. Tighten to:

```typescript
const idSchema = z.string().regex(/^c[a-z0-9]{24}$/);
```

This prevents oddly-formed IDs from reaching the database query layer.

### 8.4 Admin routes — verify authentication middleware covers `/admin/*`

`src/app/admin/` contains pages for user management, revenue, growth metrics, and platform usage. These are high-sensitivity routes. Verify that `src/middleware.ts` includes `/admin/*` in its protected route pattern. If the middleware uses a whitelist approach, admin routes must be explicitly included.

---

## 9. AI Feature Layer

### 9.1 `callGeminiForFix` timeout is 35s — close to Vercel's function limit

The Gemini fix-generation call has a `timeoutMs = 35_000` default. Vercel Serverless Functions have a 60s limit on the hobby plan and configurable limits on Pro/Enterprise, but Edge Functions are capped at 25s. If any fix generation is called from an Edge route, it will time out. Verify that all Gemini calls happen from Node.js runtime routes (not Edge).

### 9.2 `probeLlmCitation` — LLM probe logic not audited here

The LLM citation probe in `llm-citation-probe.ts` probes AI search engines to check if the site is being cited. This is a core differentiator. Ensure the probe results are cached aggressively (at least 6 hours per URL) since probing AI engines too frequently may result in rate-limiting or IP blocks.

### 9.3 Fix generation uses Gemini; audit uses Gemini — consider cost tracking

There is no per-user or per-site LLM call tracking. If a user repeatedly triggers fix generation (or if a bug causes retry loops), Gemini API costs can spike without visibility. Add a lightweight Redis counter:

```typescript
const key = `gemini:calls:${userId}:${new Date().toISOString().slice(0, 10)}`;
await redis.incr(key);
await redis.expire(key, 86400);
```

---

## 10. Frontend & UX

### 10.1 `AuditPoller` gives up after 60 attempts (~20 minutes)

```typescript
const MAX_ATTEMPTS = 60;
const MAX_INTERVAL = 30_000; // 30s
// Total max wait: ~20 min
```

For an ENTERPRISE site with 100 pages, the full audit (homepage + 100 page workers, concurrency-capped per-site) can exceed 20 minutes. The poller will show the timeout banner while the audit is still running.

**Recommendation:** Increase `MAX_ATTEMPTS` to 90 (30 minutes) for paid tiers. Better long-term: replace polling with SSE or Inngest's real-time event streaming to push completion without polling at all.

### 10.2 `AuditModeSelector` — free users see "Full Site Audit" with a limit of 5 pages

The selector shows free users that the full site audit will "crawl up to 5 pages". But `PAGE_LIMIT.FREE = 5` in `page-audit.ts` — the homepage is always the first page and `pagesToAudit = pageUrls.slice(1)`, so free users actually get up to 4 sub-pages plus the homepage. The UI should say "up to 4 additional pages" or restructure the limit to include the homepage in the count.

### 10.3 `AuditButton` — no loading state during the `runAudit` server action call

The button initiates `runAudit()` which does several async operations (auth check, site lookup, rate limit check, Redis lock acquisition, Prisma create, Inngest send) before returning. During this time, the UI shows nothing. Add an immediate disabled/loading state on button click before the server action returns.

---

## 11. Scoring & Prioritisation System

### 11.1 Module score formula is correct but inconsistent across modules

Most modules use:
```typescript
score = Math.round(((passed + warnings * 0.5) / total) * 100)
```

This gives warnings half credit, which is semantically correct. But `AuditEngine` computes `overallScore` as a simple average of module scores, treating a 50-score content module the same as a 50-score technical module. Users may care more about technical issues than social branding issues.

**Recommendation:** Add optional module weights to the registry:

```typescript
interface AuditModule {
    id: string;
    label: string;
    weight?: number; // default 1.0
    requiresHtml?: boolean;
    run: (context: AuditModuleContext) => Promise<AuditCategoryResult>;
}

// Example weights
const MODULE_WEIGHTS: Record<string, number> = {
    'technical-seo':   1.5,
    'onpage':          1.5,
    'content-quality': 1.2,
    'keywords':        1.2,
    'ai-visibility':   1.0,
    'performance':     1.0,
    'schema':          1.0,
    'image-seo':       0.8,
    'offpage':         0.8,
    'brand-entity':    0.7,
    'local-seo':       0.6,
    'social-branding': 0.5,
    'accessibility':   0.7,
    'keyword-optimisation': 1.0,
    'basics':          1.0,
};
```

### 11.2 `priorityScore` formula (ROI×0.6 + AIVisibility×0.4) is not documented for users

The score drives the order of the "Top Fixes" list, which is one of the most user-facing features. Users have no way to know why Fix A appears above Fix B. Add a tooltip or info icon explaining the formula in plain language: "Priority is based on estimated traffic impact (60%) and AI visibility impact (40%)."

### 11.3 `computePriority` in `types.ts` uses a different formula than the engine

`types.ts` defines:
```typescript
// impact×0.5 + ease×0.3 + confidence×0.2
computePriority(issue: AuditIssue): number
```

But the engine uses:
```typescript
// roiImpact×0.6 + aiVisibilityImpact×0.4
priorityScore = Math.round(roiImpact * 0.6 + aiVisibilityImpact * 0.4)
```

These are two different scoring systems for two different types. `AuditIssue` (with `estimatedTrafficImpact`, `fixDifficulty`, `confidence`) appears to be an older type that is not used in the current module output. `ChecklistItem` (with `roiImpact`, `aiVisibilityImpact`) is the current type. The `AuditIssue` type and `computePriority` / `rankIssues` functions can likely be deleted, but verify no module or component still references them.

---

## 12. Full Issue Register

| # | Location | Severity | Category | Description |
|---|---|---|---|---|
| 1 | `page-audit.ts` | **Critical** | Correctness | `processPageAuditJob` uses full engine (15 modules) instead of page profile |
| 2 | `page-audit.ts` | **Critical** | Correctness | `PageAudit.issueList` stores `categories[]` not `FullAuditReport` |
| 3 | `page-audit.ts` | **High** | Correctness | `targetKeyword` never passed to page audit engine |
| 4 | `engine.ts` | **High** | Reliability | No per-module timeout — one slow module blocks all others |
| 5 | `audit.ts` (Inngest) | **High** | Reliability | Audit lock released before page fan-out completes |
| 6 | `index.ts` | **High** | Performance | `PAGE_MODULES` missing `ContentQualityModule` and `AccessibilityModule` |
| 7 | `keywords.ts` | **High** | Correctness | Dead variable — fetched HTML never used |
| 8 | Multiple modules | **Medium** | Maintainability | Redundant `fetchHtml` fallbacks now that engine pre-fetches |
| 9 | `audit.ts` (Inngest) | **Medium** | Data integrity | `issueList` shape shim will grow forever — needs migration |
| 10 | `audit.ts` (Inngest) | **Medium** | Config | `REGRESSION_THRESHOLD = 10` too coarse, hardcoded |
| 11 | `page-audit.ts` | **Medium** | Data integrity | `createMany + skipDuplicates` can silently preserve bad data on retry |
| 12 | `crawler.ts` | **Medium** | Performance | GSC property resolution makes live API call on every discovery run |
| 13 | `crawler.ts` | **Medium** | Reliability | No sitemap size guard — could fetch hundreds of sitemaps |
| 14 | `AuditPoller.tsx` | **Medium** | UX | Gives up after 20 min — too short for ENTERPRISE audits |
| 15 | `technical.ts` | **Medium** | Performance | PSI thundering herd on weekly cron — no jitter |
| 16 | `offpage.ts` | **Medium** | Reliability | 20 parallel outbound checks near Vercel connection pool limit |
| 17 | `fetch-html.ts` | **Low** | Security | DNS SSRF check only covers IPv4, not IPv6 |
| 18 | `engine.ts` | **Low** | Observability | No per-module timeout telemetry |
| 19 | `ai-visibility.ts` | **Low** | Correctness | Blocked GPTBot should be `Fail` not `Warning` |
| 20 | `brand-entity.ts` | **Low** | Correctness | `sameAs` array entries not validated as URLs |
| 21 | `content-quality.ts` | **Low** | Correctness | Author detection misses `Person` schema and `<meta name="author">` |
| 22 | `audit.ts` (server action) | **Low** | Security | `idSchema` accepts any 1–50 char string, not CUID format |
| 23 | `types.ts` | **Low** | Maintainability | `AuditIssue` / `computePriority` / `rankIssues` appear unused |
| 24 | `AuditModeSelector.tsx` | **Low** | UX | "up to 5 pages" is misleading — homepage is always page 1 |
| 25 | `magic-first-audit.ts` | **Low** | Maintainability | Hardcoded 5-point check duplicates module logic |
| 26 | `gsov jobs` | **Low** | Reliability | No dead-letter handling for persistently failing sites |
| 27 | `engine.ts` | **Low** | UX | Overall score weights all modules equally regardless of importance |

---

## 13. Recommendation Roadmap

### Sprint 1 — Correctness (1 week)

These are bugs. They produce wrong data today.

**1.1 — Fix page audit engine profile**

File: `src/lib/inngest/functions/page-audit.ts`

```typescript
// Before
import { getFullAuditEngine } from '@/lib/seo-audit';
const engine = getFullAuditEngine();

// After
import { getAuditEngine } from '@/lib/seo-audit';
const engine = getAuditEngine('page');
```

**1.2 — Fix PageAudit issueList shape**

File: `src/lib/inngest/functions/page-audit.ts`

```typescript
// Before
issueList: result.categories as any,

// After
issueList: result as any,
```

**1.3 — Pass targetKeyword to page audits**

File: `src/lib/inngest/functions/page-audit.ts`

```typescript
// In the run-page-audit step:
const [engine, site] = await Promise.all([
    Promise.resolve(getAuditEngine('page')),
    prisma.site.findUnique({ where: { id: siteId }, select: { targetKeyword: true } }),
]);
const result = await engine.runAudit(pageUrl, {
    targetKeyword: site?.targetKeyword ?? undefined,
});
```

**1.4 — Fix dead variable in KeywordsModule**

File: `src/lib/seo-audit/modules/keywords.ts`

Remove the `if (!context.html)` block entirely. The engine now guarantees `context.html` or throws before any module runs.

**1.5 — Update PAGE_MODULES**

File: `src/lib/seo-audit/index.ts`

Add `ContentQualityModule` and `AccessibilityModule`. Remove `BasicsAnalyticsModule`, `KeywordsModule`, `OffPageModule`, `LocalModule`, `SocialModule`, `PerformanceModule` from the page profile.

---

### Sprint 2 — Reliability (1 week)

**2.1 — Add per-module timeouts**

File: `src/lib/seo-audit/engine.ts`

Add the `MODULE_TIMEOUT_MS` map and per-module `Promise.race` wrapper as described in §3.2.

**2.2 — Fix audit lock timing**

File: `src/lib/inngest/functions/audit.ts`

Implement Option A from §5.3: check for a newer audit before starting fan-out in `runPageAuditJob`. This is the minimal change that prevents data corruption without changing the UX promise.

**2.3 — Fix upsert in page audit save step**

File: `src/lib/inngest/functions/page-audit.ts`

Replace `createMany + skipDuplicates` with `upsert` using the compound unique key `{ auditId_pageUrl }`.

**2.4 — Add Redis failure counter for GSoV/GSC jobs**

File: `src/lib/inngest/functions/audit.ts`

Add the failure counter pattern from §5.7 to both `processGsovSiteJob` and `processGscSiteJob`.

**2.5 — Reduce Redis lock TTL and add onFailure release**

File: `src/lib/inngest/functions/audit.ts`

Reduce `ex: 600` to `ex: 300`. Add `onFailure` to `processManualAuditJob` that releases the lock.

---

### Sprint 3 — Performance (1 week)

**3.1 — Add GSC property resolution caching**

File: `src/lib/seo-audit/crawler.ts`

Cache `resolveGscProperty` result in Redis with a 24-hour TTL.

**3.2 — Add sitemap fetch limit**

File: `src/lib/seo-audit/crawler.ts`

Cap `MAX_SITEMAP_FETCHES = 5`.

**3.3 — Reduce OffPageModule parallel fetch count**

File: `src/lib/seo-audit/modules/offpage.ts`

Reduce `FETCH_CHUNK_SIZE` from 20 to 10. Reduce `FETCH_TIMEOUT_MS` from 5000 to 3000.

**3.4 — Add PSI jitter for weekly cron**

File: `src/lib/seo-audit/modules/technical.ts`

Add a 0–5s random jitter before each PSI fetch to spread the thundering herd.

**3.5 — Remove redundant fetchHtml fallbacks from modules**

Files: `technical.ts`, `onpage.ts`, `keywords.ts`, `offpage.ts`, `local.ts`, `social.ts`, `performance.ts`, `content-quality.ts`

Remove the `if (!context.html) { html = await fetchHtml(...) }` guards from each. The engine's pre-fetch is now the single source of truth.

---

### Sprint 4 — Data & Observability (ongoing)

**4.1 — Write issueList migration script**

Write and run the one-time migration described in §5.5 to normalise all `Array<categories>` shapes to `FullAuditReport` with `schemaVersion: 2`.

**4.2 — Add module weights to scoring**

File: `src/lib/seo-audit/engine.ts` + `index.ts`

Add the optional `weight` field to `AuditModule` and use it in `overallScore` computation.

**4.3 — Add Gemini call tracking**

Add a Redis daily counter per user for all `callGemini` / `callGeminiForFix` invocations. Surface in the admin usage dashboard.

**4.4 — Increase AuditPoller max attempts by tier**

File: `src/app/dashboard/audits/AuditPoller.tsx`

Accept a `tier` prop and set `MAX_ATTEMPTS` to 90 for AGENCY/ENTERPRISE, 60 for PRO, 40 for FREE.

**4.5 — Tighten idSchema to CUID format**

File: `src/app/actions/audit.ts`

```typescript
const idSchema = z.string().regex(/^c[a-z0-9]{24}$/);
```

**4.6 — Add IPv6 check to fetchHtml SSRF guard**

File: `src/lib/seo-audit/utils/fetch-html.ts`

Add `dns.resolve6` check with private IPv6 range detection as described in §8.1.

---

### Long-term Improvements

**Weighted module scoring** — Replace simple average with a weighted average using business-importance weights. Surface the weights to users as documentation so they understand why technical SEO issues rank above social branding issues.

**SSE-based audit progress** — Replace `AuditPoller` polling with server-sent events. Inngest can emit progress events; the Next.js app can stream them to the client via a route handler. This eliminates polling overhead and makes the UX feel instant.

**Module result caching** — Cache individual module results (not just PSI) by URL + content hash. If a page's HTML hasn't changed since the last audit, return cached module results. This would dramatically reduce per-page audit cost for large sites with mostly-static content.

**Per-page keyword targeting** — Allow users to assign a target keyword per page (not just per site). This would make `KeywordOptimisationModule` and `ImageSeoModule` output page-specific rather than falling back to title extraction.

**Self-healing audit feedback loop** — After `executeHealingWithConfidenceGate` applies a fix, the post-fix audit currently runs the full engine. Consider running only the modules relevant to the fix type (e.g. if the fix was a schema change, run only `SchemaModule` and `AiVisibilityModule`) to reduce cost.

---

*End of audit. All code references are to files in the `aiseo_light.zip` codebase as of May 2026.*