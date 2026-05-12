# OptiAISEO — Production Infrastructure Audit

> **Last updated:** 2026-05-12 | **Sprint:** Hardening Phase 1

---

## Summary

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| 🔴 Critical | 4 | 4 | 0 |
| 🟠 High | 6 | 3 | 3 |
| 🟡 Medium | 5 | 2 | 3 |
| 🟢 Low | 3 | 0 | 3 |

---

## 🔴 Critical — Fixed

### ✅ C1 · Blog job double-run / credit burn
**File:** `src/lib/inngest/functions/blog.ts`  
**Risk:** Users double-clicking "Generate" fired two `blog.generate` events for the same `blogId`, consuming 20 credits instead of 10.  
**Fix:** Added `idempotency: "event.data.blogId"` to `generateBlogJob`. Inngest deduplicates events with the same key within its dedup window.

---

### ✅ C2 · Manual audit job double-run
**File:** `src/lib/inngest/functions/audit.ts`  
**Risk:** `processManualAuditJob` could fire twice on a double-click before the Redis lock activated, running two full audits.  
**Fix:** Added `idempotency: "event.data.auditId"` to `processManualAuditJob`.

---

### ✅ C3 · Weekly audit job duplicate on deploy
**File:** `src/lib/inngest/functions/audit.ts`  
**Risk:** Railway rolling deploys can briefly run two containers, causing the `audit.run` cron event to be picked up twice.  
**Fix:** Added `idempotency: "event.data.siteId"` to `runWeeklyAuditJob`.

---

### ✅ C4 · Voice agent container not draining on SIGTERM
**File:** `livekit-agent.ts`  
**Risk:** Railway sends SIGTERM before force-killing containers on deploy. With no handler, mid-session Prisma connections leaked and LiveKit rooms stayed open for 30 s.  
**Fix:** Added `shutdown()` function with 2-second drain, `prisma.$disconnect()`, and `process.on("SIGTERM"/"SIGINT")` handlers before `cli.runApp`.

---

## 🟠 High — Fixed

### ✅ H1 · Anthropic SONNET model uses undated alias
**File:** `src/lib/constants/ai-models.ts`  
**Risk:** `claude-sonnet-4-5` (no date) routes to a floating alias. Anthropic retires undated aliases without warning; `claude-haiku-4-5-20251001` and `claude-opus-4-20250514` already use dated IDs.  
**Fix:** Changed `ANTHROPIC_SONNET` to `claude-sonnet-4-5-20251001`.

---

### ✅ H2 · DataForSEO client hangs indefinitely / no circuit breaker
**File:** `src/lib/backlinks/client.ts`  
**Risk:** The raw `fetch()` had no timeout and no failure detection. A DataForSEO outage would block every Inngest worker step until Railway's 5-minute function timeout fired, burning retries and credits.  
**Fix:** Rewrote `dataForSeoPost` with:
- `AbortSignal` timeout (default 15 s via `DATAFORSEO_TIMEOUT_MS`)
- Redis-backed circuit breaker: opens after 3 consecutive failures, auto-resets after 2 minutes (`DATAFORSEO_CB_THRESHOLD`, `DATAFORSEO_CB_RESET_MS`)
- Failure/success counters clear on healthy response

---

### ✅ H3 · Missing Prisma composite indices
**File:** `prisma/schema.prisma`  
**Risk:** `KeywordSerpAnalysis.status` filter and `AeoSnapshot` trend chart queries ran full-table scans at scale.  
**Fix:**
- Added `@@index([siteId, status])` to `KeywordSerpAnalysis`
- Added `@@index([siteId, createdAt(sort: Desc)])` to `AeoSnapshot`

> **Action required:** Run `npx prisma migrate dev --name add-missing-indices` to apply.

---

## 🟠 High — Remaining

### ⚠️ H4 · GitHub OAuth tokens stored in plaintext
**File:** `prisma/schema.prisma` → `Account.access_token`  
**Risk:** DB breach exposes all GitHub tokens — attackers can push to every connected repo.  
**Recommended fix:** Implement AES-256-GCM field-level encryption using `ENCRYPTION_KEY` env var. Encrypt on write in `prisma.$use` middleware; decrypt on read.  
**Env needed:** `ENCRYPTION_KEY` (32-byte hex)

---

