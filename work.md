# Keyword Ranking Report — Full Feature Spec
## Combining SERP Analysis + Backlink Intelligence

---

## What This Does (and Why It's Different Now)

The previous spec treated backlinks as a gap. They're not — **they're already in the app**.
DataForSEO powers the backlink layer. The app already has:

- `getBacklinkSummary(domain)` — total backlinks, referring domains, Domain Rating, new/lost last week, toxic count
- `getCompetitorBacklinkGap(yourDomain, competitorDomain)` — side-by-side gap + opportunity domains list
- `getCompetitorAuthorityComparison(siteId)` — DR comparison against all tracked competitors from stored snapshots
- `analyseToxicity(links)` — three-rule toxic detection (exact-match anchor, DR < 5 spam, toxic keywords)
- `BacklinkGapReport` — full typed struct with `gap.opportunityDomains` sorted by DR descending

This means the ranking report can give a **complete, honest diagnosis** for every keyword — not just "your content is thin" but "your content is thin AND your page has zero referring domains while the #1 result has 847". That's a fundamentally more useful output for client work.

---

## Revised Panel Structure

When a user clicks **"Analyse vs SERP"** on any keyword row, the panel opens with **four tabs** instead of three:

```
[ SERP Comparison ]  [ Fix Suggestions ]  [ Heading Gaps ]  [ Link Authority ]
```

The fourth tab is entirely powered by existing backlink infrastructure. No new API integrations needed.

---

## Tab 1 — SERP Comparison

### Metrics Bar (5 cards)

---

**Card: Your Position**
- Value: current GSC position, e.g. `#87`
- Subtext: `Page 9`
- Colour: red > 20, amber 11–20, blue 4–10, green 1–3

---

**Card: Content Gap**
- Value: word count delta, e.g. `−1,250 words`
- Subtext: `Avg top-10: 2,140 · Your page: 890`
- Colour: red if your page is more than 40% below average, amber if 20–40%, green if within 20%

---

**Card: Domain Rating vs Top 3**
- Value: your DR vs average DR of top 3 ranking pages, e.g. `DR 28 vs DR 74`
- Subtext: `Gap: −46` shown in red if gap > 20, amber if 10–20, green if ≤ 10
- Source: `getCompetitorAuthorityComparison(siteId)` — reads from stored snapshots, zero API cost

---

**Card: Referring Domains to This Page**
- Value: number of referring domains pointing to the specific landing page URL (not the root domain), e.g. `3 RDs`
- Subtext: `Top-3 avg: 124 RDs`
- Source: `getBacklinkDetails(domain)` filtered to `targetUrl === landingPageUrl`
- Colour: red if your page RDs < 10% of top-3 average

---

**Card: CTR Potential**
- Value: estimated gain if page reached position 1–3, e.g. `+28%`
- Subtext: `If top 3`
- Calculation: `(impressions × 0.278 − clicks) / impressions`

---

### SERP Results List

Each of the top 10 results rendered as a card:

---

**Competitor result card**

```
#1  ahrefs.com                                           DR 89 · 847 RDs to page
    10 Clearscope Alternatives for Content Optimization (2025)
    We tested 10 tools. Surfer SEO and Frase top our list…

    [ 2,800 words ]  [ List article ]  [ 12 H2s ]
```

Fields:
- `position` — coloured badge (green ≤ 3, blue ≤ 10, amber ≤ 20, red > 20)
- `domain` — bare hostname in muted text
- `DR` — Domain Rating pulled from DataForSEO for the competitor's root domain
- `RDs to page` — referring domains pointing to the specific result URL (scraped from DataForSEO or estimated)
- `title` — full page title from SERP
- `snippet` — Google snippet, truncated ~160 chars
- `word count` — scraped via Cheerio
- `content type` — Claude-inferred: List article / Comparison / Review listing / Guide / Tool page
- `H2 count` — number of H2 headings found on the page

---

**Your page card (highlighted)**

Same fields as above, but:
- Amber border
- Badge: `Your page`
- All metrics shown in context — e.g. word count in amber if below average, RDs in red if far below top-3
- If not in top 10: shown below the list with label `Your page (position #87, not in top 10)`

---

## Tab 2 — Fix Suggestions

AI-generated, prioritised fix cards. Each card references real data from both the SERP and backlink layers so fixes are specific — not generic SEO advice.

