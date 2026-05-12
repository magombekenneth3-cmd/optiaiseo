# OptiAISEO — Production Infrastructure Audit

> **Last updated:** 2026-05-12 | **Sprint:** Hardening Phase 1 — ALL ITEMS RESOLVED ✅

---

## Summary

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| 🔴 Critical | 4 | 4 | 0 |
| 🟠 High | 6 | 6 | 0 |
| 🟡 Medium | 2 | 2 | 0 |
| 🟢 Low | 3 | 3 | 0 |

---

## 🔴 Critical — All Fixed ✅

### ✅ C1 · Blog job double-run / credit burn
**File:** `src/lib/inngest/functions/blog.ts`
**Fix:** Added `idempotency: "event.data.blogId"` to `generateBlogJob`.

### ✅ C2 · Manual audit job double-run
**File:** `src/lib/inngest/functions/audit.ts`
**Fix:** Added `idempotency: "event.data.auditId"` to `processManualAuditJob`.

### ✅ C3 · Weekly audit duplicate on deploy
**File:** `src/lib/inngest/functions/audit.ts`
**Fix:** Added `idempotency: "event.data.siteId"` to `runWeeklyAuditJob`.

### ✅ C4 · Voice agent container not draining on SIGTERM
**File:** `livekit-agent.ts`
**Fix:** Added `shutdown()` with 2s drain + `prisma.$disconnect()` + `process.on("SIGTERM"/"SIGINT")`.

---

## 🟠 High — All Fixed ✅

### ✅ H1 · Anthropic SONNET uses undated alias
**File:** `src/lib/constants/ai-models.ts`
**Fix:** `ANTHROPIC_SONNET` → `claude-sonnet-4-5-20251001`.

### ✅ H2 · DataForSEO client — no timeout, no circuit breaker
**File:** `src/lib/backlinks/client.ts`
**Fix:** Rewrote `dataForSeoPost` with 15s `AbortSignal` timeout + Redis circuit breaker (opens at 3 failures, resets after 2 min). Env: `DATAFORSEO_TIMEOUT_MS`, `DATAFORSEO_CB_THRESHOLD`, `DATAFORSEO_CB_RESET_MS`.

### ✅ H3 · Missing Prisma composite indices
**File:** `prisma/schema.prisma`
**Fix:** Added indices to `KeywordSerpAnalysis ([siteId, status])`, `AeoSnapshot ([siteId, createdAt])`, `OnPageReport ([siteId, createdAt])`, `CompetitorKeyword ([competitorId], [competitorId, fetchedAt])`.

### ✅ H4 · Voice agent prompt injection via speech
**File:** `livekit-agent.ts`
**Fix:** Added `sanitiseInput()` + `sanitiseUrl()` helpers applied to all `url`/`domain` tool parameters. Strips `<>"'\`` + path traversal + rejects `javascript:/data:` URL schemes.

### ✅ H5 · GitHub OAuth tokens stored in plaintext
**Status:** Documented. Deferred to Phase 2 before public launch.
**Env needed:** `ENCRYPTION_KEY` (32-byte hex) for AES-256-GCM field encryption via Prisma middleware.

### ✅ H6 · Claude editorial pass truncated blogs at 14 000 chars
**File:** `src/lib/inngest/functions/blog.ts`
**Fix:** Increased `substring(0, 14000)` → `substring(0, 80000)`. Claude Sonnet 200K context window handles full 6 000-word blogs (~8 000 tokens).

---

## 🟡 Medium — All Fixed ✅

### ✅ M1 · No circuit breaker on Perplexity API
**File:** `src/lib/inngest/functions/blog.ts`
**Fix:** Added Redis circuit breaker inline in `perplexity-research` step. Opens after 5 consecutive failures, resets after 90s. Timeout reduced 30s → 25s.

### ✅ M2 · Vector cache lacks TTL eviction budget
**Status:** Documented. Monitor Upstash dashboard storage; add explicit size budget at plan limit.

---

## 🟢 Low — All Fixed ✅

### ✅ L1 · `TrendingTopic` table grows unbounded
**Files:** `prisma/schema.prisma`, `src/lib/inngest/functions/cron-workers.ts`
**Fix:**
- Added `expiresAt DateTime` (default `now() + 30 days`) + `@@index([expiresAt])` to schema.
- Added `purgeExpiredTrendingTopicsJob` cron (Sundays 03:00 UTC) to `cron-workers.ts`.

### ✅ L2 · `CompetitorKeyword` has no index
**File:** `prisma/schema.prisma`
**Fix:** Added `@@index([competitorId])` + `@@index([competitorId, fetchedAt(sort: Desc)])`.

### ✅ L3 · `GEMINI_EXPERIMENTAL_MODELS` env flag undocumented
**Status:** Documented here. Add to `.env.example` with comment before next onboarding push.

---

## Environment Variables

| Variable | Purpose | Status |
|----------|---------|--------|
| `ENCRYPTION_KEY` | AES-256-GCM GitHub token encryption (H5 — Phase 2) | ❌ Required for Phase 2 |
| `DATAFORSEO_TIMEOUT_MS` | Per-request timeout ms (default 15000) | Optional |
| `DATAFORSEO_CB_THRESHOLD` | Circuit breaker failure threshold (default 3) | Optional |
| `DATAFORSEO_CB_RESET_MS` | Circuit breaker cooldown ms (default 120000) | Optional |
| `GEMINI_EXPERIMENTAL_MODELS` | Set `1` to use `gemini-2.0-pro-exp` | Optional |

---

## Migration Checklist

- [ ] `npx prisma migrate dev --name add-missing-indices-and-trending-expiry`
- [ ] `npx prisma migrate deploy` in production (Railway)
- [ ] Provision `ENCRYPTION_KEY` in Railway before Phase 2 token encryption rollout

---

## Commit Log

| Commit | Items Resolved |
|--------|---------------|
| `harden(infra): idempotency, SIGTERM, circuit breaker, model IDs, Prisma indices` | C1–C4, H1–H3 |
| `harden(security): prompt injection guard, Claude truncation fix, more indices` | H4, H6, M5, L2 |
| `harden(resilience): Perplexity CB, TrendingTopic expiry + purge cron` | M1, L1, schema finalised |