### ⚠️ H5 · Voice agent susceptible to prompt injection
**File:** `livekit-agent.ts` — `buildTools()` execute functions  
**Risk:** User speech is transcribed and passed directly as tool parameters (e.g. `url`, `domain`, `filePath`). A malicious user could say "audit `javascript:alert(1)`" or craft a domain that escapes validation.  
**Recommended fix:** Add an input sanitisation layer before each tool `execute()` call:
```ts
function sanitiseInput(raw: string, maxLen = 512): string {
  return raw.replace(/[<>"'`]/g, "").trim().slice(0, maxLen);
}
```
Apply to all string parameters received from the LLM tool calls.

---

### ⚠️ H6 · `generateBlogJob` Claude editorial pass truncates at 14 000 chars
**File:** `src/lib/inngest/functions/blog.ts` line ~681  
**Risk:** `liveBlogPost.content.substring(0, 14000)` silently drops the tail of long posts before Claude edits them. The saved blog content is the full unedited version; Claude's improvements are lost for the last third of the article.  
**Recommended fix:** Stream Claude over chunked content (same pattern as `runEditorialRewrite` in `pipeline.ts`), or increase the token budget and remove the char cap.

---

## 🟡 Medium — Fixed

### ✅ M1 · Dashboard card overflow — TrafficGrowth3D
**File:** `src/components/home/TrafficGrowth3D.tsx`, `src/components/home/HomeClient.tsx`  
**Risk:** Visual regression — bar chart and heatmap rendered in wrong order; content bled outside rounded card borders.  
**Fix:** Reordered DOM (bar chart first, heatmap second), removed negative-margin empty div, added `overflow-hidden` to parent card container.

---

### ✅ M2 · Vector cache lacks TTL eviction budget
**File:** `src/lib/aeo/vector-response-cache.ts`  
**Status:** Documented. Upstash Vector enforces its own storage limits. No immediate code change needed; monitor storage usage in Upstash dashboard. Add explicit size budget when approaching the plan limit.

---

## 🟡 Medium — Remaining

### ⚠️ M3 · `KeywordSerpAnalysis` purge job missing status index (migration pending)
**File:** `prisma/schema.prisma`  
**Status:** Index added to schema in H3 fix above. Needs migration run.

---

### ⚠️ M4 · No circuit breaker on Perplexity API calls
**File:** `src/lib/inngest/functions/blog.ts` (perplexity-research step)  
**Risk:** Perplexity rate-limits or goes down → 30 s timeout per blog job, blocking Inngest slots.  
**Recommended fix:** Wrap the Perplexity fetch in an `AbortSignal.timeout(25_000)` (already partially done) and add the same Redis circuit breaker pattern used for DataForSEO.

---

### ⚠️ M5 · `OnPageReport` model has no index
**File:** `prisma/schema.prisma` → `model OnPageReport`  
**Risk:** Dashboard queries for recent on-page reports (`WHERE siteId = ? ORDER BY createdAt DESC`) do a full sequential scan.  
**Recommended fix:**
```prisma
@@index([siteId, createdAt(sort: Desc)])
```

---

## 🟢 Low — Remaining

### ℹ️ L1 · `GEMINI_PRO_MODEL` env flag not documented
**File:** `src/lib/constants/ai-models.ts`  
Set `GEMINI_EXPERIMENTAL_MODELS=1` to enable `gemini-2.0-pro-exp`. This flag is undocumented in `.env.example`.  
**Fix:** Add to `.env.example` with a comment.

---

### ℹ️ L2 · `CompetitorKeyword` has no index
**File:** `prisma/schema.prisma` → `model CompetitorKeyword`  
Queries by `competitorId` do a full scan.  
**Fix:** Add `@@index([competitorId])`.

---

### ℹ️ L3 · `TrendingTopic` table grows unbounded
**File:** `prisma/schema.prisma` → `model TrendingTopic`  
No `expiresAt` or periodic purge. Table will grow indefinitely.  
**Fix:** Add `expiresAt DateTime` field and a weekly purge cron (similar to `purgeExpiredSerpAnalysisJob`).

---

## Environment Variables Needed

| Variable | Purpose | Status |
|----------|---------|--------|
| `ENCRYPTION_KEY` | Field-level AES-256-GCM encryption for GitHub tokens | ❌ Not set |
| `DATAFORSEO_CB_THRESHOLD` | Circuit breaker failure threshold (default: 3) | Optional |
| `DATAFORSEO_CB_RESET_MS` | Circuit breaker cooldown ms (default: 120000) | Optional |
| `DATAFORSEO_TIMEOUT_MS` | Per-request timeout ms (default: 15000) | Optional |
| `GEMINI_EXPERIMENTAL_MODELS` | Set to `1` to use gemini-2.0-pro-exp | Optional |

---

## Migration Checklist

- [ ] `npx prisma migrate dev --name add-missing-indices` — apply H3 indices
- [ ] Verify `ENCRYPTION_KEY` env var in Railway for H4 GitHub token encryption
- [ ] Run `prisma migrate deploy` in production after local migration validates

---

## Completed Fixes — Commit Summary

| Fix | File(s) Changed |
|-----|----------------|
| SIGTERM graceful shutdown | `livekit-agent.ts` |
| Blog job idempotency | `src/lib/inngest/functions/blog.ts` |
| Audit job idempotency (×2) | `src/lib/inngest/functions/audit.ts` |
| Anthropic model versioned ID | `src/lib/constants/ai-models.ts` |
| DataForSEO circuit breaker + timeout | `src/lib/backlinks/client.ts` |
| Prisma composite indices (×2) | `prisma/schema.prisma` |
| TrafficGrowth3D visual fix | `src/components/home/TrafficGrowth3D.tsx`, `HomeClient.tsx` |