Cards ordered High → Medium → Low.

---

### Fix Card Structure

```
[ Priority ]  [ Icon ]  Fix title — specific and data-referenced

              Description: 1–2 sentences. References actual numbers, URLs,
              or competitor names pulled from the combined analysis.

              [ Quick action button if applicable ]
```

---

### Example Cards — Content Fixes

---

**Card: High priority — content length**

```
[ High ]  📄  Page is 1,250 words below the top-3 average

          Your /vs/clearscope page has ~890 words. The three pages outranking
          you average 2,140 words. Priority sections to add: pricing comparison
          table, "who is it best for?" verdict, free trial information, FAQ.
```

---

**Card: High priority — intent mismatch**

```
[ High ]  🎯  Search intent mismatch — top results are listicles, yours is a comparison

          9 of 10 results are "X alternatives to Clearscope" roundups covering
          5–10 tools. Your page compares Clearscope vs OptimAI only. Google is
          surfacing list intent for this keyword. Either broaden to a roundup
          or target a more specific comparison keyword like "clearscope vs optimai".
```

---

**Card: High priority — title framing**

```
[ High ]  📋  "alternatives" missing from title and H1

          Every top-10 result includes "alternatives" or "competitors" in the
          title tag. Your H1 reads "Clearscope vs OptimAI — Feature Comparison".
          Reframe to match navigational intent.
```

---

### Example Cards — Authority / Backlink Fixes

---

**Card: High priority — page-level authority gap**

```
[ High ]  🔗  This specific page has 3 referring domains; top-3 average is 124

          Content improvements alone are unlikely to close a gap this large.
          The #1 result (ahrefs.com/blog/clearscope-alternatives) has 847 RDs.
          Your domain's DR (28) is also 46 points below the top-3 average (74).
          See the Link Authority tab for outreach targets already identified
          in your competitor gap report.

          [ Go to Link Authority tab → ]
```

---

**Card: Medium priority — internal linking**

```
[ Medium ]  🔀  No internal links from high-traffic pages to /vs/clearscope

            Your homepage and /blog index have strong internal PageRank but
            don't link to this comparison page. Adding 2–3 contextual internal
            links from posts about "content optimisation tools" or "SEO writing"
            would pass authority to this page at zero cost.
```

---

**Card: Medium priority — heading gaps**

```
[ Medium ]  🔤  6 H2 topics in top results are missing from this page

            "Pricing comparison", "Who is it for?", "Free trial options",
            "AI writing features", "Final verdict", "FAQ". See the Heading
            Gaps tab for full breakdown with frequency data.

            [ Go to Heading Gaps tab → ]
```

---

**Card: Medium priority — anchor text**

```
[ Medium ]  ⚓  Your 3 referring domains all use branded anchor text

            "OptimAI", "OptimAI review", "OptimAI tool" — none reference
            "clearscope alternative" or similar. When doing outreach, request
            keyword-rich anchors for this page specifically, not just brand links.
```

---

**Card: Low priority — FAQ / PAA**

```
[ Low ]  ❓  4 People Also Ask questions not answered on this page

         "Is Clearscope worth it?", "What is cheaper than Clearscope?",
         "Does Clearscope have a free trial?", "How does Clearscope score content?"
         Adding a FAQ section targeting these could capture featured snippet
         positions and improve engagement time.
```

---

**Card: Low priority — schema**

```
[ Low ]  🏷️  No FAQ or Comparison schema detected

         Top-ranking pages use FAQPage and ItemList schema. Adding structured
         data won't directly boost rankings but increases rich result eligibility
         and click-through rate.
```

---

### Fix Card Priority Rules

| Priority | When applied |
|----------|-------------|
| High | Backlink/authority gap > 30 RDs or DR gap > 20; intent mismatch; word count > 40% below average |
| Medium | Internal linking gaps; anchor text diversity issues; heading gaps (3+ missing); meta issues |
| Low | Schema, FAQ, PAA, image alt text, minor structural issues |

---

### Fix Card — Authority Gap Threshold Logic

The authority gap card priority escalates based on the severity of the RD gap:

