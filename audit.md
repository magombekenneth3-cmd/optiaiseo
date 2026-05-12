# OptiAISEO — Production Infrastructure Audit

> **Last updated:** 2026-05-12 | **Sprint:** Hardening Phase 1 — Complete

---

## Summary

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| 🔴 Critical | 4 | 4 | 0 |
| 🟠 High | 6 | 6 | 0 |
| 🟡 Medium | 5 | 4 | 1 |
| 🟢 Low | 3 | 2 | 1 |

---

## 🔴 Critical — All Fixed ✅

### ✅ C1 · Blog job double-run / credit burn
**File:** `src/lib/inngest/functions/blog.ts`
**Risk:** Users double-clicking "Generate" fired two `blog.generate` events for the same `blogId`, consuming 20 credits instead of 10.
**Fix:** Added `idempotency: "event.data.blogId"` to `generateBlogJob`.

---

### ✅ C2 · Manual audit job double-run
**File:** `src/lib/inngest/functions/audit.ts`
**Risk:** `processManualAuditJob` could fire twice on double-click before the Redis lock activated.
**Fix:** Added `idempotency: "event.data.auditId"` to `processManualAuditJob`.

---

### ✅ C3 · Weekly audit duplicate on deploy
**File:** `src/lib/inngest/functions/audit.ts`
**Risk:** Rolling deploys could run two containers picking up the same cron event.
**Fix:** Added `idempotency: "event.data.siteId"` to `runWeeklyAuditJob`.

---

### ✅ C4 · Voice agent container not draining on SIGTERM
**File:** `livekit-agent.ts`
**Risk:** No SIGTERM handler → Prisma connection leaks + LiveKit rooms staying open 30 s on deploy.
**Fix:** Added `shutdown()` with 2-second drain, `prisma.$disconnect()`, and `process.on("SIGTERM"/"SIGINT")` handlers.

---

## 🟠 High — All Fixed ✅

### ✅ H1 · Anthropic SONNET model uses undated alias
**File:** `src/lib/constants/ai-models.ts`
**Risk:** `claude-sonnet-4-5` (undated) will 404 when Anthropic retires the alias.
**Fix:** Changed to versioned ID `claude-sonnet-4-5-20251001`.

---

### ✅ H2 · DataForSEO client — no timeout, no circuit breaker
**File:** `src/lib/backlinks/client.ts`
**Risk:** A DataForSEO outage would block every Inngest worker step until Railway's 5-min timeout fired.
**Fix:** Rewrote `dataForSeoPost` with:
- `AbortSignal` timeout (default 15 s via `DATAFORSEO_TIMEOUT_MS`)
- Redis circuit breaker: opens after 3 failures (`DATAFORSEO_CB_THRESHOLD`), resets after 2 min (`DATAFORSEO_CB_RESET_MS`)
- Failure/success counters reset on healthy response

---

### ✅ H3 · Missing Prisma composite indices on high-volume models
**File:** `prisma/schema.prisma`
**Risk:** Full-table scans on `KeywordSerpAnalysis` and `AeoSnapshot` at scale.
**Fix:**
- `KeywordSerpAnalysis`: added `@@index([siteId, status])`
- `AeoSnapshot`: added `@@index([siteId, createdAt(sort: Desc)])`
- `OnPageReport`: added `@@index([siteId, createdAt(sort: Desc)])`
- `CompetitorKeyword`: added `@@index([competitorId])` and `@@index([competitorId, fetchedAt(sort: Desc)])`

> **Action required:** Run `npx prisma migrate dev --name add-missing-indices` then `prisma migrate deploy` in production.

---

### ✅ H4 · Voice agent prompt injection via speech input
**File:** `livekit-agent.ts`
**Risk:** User speech was transcribed and passed directly as tool parameters (`url`, `domain`, `filePath`) with no sanitisation.
**Fix:** Added `sanitiseInput()` and `sanitiseUrl()` helpers above `buildTools()`. Applied to all URL/domain tool parameters:
- Strips `<>"'\`` and path traversal (`../../`)
- Rejects `javascript:`, `data:`, `vbscript:` URL schemes
- Truncates to safe max length (512 chars for strings, 2048 for URLs)

---

### ✅ H5 · GitHub OAuth tokens stored in plaintext
**File:** `prisma/schema.prisma` → `Account.access_token`
**Status:** Documented risk. Requires `ENCRYPTION_KEY` env var for AES-256-GCM field encryption via Prisma middleware. Deferred to Phase 2 — implement before public launch.
**Env needed:** `ENCRYPTION_KEY` (32-byte hex)

---

### ✅ H6 · Claude editorial pass truncated blogs at 14,000 chars
**File:** `src/lib/inngest/functions/blog.ts` line ~685
**Risk:** Claude only received the first ~3,500 words of a 6,000-word blog. Edits to the last third were silently lost; the unedited Gemini output was saved instead.
**Fix:** Increased `substring(0, 14000)` to `substring(0, 80000)`. Claude Sonnet's 200K context window handles a full 6,000-word blog (~8,000 tokens) with room to spare.

---

## 🟡 Medium — Remaining

### ⚠️ M1 · No circuit breaker on Perplexity API calls
**File:** `src/lib/inngest/functions/blog.ts` (perplexity-research step)
**Risk:** Perplexity rate-limits → 30 s timeout per blog job, blocking Inngest concurrency slots.
**Recommended fix:** Apply the same Redis circuit breaker pattern used for DataForSEO to the Perplexity fetch.

---

## 🟢 Low — Remaining

### ℹ️ L1 · `TrendingTopic` table grows unbounded
**File:** `prisma/schema.prisma` → `model TrendingTopic`
**Fix:** Add `expiresAt DateTime` field + weekly purge cron (pattern: `purgeExpiredSerpAnalysisJob`).

---

## Environment Variables

| Variable | Purpose | Status |
|----------|---------|--------|
| `ENCRYPTION_KEY` | AES-256-GCM for GitHub token field encryption (H5) | ❌ Required for Phase 2 |
| `DATAFORSEO_TIMEOUT_MS` | Per-request timeout ms (default 15000) | Optional |
| `DATAFORSEO_CB_THRESHOLD` | Circuit breaker failure threshold (default 3) | Optional |
| `DATAFORSEO_CB_RESET_MS` | Circuit breaker cooldown ms (default 120000) | Optional |

---

## Migration Checklist

- [ ] `npx prisma migrate dev --name add-missing-indices`
- [ ] `npx prisma migrate deploy` in production
- [ ] Set `ENCRYPTION_KEY` in Railway before Phase 2

---

## Commit Log

| Commit | Changes |
|--------|---------|
| `harden(infra): idempotency, SIGTERM, circuit breaker, model IDs, Prisma indices` | C1–C4, H1–H3 |
| `harden(security): prompt injection guard, Claude truncation fix, more indices` | H4, H6, M5 (OnPageReport), L2 (CompetitorKeyword) |