# GSC & SERP Competitor Analysis — OptiAISEO Codebase Report

> **Scope:** `src/lib/gsc/`, `src/lib/serp-gap/`, `src/lib/competitors/`, `src/app/actions/serp-analysis.ts`, `src/lib/inngest/functions/keyword-serp-analysis.ts`, `src/lib/inngest/functions/serp-gap-analysis.ts`, `src/lib/self-healing/gsc.ts`, `src/lib/keywords/gsc-opportunities.ts`, `src/lib/keywords/gsc-keywords-by-page.ts`
>
> **18 files analysed · 7 critical issues · 9 warnings · 6 quick wins**

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [GSC Pipeline — Issues & Fixes](#2-gsc-pipeline--issues--fixes)
3. [Keyword SERP Analysis Job — Issues & Fixes](#3-keyword-serp-analysis-job--issues--fixes)
4. [SERP Gap Analysis Pipeline — Issues & Fixes](#4-serp-gap-analysis-pipeline--issues--fixes)
5. [Competitor Page Analysis — Issues & Fixes](#5-competitor-page-analysis--issues--fixes)
6. [Quick Wins](#6-quick-wins)
7. [Prioritised Roadmap](#7-prioritised-roadmap)

---

## 1. Architecture Overview

Two separate SERP pipelines run in parallel with no shared coordination layer:

```
GSC OAuth / Service Account
        │
        ▼
src/lib/gsc/index.ts          ← Core fetch + all analytics functions
        │
        ├── gsc-opportunities.ts     ← Quick-win opportunities (50 cap)
        ├── gsc-keywords-by-page.ts  ← Per-page keyword grouping (10-kw cap)
        └── self-healing/gsc.ts      ← Anomaly detection + AI healing plan

Serper API (SERP data)
        │
        ├── Pipeline A: keyword-serp-analysis.ts (Inngest)
        │       └── AI: Gemini Pro  →  fixes[], headingGaps[]
        │
        └── Pipeline B: serp-gap-analysis.ts (Inngest)
                └── analyser.ts  →  GapReport  →  plan-generator.ts

src/lib/competitors/index.ts  ← Keyword gap engine (Serper + Gemini)
        ├── detect.ts               ← 9-step competitor fingerprinting
        └── refreshCompetitorKeywords()  ← GSC enrichment of gap data
```

The pipelines are functionally sound but have **data integrity gaps, hardcoded thresholds, and several fields that are computed but never persisted** — causing the frontend to render zero-values silently.

---

## 2. GSC Pipeline — Issues & Fixes

### 2.1 `yourPageH2s`, `clientDR`, `clientRDs`, `toxicCount`, `topAnchors`, `newLastWeek`, `lostLastWeek`, `dofollowRatio` are always zero

**Severity: 🔴 Critical**

In both `src/app/actions/serp-analysis.ts` (the cache-hit return path) and `src/app/api/serp-analysis/status/route.ts` (the polling endpoint), eight fields that the frontend actively renders are hardcoded to `0` or `[]`:

```ts
// src/app/actions/serp-analysis.ts  ─  toResult()
yourPageH2s:   [],   // ← never populated from DB
clientDR:      0,    // ← schema has no clientDR column
clientRDs:     0,
toxicCount:    0,
topAnchors:    [],
newLastWeek:   0,
lostLastWeek:  0,
dofollowRatio: 0,
```

The Inngest job **does** compute `userH2s`, `clientDR`, `clientRDs`, `toxicCount`, and `topAnchors` in the `ai-fixes` step — but never saves them to `KeywordSerpAnalysis`. They exist in memory only for the Gemini prompt string, then are discarded.

**Fix — add columns to the Prisma schema and persist them:**

```prisma
// prisma/schema.prisma — KeywordSerpAnalysis
model KeywordSerpAnalysis {
  // ... existing fields ...
  yourPageH2s    Json      @default("[]")
  clientDR       Float?
  clientRDs      Int?
  toxicCount     Int?
  topAnchors     Json      @default("[]")
  newLastWeek    Int?
  lostLastWeek   Int?
  dofollowRatio  Float?
}
```

```ts
// keyword-serp-analysis.ts — save-and-notify step
await prisma.keywordSerpAnalysis.update({
  where: { id: analysisId },
  data: {
    // existing fields...
    yourPageH2s:   userH2s as unknown as Prisma.InputJsonValue,
    clientDR:      authorityComp?.yourDr ?? null,
    clientRDs:     backlinkSummary?.referringDomains ?? null,
    toxicCount:    backlinkSummary?.toxicCount ?? null,
    topAnchors:    (backlinkSummary?.topAnchors ?? []) as unknown as Prisma.InputJsonValue,
    newLastWeek:   backlinkSummary?.newLastWeek ?? null,
    lostLastWeek:  backlinkSummary?.lostLastWeek ?? null,
    dofollowRatio: backlinkSummary?.dofollowRatio ?? null,
  },
});
```

Then in `toResult()` and the status route, read from the DB row instead of hardcoding zeros.

---

### 2.2 `OPPORTUNITY_MIN_POSITION = 5` kills almost all quick-win opportunities

**Severity: 🔴 Critical**

```ts
// src/lib/gsc/index.ts
const OPPORTUNITY_MIN_POSITION = 5;
const OPPORTUNITY_MIN_IMPRESSIONS = 30;

// findOpportunities() filter:
.filter(kw =>
  kw.impressions >= 10 &&
  kw.avgPosition > OPPORTUNITY_MIN_POSITION &&   // > 5 only
  kw.impressions > OPPORTUNITY_MIN_IMPRESSIONS    // > 30
)
```

Keywords ranking #1–5 are excluded entirely — yet a keyword at position #3 with a terrible CTR (5% vs 28% expected) is your highest-value "ctr-optimize" opportunity. The intent multiplier of 1.5× for transactional keywords also means high-value commercial terms near the top get zero exposure in the opportunities panel.

**Fix:**

```ts
const OPPORTUNITY_MIN_POSITION = 1;  // include all positions
const OPPORTUNITY_MIN_IMPRESSIONS = 20; // lower threshold for low-volume niches

// In findOpportunities(), split the filter by opportunity type:
.filter(kw => {
  if (kw.impressions < 20) return false;
  // Always include high-ranking but low-CTR keywords
  const expectedCtr = expectedCtrForKeyword(kw.avgPosition, kw.intent);
  const hasCtrGap = kw.ctr < expectedCtr * 0.5 && kw.impressions > 100;
  if (hasCtrGap) return true;
  // Standard: position > 5 for ranking opportunities
  return kw.avgPosition > 5 && kw.impressions > 30;
})
```

---

### 2.3 `gsc-opportunities.ts` opportunityScore ignores intent — all keywords treated equal

**Severity: 🟡 Warning**

```ts
// src/lib/keywords/gsc-opportunities.ts
const opportunityScore = Math.round(k.impressions * Math.max(0, 1 - ctrDecimal));
```

This formula has no intent weighting. A transactional keyword at position #8 with 200 impressions scores identically to an informational navigational keyword at the same position and volume, even though the transactional one is worth 3–5× more in conversion value. The main `findOpportunities()` in `gsc/index.ts` correctly applies `intentMultiplier` (1.5× transactional, 1.3× commercial) — but `gsc-opportunities.ts` does not, creating inconsistency between the two opportunity panels.

**Fix — mirror the intent multiplier from `gsc/index.ts`:**

```ts
import { classifyIntent } from "@/lib/gsc";

// In getGscOpportunities(), replace the scoring line:
const intent = classifyIntent(k.keyword);
const intentMultiplier =
  intent === "transactional" ? 1.5 :
  intent === "commercial"    ? 1.3 : 1;

const opportunityScore = Math.round(
  k.impressions * Math.max(0, 1 - ctrDecimal) * intentMultiplier
);
```

---

### 2.4 GSC anomaly detection uses a linear array scan — O(n²) at scale

**Severity: 🟡 Warning**

```ts
// src/lib/self-healing/gsc.ts  ─  detectGscAnomalies()
for (const recent of recentData) {
  const prev = previousData.find(   // ← linear scan every iteration
    p => p.url === recent.url && p.keyword === recent.keyword
  );
```

For a site with 10 000 GSC rows (common for any established site), this is 10 000 × 10 000 = 100M comparisons. The weekly cron will timeout or consume excessive memory.

**Fix — build a composite lookup map before the loop:**

```ts
// Before the loop:
const prevMap = new Map<string, typeof previousData[0]>();
for (const p of previousData) {
  prevMap.set(`${p.url}||${p.keyword}`, p);
}

// Inside the loop:
for (const recent of recentData) {
  const prev = prevMap.get(`${recent.url}||${recent.keyword}`);
  // ... rest unchanged
}
```

This reduces complexity to O(n) — the pattern already used correctly in `detectKeywordDecay()` and `buildKeywordTrends()` in `gsc/index.ts`.

---

### 2.5 GSC `dataState: "final"` misses the last 3 days of data everywhere

**Severity: 🟡 Warning**

Every GSC query in the codebase defaults to `dataState: "final"`:

```ts
// src/lib/gsc/index.ts — fetchGSCDecayData()
dataState: "final",

// src/lib/gsc/index.ts — fetchGSCKeywords() default
const { includeDevice = false, dataState = "final" } = options;
```

Google has a 2–3 day reporting lag for `final` data. The anomaly detection code correctly accounts for this with `GSC_LAG_DAYS = 3`, but the main opportunity and ranking functions do not — they query up to today and silently get empty rows for the last 3 days, lowering impression counts and inflating position averages.

**Fix — shift all date windows by the lag:**

```ts
// src/lib/gsc/index.ts — fetchGSCKeywords()
export async function fetchGSCKeywords(
  accessToken: string,
  siteUrl: string,
  days = 90,
  _cacheTtlSeconds?: number,
  options: FetchGSCOptions = {}
): Promise<KeywordRow[]> {
  const GSC_LAG_DAYS = 3;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - GSC_LAG_DAYS);  // ← offset end date
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  // ... rest unchanged
}
```

---

### 2.6 `getKeywordsByPage()` caps each page at 10 keywords — breaks content briefs

**Severity: 🟡 Warning**

```ts
// src/lib/keywords/gsc-keywords-by-page.ts
keywords: sorted.slice(0, 10),
```

When the blog-post generation pipeline uses this to build content briefs, it only sees the top 10 keywords per page. Pages ranking for 40–80 long-tail variants (common for pillar content) will have 30–70 missing secondary keywords, producing thin briefs and missing topical coverage. The `days = 90` default also means newly-published posts with data only in the last 14 days will appear to have no keywords.

**Fix:**

```ts
// Increase cap, make it configurable, and add a short-range fallback:
export async function getKeywordsByPage(
  userId: string,
  domain: string,
  days = 90,
  keywordsPerPage = 25,  // ← increased default, configurable
): Promise<PageKeywords[]> {
  // ... existing logic ...
  keywords: sorted.slice(0, keywordsPerPage),

  // Fallback: if page has < 3 keywords in 90 days, try last 14 days
  // (handles fresh content)
}
```

---

### 2.7 `normaliseSiteUrl()` does not handle `sc-domain:` property type consistently

**Severity: 🟡 Warning**

```ts
// src/lib/gsc/index.ts
export function normaliseSiteUrl(domain: string): string {
  if (domain.startsWith("sc-domain:")) return domain;  // ← correct
  const clean = domain.replace(/\/+$/, "");
  if (clean.startsWith("http")) return `${clean}/`;
  return `https://${clean}/`;                           // ← adds trailing slash
}
```

GSC domain properties (`sc-domain:example.com`) are returned as-is, but prefix-verified properties (`https://example.com/`) require the exact URL including trailing slash. The function handles this — but `refreshCompetitorKeywords()` in `competitors.ts` calls `normaliseSiteUrl(site.domain)` where `site.domain` is stored without the `https://` prefix (e.g. `example.com`). This means all users on domain-verified GSC properties will silently get a 0-row response rather than an error.

**Fix — validate the property exists before querying:**

```ts
// In refreshCompetitorKeywords():
const siteUrl = normaliseSiteUrl(site.domain);
const availableSites = await fetchGSCSites(accessToken);

// Attempt exact match, then sc-domain fallback
const matchedUrl =
  availableSites.find(s => s === siteUrl) ??
  availableSites.find(s => s === `sc-domain:${site.domain}`) ??
  siteUrl; // best-effort

const gscRows = await fetchGSCKeywords(accessToken, matchedUrl, 90, 1000);
```

---

## 3. Keyword SERP Analysis Job — Issues & Fixes

### 3.1 `scrapePageData` failure silently produces empty user page — AI prompt gets no user data

**Severity: 🔴 Critical**

```ts
// keyword-serp-analysis.ts — scrape-authority step
const [userPageResult, ...] = await Promise.all([
  scrapePageData(landingPageUrl).catch(() => ({
    text: "", headings: [], schemaTypes: [], publishedDate: null
  })),
```

If the user's landing page returns a non-2xx response, is behind auth, or takes more than the scraper timeout, `scrapePageData` silently resolves to an empty shell. The AI prompt then receives:

```
USER: url=https://... h2s=[] words=0
```

Gemini sees a blank page and generates generic fixes that don't reference the user's actual content at all — the "heading gaps" section will list every competitor heading as missing, and word count comparison will always flag the user as too short. This produces low-quality, irrelevant output with no user-visible error.

**Fix — persist scrape status and surface it to the user:**

```ts
const userPageResult = await scrapePageData(landingPageUrl)
  .catch(() => null);

const scrapeSuccess = userPageResult !== null && userPageResult.text.length > 200;

await prisma.keywordSerpAnalysis.update({
  where: { id: analysisId },
  data: {
    userPageScrapedOk: scrapeSuccess,   // ← new bool column
    userPageWordCount: scrapeSuccess
      ? userPageResult!.text.split(/\s+/).filter(Boolean).length
      : null,
  },
});

// In the AI prompt, flag explicitly when scrape failed:
const userContext = scrapeSuccess
  ? `url=${landingPageUrl} h2s=${JSON.stringify(userH2s)} words=${userWordCount}`
  : `url=${landingPageUrl} SCRAPE_FAILED — analyse keyword+SERP only, do not reference the user page`;
```

---

### 3.2 SERP analysis cache TTL is 7 days — stale for competitive keywords

**Severity: 🟡 Warning**

```ts
// keyword-serp-analysis.ts — save-and-notify step
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
```

A 7-day cache is fine for low-competition informational keywords but severely outdated for competitive commercial terms where SERP positions shift daily. There's no mechanism to differentiate by volatility — a "best CRM software" analysis from 6 days ago is already stale.

**Fix — apply TTL based on keyword intent and competition level:**

```ts
function serpCacheTtl(intentMismatch: boolean, drGap: number | null): number {
  const MS = 24 * 60 * 60 * 1000;
  if (intentMismatch) return 3 * MS;           // volatile SERPs
  if (drGap !== null && drGap > 40) return 3 * MS; // high-competition
  return 7 * MS;                                // stable/informational
}

const expiresAt = new Date(Date.now() + serpCacheTtl(
  aiResult.intentMismatch,
  authorityComp?.competitors[0]?.drGap ?? null
));
```

---

### 3.3 `getCompetitorAuthorityComparison` result used without null-guard on competitor array

**Severity: 🟡 Warning**

```ts
// keyword-serp-analysis.ts
const top3Avg = authorityComp
  ? authorityComp.competitors.slice(0, 3).reduce((s, c) => s + (c.dr ?? 0), 0) /
    Math.max(1, Math.min(3, authorityComp.competitors.length))
  : 0;
```

`authorityComp.competitors` can be an empty array if the site has no tracked competitors. `Math.max(1, Math.min(3, 0))` returns `1`, so `top3Avg` = `0 / 1 = 0` — this is handled. But three lines earlier:

```ts
const drGap = authorityComp?.competitors[0]?.drGap ?? null;
```

If `competitors` is empty, `competitors[0]` is `undefined` and `?.drGap` safely returns `undefined` — which becomes `null`. Then in `disclaimerNeeded`:

```ts
const disclaimerNeeded = (drGap !== null && drGap > 30) || clientRDs < 10 || ...
```

`drGap` is `null` → first clause is false → disclaimer suppressed even when the user genuinely has no authority data and should be warned. Low risk, but misleading to the user.

**Fix:**

```ts
const drGap = authorityComp?.competitors.length
  ? authorityComp.competitors[0]?.drGap ?? null
  : null;

// In disclaimerNeeded — add no-competitor case:
const disclaimerNeeded =
  (drGap !== null && drGap > 30) ||
  clientRDs < 10 ||
  (rdGapRoot !== null && rdGapRoot > 100) ||
  (authorityComp !== null && authorityComp.competitors.length === 0); // ← new
```

---

### 3.4 Gemini prompt sends raw JSON for top 3 SERP results — expensive tokens, low signal

**Severity: 🟡 Warning**

```ts
// keyword-serp-analysis.ts — ai-fixes step
SERP: ${JSON.stringify(serpResults.slice(0,3).map(r => ({
  pos: r.position, domain: r.domain, wordCount: r.wordCount, h2Count: r.h2Count
})))}
Top H2s: ${JSON.stringify(serpContext.results.slice(0,5).flatMap(r => r.scrapedHeadings ?? []).slice(0,30))}
```

Sending `slice(0,30)` raw heading strings from 5 pages consumes a significant portion of the 3 000-token output budget with noise. Competitor H2s like "Table of Contents", "Related Articles", "About the Author" are included verbatim and often surface as "heading gaps" to fix — creating false positives in the UI.

**Fix — filter headings before sending:**

```ts
const NOISE_HEADINGS = /table of contents|related|about|author|navigation|menu|footer|sidebar|subscribe|sign up|contact|advertisement/i;

const cleanedH2s = serpContext.results
  .slice(0, 5)
  .flatMap(r => r.scrapedHeadings ?? [])
  .filter(h => h.length > 8 && h.length < 80 && !NOISE_HEADINGS.test(h))
  .slice(0, 20); // tighter cap
```

---

## 4. SERP Gap Analysis Pipeline — Issues & Fixes

### 4.1 `analyseSerpGap` only targets position 11+ — misses page-1 content gaps

**Severity: 🔴 Critical**

The `SerpGapDashboard` UI has a `clientPosition` field that the user populates. But the `serp-gap/analyser.ts` design comment says:

```
// Given a keyword where the client is ranking on page 2+ (position 11+)
```

The dashboard does not enforce this constraint on input. If a user enters a keyword where they rank #7, the analyser still scrapes top-5 competitors and produces a gap report — but the recommendations are calibrated for a page-2 catch-up, not a page-1 optimisation. The `estimatedPositionGain` string will also be wildly inaccurate (e.g. "+8 positions" for a #7 → #1 push is both possible and ambitious, whereas the prompt implies the client is far off page 1).

**Fix — add a position-aware analysis mode:**

```ts
// src/lib/serp-gap/analyser.ts
export type AnalysisMode = "page2-catchup" | "page1-climb" | "top3-push";

function resolveAnalysisMode(position: number): AnalysisMode {
  if (position > 10) return "page2-catchup";
  if (position > 3)  return "page1-climb";
  return "top3-push";
}

// Pass mode into gap scoring + plan generator so recommendations
// are calibrated to the actual competitive distance.
```

---

### 4.2 `GapReport` `competitorTopicMap` is computed but never saved — topic map UI cannot render

**Severity: 🔴 Critical**

```ts
// src/lib/serp-gap/analyser.ts  — GapReport interface
competitorTopicMap: {
  topic: string;
  competitorUrls: string[];
  mentionCount: number;
}[];
```

The `serp-gap-analysis.ts` Inngest job saves:

```ts
await prisma.serpGapAnalysis.update({
  data: {
    gapReport: report as object,   // ← includes competitorTopicMap
    implementationPlan: plan as object,
    // ... scalar fields only
  },
});
```

The full `gapReport` JSON blob is persisted, so `competitorTopicMap` survives — but the Prisma schema has no dedicated column for it, and the dashboard's type definition for `FullAnalysis` does not include `competitorTopicMap` in `gapReport`. This means even if the analyser populates it, the TypeScript interface strips it before the UI sees it.

**Fix — add to the `FullAnalysis` interface and surface it in the UI:**

```ts
// src/app/dashboard/serp-gap/SerpGapDetail.tsx — FullAnalysis interface
gapReport: {
  gaps: ContentGap[];
  serpFormat: string;
  serpHasAiOverview: boolean;
  serpHasFeaturedSnippet: boolean;
  topCompetitorAvgWordCount: number;
  clientSignals: { wordCount: number };
  rankingTimelineNote: string | null;
  competitorTopicMap: {          // ← add this
    topic: string;
    competitorUrls: string[];
    mentionCount: number;
  }[];
} | null;
```

---

### 4.3 Credit deduction happens inside the Inngest job — refund path doesn't exist on failure

**Severity: 🔴 Critical**

```ts
// serp-gap-analysis.ts — verify-and-deduct-credits step
const creditResult = await consumeCredits(userId, "serp_gap_analysis");
if (!creditResult.allowed) {
  await prisma.serpGapAnalysis.update({ data: { status: "FAILED" } });
  throw new NonRetriableError("Insufficient credits");
}
```

Credits are consumed in step 1. If Serper returns no results (step 2) or Gemini fails (step 3), the job throws — but there is no compensating step to refund the credits. Users lose 5 credits for a failed analysis with no way to recover them from the UI.

**Fix — use a two-phase commit pattern:**

```ts
// Step 1: reserve credits (mark as pending, don't deduct yet)
await reserveCredits(userId, "serp_gap_analysis", analysisId);

// ... steps 2 & 3 ...

// Step 4 (save-completed-analysis): commit the deduction only on success
await commitCreditReservation(analysisId);

// In the outer catch block:
} catch (error) {
  await refundCreditReservation(analysisId); // always runs on failure
  throw error;
}
```

If a full reservation system is too complex short-term, at minimum add a refund in the catch block:

```ts
} catch (error: unknown) {
  await refundCredits(userId, "serp_gap_analysis").catch(() => {});
  // ... existing error handling
  throw error;
}
```

---

## 5. Competitor Page Analysis — Issues & Fixes

### 5.1 `refreshCompetitorKeywords` deletes all old keywords before fetching new ones — race window leaves competitor with zero keywords

**Severity: 🔴 Critical**

```ts
// src/app/actions/competitors.ts
// Clear old keywords
await prisma.competitorKeyword.deleteMany({ where: { competitorId } });

// Save gaps enriched with real GSC data where available
if (gaps.length > 0) {
  await prisma.competitorKeyword.createMany({ data: gaps.map(...) });
}
```

Between the `deleteMany` and `createMany` there is a window where the competitor has zero keywords. If a user or cron job reads `competitors.keywords` during this window (e.g. the Competitor Dashboard renders while refresh is in progress), the table shows an empty keyword list. If `fetchCompetitorIntelligence` or `fetchCompetitorKeywordGaps` throws after the delete, the `catch` block does not restore the old keywords — the competitor is left permanently empty until the next manual refresh.

**Fix — use a transaction with upsert pattern:**

```ts
await prisma.$transaction(async (tx) => {
  // Mark new keywords with a refreshId
  const refreshId = crypto.randomUUID();
  await tx.competitorKeyword.createMany({
    data: gaps.map(gap => ({ ...gap, refreshId })),
  });
  // Only delete the old rows after new ones are written
  await tx.competitorKeyword.deleteMany({
    where: { competitorId, refreshId: { not: refreshId } },
  });
});
```

Alternatively, add a `refreshId` column and filter queries to the latest refresh batch — no delete needed.

---

### 5.2 Competitor page scraping has no User-Agent rotation — high bot-detection rate

**Severity: 🟡 Warning**

```ts
// src/lib/competitors/page-fetcher.ts  (inferred from pipeline)
// src/lib/blog/serp.ts  — scrapePageData()
```

Both the SERP gap analyser and the competitor intelligence engine scrape live pages. Without User-Agent rotation, Cloudflare and similar protections return 403/429 responses within minutes of the cron trigger. The `scrapePageData` catch block silently returns `{ text: "", headings: [] }` — the scrape fails invisibly.

**Fix — rotate User-Agents and add jitter between requests:**

```ts
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchPage(url: string): Promise<Response> {
  const delay = 800 + Math.random() * 1200; // 0.8–2s jitter
  await new Promise(r => setTimeout(r, delay));
  return fetch(url, {
    headers: {
      "User-Agent": randomUA(),
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(8_000),
  });
}
```

---

### 5.3 `buildClusters()` in `CompetitorsDashboard.tsx` uses first 2 words only — poor grouping

**Severity: 🟡 Warning**

```ts
// src/app/dashboard/competitors/CompetitorsDashboard.tsx
function buildClusters(keywords: KW[]): Cluster[] {
  const map = new Map<string, KW[]>();
  for (const kw of keywords) {
    const words = kw.keyword.toLowerCase().split(/\s+/);
    const key = words.slice(0, Math.min(2, words.length)).join(" "); // ← 2 words only
```

"best crm software", "best crm for startups", and "best crm tools" all cluster under "best crm" — correct. But "crm software comparison", "crm software free", "crm software pricing" cluster under "crm software" while "best crm" clusters separately — these are the same topic. The UI's topic clusters therefore fragment related keywords instead of consolidating them.

**Fix — use the same `clusterKey()` function already in `gsc/index.ts`:**

```ts
// Import the existing utility instead of duplicating logic:
import { clusterKey } from "@/lib/gsc";

function buildClusters(keywords: KW[]): Cluster[] {
  const map = new Map<string, KW[]>();
  for (const kw of keywords) {
    const key = clusterKey(kw.keyword); // ← uses stop-word removal + 3-token key
    // ... rest unchanged
  }
```

---

### 5.4 CTR curve in `competitors/index.ts` diverges from `gsc/index.ts` — two sources of truth

**Severity: 🟡 Warning**

```ts
// src/lib/competitors/index.ts
export const CTR_CURVE: Record<number, number> = {
  1: 0.278, 2: 0.154, 3: 0.113, 4: 0.082, 5: 0.062, ...
};

// src/lib/gsc/index.ts
const BASE_CTR_BY_POSITION: Record<number, number> = {
  1: 28, 2: 15, 3: 11, 4: 8, 5: 7, ...
};
```

Two separate CTR curves exist — one as a decimal (competitors), one as a percentage (gsc). Both are module-private except `CTR_CURVE` which is exported. The values differ slightly (position #2: `0.154` vs `0.15`; position #5: `0.062` vs `0.07`). Opportunity scores computed in the GSC panel and click estimates shown in the Competitors panel will produce inconsistent numbers for the same keyword.

**Fix — export a single canonical curve from `gsc/index.ts` and import it everywhere:**

```ts
// src/lib/gsc/index.ts — export as decimal
export const CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.07,
  6: 0.05, 7: 0.04, 8: 0.03, 9: 0.025, 10: 0.02,
};
export const CTR_FALLBACK = 0.015;

// src/lib/competitors/index.ts — remove local curve, import instead:
import { CTR_BY_POSITION, CTR_FALLBACK } from "@/lib/gsc";
export const CTR_CURVE = CTR_BY_POSITION; // re-export for back-compat
```

---

## 6. Quick Wins

These can each be done in under 2 hours and have immediate user-visible impact.

| # | What | File | Impact |
|---|------|------|--------|
| QW-1 | Add `OPPORTUNITY_MIN_POSITION = 1` and split filter by type | `gsc/index.ts` | More opportunities surface in the panel |
| QW-2 | Build `prevMap` in `detectGscAnomalies` | `self-healing/gsc.ts` | Fix O(n²) weekly cron, prevent timeouts |
| QW-3 | Filter noise headings before Gemini prompt | `keyword-serp-analysis.ts` | Fewer false "heading gap" recommendations |
| QW-4 | Add `GSC_LAG_DAYS = 3` offset to `fetchGSCKeywords` | `gsc/index.ts` | Accurate impression counts, no trailing zeros |
| QW-5 | Import `clusterKey` from `gsc/index.ts` in CompetitorsDashboard | `CompetitorsDashboard.tsx` | Cleaner keyword clusters |
| QW-6 | Export single `CTR_BY_POSITION` from `gsc/index.ts` | `gsc/index.ts` + `competitors/index.ts` | Consistent click estimates across all panels |

---

## 7. Prioritised Roadmap

### Sprint 1 — Data Integrity (Week 1)

**Goal:** Stop returning zeros for fields that have data.

- [ ] Add 8 missing columns to `KeywordSerpAnalysis` schema + migration
- [ ] Persist all computed fields in the `save-and-notify` step
- [ ] Update `toResult()` and the status route to read from DB
- [ ] Add `userPageScrapedOk` column + surface scrape failure in UI badge

**Estimated effort:** 1 day backend, 0.5 day migration

---

### Sprint 2 — Reliability (Week 1–2)

**Goal:** Stop silent failures from producing wrong data.

- [ ] Transaction-wrap `deleteMany` + `createMany` in competitor refresh
- [ ] Add credit refund in `serp-gap-analysis.ts` catch block
- [ ] Fix O(n²) scan in anomaly detection
- [ ] Apply `GSC_LAG_DAYS` offset to all GSC date windows
- [ ] Add User-Agent rotation + jitter to page scraper

**Estimated effort:** 2 days

---

### Sprint 3 — Quality (Week 2–3)

**Goal:** Better recommendations, fewer false positives.

- [ ] Apply intent multiplier in `gsc-opportunities.ts`
- [ ] Filter noise headings before Gemini prompt
- [ ] Add position-aware analysis mode to SERP gap analyser
- [ ] Increase `getKeywordsByPage` cap to 25, make configurable
- [ ] Export single canonical CTR curve from `gsc/index.ts`

**Estimated effort:** 2–3 days

---

### Sprint 4 — New Capabilities (Week 3–4)

**Goal:** Surface data that's already being computed but not shown.

- [ ] Add `competitorTopicMap` to `FullAnalysis` interface + UI card
- [ ] Add dynamic SERP cache TTL based on intent + competition
- [ ] Validate GSC property type before querying (handle `sc-domain:` mismatch)
- [ ] Replace 2-word cluster key in CompetitorsDashboard with `clusterKey()`
- [ ] Import `CTR_CURVE` from single source in competitors engine

**Estimated effort:** 2 days

---

*Generated from static analysis of `aiseo2_fixed_3.zip` — commit unknown.*