- RD gap < 20 → Low priority (content fixes will likely be enough)
- RD gap 20–100 → Medium priority (content + internal links + some outreach)
- RD gap > 100 → High priority (explicit warning: content fixes alone won't close this)
- DR gap > 30 AND RD gap > 50 → High priority + disclaimer card explaining the timeline reality

---

### Disclaimer Card (shown when authority gap is severe)

```
ℹ️  Ranking timeline note

    The domain authority and page-level link gap for this keyword is significant.
    Content fixes are still worthwhile and will improve quality signals, but
    closing a 100+ RD gap typically takes 3–6 months of consistent outreach.
    Set realistic expectations with your client before starting.
```

This card is always shown (not flagged as high/medium/low) when `gap.referringDomains > 100` or `gap.domainRating > 30`. It is the most important card for client communication — prevents overpromising.

---

## Tab 3 — Heading Gaps

Unchanged from previous spec. Semantic H2/H3 topic comparison between top-10 results and the user's page.

```
Topic / H2 heading (top results)    | Freq in top 10 | Your page
------------------------------------|----------------|----------
Pricing comparison                  | 9/10           | ✗ Missing
Who is it best for?                 | 8/10           | ✗ Missing
Free trial / free plan              | 7/10           | ✗ Missing
AI writing features                 | 6/10           | ✗ Missing
Integrations (Google Docs, WP)      | 5/10           | ✓ Covered
Final verdict / recommendation      | 9/10           | ✗ Missing
Content editor comparison           | 7/10           | ✓ Covered
Keyword grading / NLP               | 6/10           | ✓ Covered
```

- Sorted by frequency descending
- Topics are semantically clustered by Claude (not exact H2 string match)
- `✓ Covered` — green · `✗ Missing` — red

---

## Tab 4 — Link Authority (New)

Entirely powered by existing backlink infrastructure. No new API calls beyond what already runs.

---

### Section 1: Authority Comparison (3 cards)

---

**Card: Your Domain Rating**
- Value: your DR, e.g. `DR 28`
- Subtext: `Top-3 avg: DR 74 · Gap: −46`
- Source: `getCompetitorAuthorityComparison(siteId)` — reads from stored Ahrefs snapshots, zero extra cost
- Colour: red if gap > 30, amber if 15–30, green if ≤ 15

---

**Card: Referring Domains (Root Domain)**
- Value: your total referring domains, e.g. `412 RDs`
- Subtext: `Top-3 competitor avg: 2,840 RDs`
- Source: `BacklinkSummary.referringDomains` from `getBacklinkSummary(domain)`

---

**Card: Page-Level RDs**
- Value: referring domains pointing to the specific ranking page URL, e.g. `3 RDs`
- Subtext: `Top-3 avg: 124 RDs to their page`
- Source: `getBacklinkDetails(domain)` filtered by `targetUrl === landingPageUrl`
- Note: this is the most important card — root domain RDs don't directly help a specific page

---

### Section 2: Backlink Profile Health (3 cards)

---

**Card: Toxic Backlinks**
- Value: count of toxic links, e.g. `7 toxic`
- Subtext: `Of 412 total referring domains`
- Source: `BacklinkSummary.toxicCount` from DB count (no DataForSEO cost)
- Colour: red if toxic% > 5%, amber if 2–5%, green if < 2%
- Note shown if toxic count > 10: "Toxic links may be suppressing rankings. Consider a disavow file."

---

**Card: New vs Lost (Last 7 Days)**
- Value: `+12 new · −3 lost`
- Source: `BacklinkSummary.newLastWeek` and `lostLastWeek`
- Colour: green if net positive, red if net negative

---

**Card: Dofollow Ratio**
- Value: e.g. `68% dofollow`
- Source: `QualitySummary.doFollow / QualitySummary.total`
- Subtext: healthy range is typically 50–80%

---

### Section 3: Outreach Opportunity Table

Pulled directly from `BacklinkGapReport.gap.opportunityDomains` — already computed by `getCompetitorBacklinkGap()`.

```
Domain                  | DR  | Links to Competitor | Status
------------------------|-----|---------------------|--------
searchenginejournal.com | 88  | 3                   | Opportunity
moz.com/blog            | 91  | 1                   | Opportunity
backlinko.com           | 87  | 2                   | Opportunity
semrush.com/blog        | 85  | 5                   | Opportunity
...
```

- Sorted by DR descending (highest authority first — already the sort order in `opportunityDomains`)
- Shows up to 20 rows (the `maxOpportunities` default in `getCompetitorBacklinkGap`)
- "Status" column: always "Opportunity" in MVP; can expand to "In progress / Won" in future
- Table header note: `Domains that link to [competitor] but not to you — sorted by authority`

---

### Section 4: Top Anchor Text

Small table showing the client's current anchor text distribution:

```
Anchor text          | Count | Type
---------------------|-------|----------
optimai              | 18    | Brand
optimai review       | 7     | Brand
seo tool             | 4     | Partial match
click here           | 3     | Generic
clearscope alt...    | 1     | Keyword match   ← want more of these
```

- Source: `BacklinkSummary.topAnchors` — already returned by DataForSEO
- "Type" column: Claude-inferred from anchor text (brand / keyword match / partial match / generic / naked URL)
- Highlight in amber: if keyword-match anchors for the target keyword are < 10% of total
- Note shown: "For this keyword, request anchors like 'clearscope alternative' or 'clearscope vs X' in outreach"

---

## Data Flow — What Calls What

```
analyseKeywordVsSerp(siteId, keyword, landingPageUrl)
│
├── DB cache check (KeywordSerpAnalysis table)
│   └── If fresh hit → return immediately
│
├── fetchSerpContext(keyword)                     [existing — src/lib/blog/serp.ts]
│   ├── Serper API → top-10 results
│   └── Cheerio scrape → word count, H2s, schema types per result
│
├── scrapeUserPage(landingPageUrl)                [existing Cheerio scraper]
│   └── title, H1, H2s, word count, meta description
│
├── getCompetitorAuthorityComparison(siteId)      [existing — src/lib/seo/competitor-authority.ts]
│   └── DB snapshots — zero DataForSEO cost
│
├── getBacklinkSummary(clientDomain, siteId)      [existing — src/lib/backlinks/index.ts]
│   ├── DataForSEO (Redis-cached 24h)
│   └── DB toxic count (always fresh, no API cost)
│
├── getCompetitorBacklinkGap(                     [existing — src/lib/backlinks/index.ts]
│     clientDomain,
│     topRankingDomain   ← domain of #1 SERP result
│   )
│   └── opportunityDomains — referring domains to outreach
│
└── Claude structured output call
    ├── Input: SERP context + user page data + backlink gap metrics
    └── Output: fixes[], headingGaps[], intentMismatch, disclaimerNeeded
```

---

## Claude Prompt — Updated for Backlink Awareness

```
You are an SEO analyst. Given the combined SERP, content, and backlink data below,
return a JSON object matching this exact shape — no markdown, no prose:

{
  fixes: {
    title: string,
    description: string,         // must reference actual numbers from the data
    priority: "high" | "medium" | "low",
    category: "content" | "structure" | "intent" | "links" | "authority" | "schema",
    linkToTab: "heading-gaps" | "link-authority" | null
  }[],
  headingGaps: {
    topic: string,
    freqInTop10: number,
    coveredOnYourPage: boolean
  }[],
  wordCountAvgTop10: number,
  wordCountYourPage: number,
  intentMismatch: boolean,
  intentNote: string | null,
  contentTypeTop10: string,
  disclaimerNeeded: boolean      // true if rdGap > 100 OR drGap > 30
}

Rules:
- fixes: max 7 items, ordered high → medium → low
- Every fix description must reference actual numbers (word counts, DR values, RD counts,
  competitor names) from the data provided — no generic advice
- If rdGap > 100 or drGap > 30, set disclaimerNeeded: true and include a HIGH priority
  authority fix card explaining the timeline reality
- headingGaps: semantic clustering only — de-duplicate, include topics appearing in ≥ 3/10 results
- linkToTab: set to "link-authority" for any authority/backlink fix, "heading-gaps" for
  content structure fixes, null otherwise

SERP DATA:
{{serpContext}}

USER PAGE DATA:
Title: {{pageTitle}}
H1: {{pageH1}}
H2s: {{pageH2s}}
Word count: {{pageWordCount}}
Meta: {{pageMetaDesc}}

BACKLINK DATA (client):
Domain Rating: {{clientDR}}
Referring Domains (root): {{clientRDs}}
Referring Domains (this page): {{pageRDs}}
Toxic backlinks: {{toxicCount}}
Top anchors: {{topAnchors}}

BACKLINK GAP (client vs #1 result):
DR gap: {{drGap}}
RD gap (root domain): {{rdGapRoot}}
RD gap (this page vs #1 page): {{rdGapPage}}
Opportunity domains (top 5): {{opportunityDomains}}
```

---

## Files to Create or Modify

### New: `src/app/actions/serp-analysis.ts`

Server action. Orchestrates the full pipeline:
1. DB cache check
2. `fetchSerpContext(keyword)` — Serper + Cheerio
3. `scrapeUserPage(landingPageUrl)` — Cheerio only
4. `getCompetitorAuthorityComparison(siteId)` — DB snapshots, free
5. `getBacklinkSummary(domain, siteId)` — DataForSEO (cached)
6. `getCompetitorBacklinkGap(domain, serpResult[0].domain)` — DataForSEO (cached)
7. Claude call with structured prompt
8. Write to `KeywordSerpAnalysis` with 7-day TTL

---

### New: `src/components/dashboard/KeywordSerpPanel.tsx`

Four-tab panel component. Props:

```ts
interface KeywordSerpPanelProps {
  keyword: string;
  position: number;
  impressions: number;
  clicks: number;
  landingUrl: string;
  siteId: string;
}
```

Internal state: `activeTab`, `data: SerpAnalysisResult | null`, `loading`, `error`, `cachedAt`.

---

### Edit: `src/app/dashboard/keywords/AllKeywordsTable.tsx`

- Add `expandedRow: string | null` state
- Add "Analyse" column (header + cells)
- Render `<KeywordSerpPanel>` when row is expanded

---

### New: Prisma migration — `KeywordSerpAnalysis`

```prisma
model KeywordSerpAnalysis {
  id                String   @id @default(cuid())
  siteId            String
  keyword           String
  landingUrl        String
  serpResults       Json
  fixes             Json
  headingGaps       Json
  wordCountAvg      Int
  wordCountPage     Int
  drGap             Int?
  rdGapRoot         Int?
  rdGapPage         Int?
  opportunityDoms   Json
  intentMismatch    Boolean  @default(false)
  intentNote        String?
  disclaimerNeeded  Boolean  @default(false)
  createdAt         DateTime @default(now())
  expiresAt         DateTime

  @@unique([siteId, keyword])
  @@index([siteId])
}
```

---

## Cost Per Analysis

| Step | Cost | Notes |
|------|------|-------|
| Serper search | ~1 credit | Cached at DB level (7-day TTL) |
| Page scrapes (top 3) | Free | Cheerio HTTP fetch |
| `getBacklinkSummary` | DataForSEO credit | Redis-cached 24h — likely already warm |
| `getCompetitorBacklinkGap` | DataForSEO credit | Redis-cached — likely already warm for tracked competitors |
| `getCompetitorAuthorityComparison` | Free | DB snapshots only |
| Claude call | ~3K tokens in / ~1K out | Negligible |

After first fetch, repeat opens cost nothing (DB cache). The heaviest cost is when the competitor in position #1 is not already a tracked competitor — that triggers a fresh DataForSEO `referring-domains` call.

**Mitigation:** Only call `getCompetitorBacklinkGap` if the `#1 SERP domain` is in `site.competitors`. If not, fall back to DR-only comparison from `getCompetitorAuthorityComparison`. Show a note: "Add [domain] as a competitor to unlock full link gap analysis."

---

## What This Report Tells a Client That Others Don't

Most SEO tools show content gaps OR backlink gaps — separately. This panel shows both **for a specific keyword and its specific ranking page**, with a single prioritised action list that tells the client clearly:

- Whether content fixes are enough (small authority gap → yes)
- Whether outreach is needed (large RD gap → yes, here are the targets)
- Whether the keyword is worth pursuing at all right now (DR gap > 40 with 100+ RD gap → be honest about the timeline)
- Exactly which H2s to add, which anchors to request in outreach, and which internal pages to link from

That combination — and the disclaimer card when the gap is severe — is what makes it genuinely useful for client work rather than just another content brief tool.

---

## Out of Scope (Future)

- "Apply fix" button → opens blog editor pre-filled with missing H2 sections
- Outreach CRM — track status of opportunity domains (contacted / won / declined)
- Scheduled re-analysis — weekly cron to re-run expired analyses and notify on position changes
- Export to PDF for client reporting
- Multi-keyword comparison — run analysis across all page-2 keywords at once and rank by easiest win