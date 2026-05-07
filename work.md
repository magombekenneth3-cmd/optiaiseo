# AISEO Platform — Senior Developer Guide
*Architecture · Patterns · Operational Rules*

---

## Stack at a glance

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Database | Prisma + PostgreSQL (66 models) |
| Cache / Rate limiting | Upstash Redis |
| Background jobs | Inngest (30+ registered jobs) |
| Auth | NextAuth (JWT + OAuth) |

---

## 1. Architecture Overview

AISEO is a multi-tenant SaaS platform for AI-powered SEO analysis, AEO (Answer Engine Optimisation), blog generation, and self-healing content. Understanding the data flow and module ownership upfront will save you hours of searching.

### 1.1 Request lifecycle

Every authenticated page action flows through this chain:

```
Browser → Next.js Page/Route → Server Action → getAuthenticatedUser()
       → consumeCredits() → lib/ logic → Prisma → PostgreSQL
```

Background work is entirely handled by Inngest, never by API route timeouts. The general rule: if an operation takes more than 2 seconds, it belongs in an Inngest job.

### 1.2 Module ownership map

| Path | Owns |
|---|---|
| `src/lib/aeo/` | AEO checks — multi-model citation, schema gaps, knowledge graph, diagnosis, fix engine |
| `src/lib/blog/` | Blog generation pipeline — SERP context, prompt rules, internal links, repurpose jobs |
| `src/lib/gsc/` | Google Search Console — OAuth tokens, keyword metrics, decay detection, opportunity scoring |
| `src/lib/seo-audit/` | Audit engine — modular plugin architecture, `AuditModule` interface, scoring weights |
| `src/lib/self-healing/` | GSoV drop detection, healing action selection, impact measurement |
| `src/lib/inngest/` | All background job definitions + the Inngest client singleton |
| `src/lib/stripe/` | Billing — tier definitions, feature gates, webhook idempotency, plan limits |
| `src/lib/rate-limit/` | Two-layer rate limiting: burst (sliding window) + monthly (calendar quota) |
| `src/lib/competitors/` | Competitor detection, traffic tier scoring, velocity tracking, similarity filters |
| `src/lib/pdf/` | White-label PDF report generation (audit reports, monthly reports, AEO reports) |
| `src/lib/recommendations/` | Data-driven recommendation engine (`engine.ts`) — GSC-backed, scored by traffic opportunity |

---

## 2. Core Patterns Every Developer Must Know

### 2.1 Server Action authentication

Every Server Action that touches user data must begin with `requireUser()`. This is the primary authoritative auth check used across the codebase — do not call `getServerSession()` directly in actions.

> **Two helpers exist — use `requireUser()` for most actions:**
> - `requireUser()` from `@/lib/auth/require-user` — used by `audit.ts`, `blog.ts`, `aeoAutopilot.ts` and most actions.
> - `getAuthenticatedUser()` from `@/lib/server-only` — legacy helper, still used in some older actions. Both are valid but `requireUser()` is the established standard.

```ts
"use server"
import { requireUser } from "@/lib/auth/require-user";

export async function myAction(siteId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth.error;   // typed AuthFail shortcut
  const { user } = auth;
  // ... your logic
}
```

> **Why:** `requireUser()` does a session check AND a DB user lookup in one round-trip. It gives you the full `User` row (including tier, credits, preferences) without a second query.

### 2.2 Credit consumption

Expensive operations (audit, AEO check, blog gen, competitor analysis) must deduct credits atomically before running. The deduction uses a raw SQL `UPDATE` with a `WHERE credits >= cost` guard — it is impossible to go negative.

```ts
import { consumeCredits } from "@/lib/credits";

const result = await consumeCredits(user.id, "fullAudit");
if (!result.allowed) {
  return { success: false, error: "Insufficient credits", remaining: result.remaining };
}
```

Credit costs are defined in `src/lib/credits/constants.ts`. Do not hardcode numbers at the call site.

### 2.3 Rate limiting — two layers

Rate limiting is split into two complementary systems:

- **Burst limiter** — per-minute/per-hour sliding window via `rateLimit(limiterName, identifier)`. Use this for API calls that can spike.
- **Monthly quota** — calendar-month counter via `checkAuditLimit(userId, tier)`. This is the plan-level limit (e.g. 15 audits/month on Starter).

```ts
import { rateLimit, checkAuditLimit } from "@/lib/rate-limit";

// Layer 1: burst
const limited = await rateLimit("auditRun", `${userId}:${siteId}`);
if (limited) return limited;

// Layer 2: monthly quota
const quota = await checkAuditLimit(userId, user.tier);
if (!quota.allowed) return { error: "Monthly limit reached", resetAt: quota.resetAt };
```

> **Fail-open policy:** Monthly rate limits fail open on Redis errors — a cache blip should never lock a user out. Burst limits are backed by Upstash's sliding window which has its own retry logic.

#### Named burst limiters reference

| Key | Identifier | Limit | Window | Purpose |
|---|---|---|---|---|
| `auth` | IP | 10 | 15 min | Sign-in / sign-up brute-force |
| `passwordReset` | IP+email | 3 | 1 h | Account enumeration guard |
| `api` | userId | 120 | 1 min | General authenticated API calls |
| `blogGenerate` | userId | 5 | 1 min | Expensive Gemini generation |
| `aeoCheck` | userId | 3 | 1 min | Multi-LLM AEO checks |
| `voiceSession` | userId | 5 | 1 h | LiveKit token issuance |
| `auditRun` | userId+siteId | 3 | 5 min | Live-site crawl |
| `competitorFetch` | userId | 10 | 1 h | Serper / DataForSEO calls |
| `githubPr` | userId | 5 | 1 h | GitHub API PR creation |
| `citationGap` | siteId | 1 | 6 h | Perplexity / Gemini citation gap |

### 2.4 Background jobs — Inngest patterns

All Inngest functions must be registered in `src/app/api/inngest/route.ts`. An unregistered function causes its trigger events to be **silently dropped** — there is no error, the job just never runs.

```ts
// Every fan-out child job MUST be registered:
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    parentJob,
    childFanOutJob,  // ← easy to forget, catastrophic if missing
  ],
});
```

Fan-out pattern: the parent job fires `inngest.send()` with N events (one per site/page), and a registered child function processes each one independently. This avoids Inngest's 2-hour step timeout for large datasets.

### 2.5 Audit engine — module interface

The SEO audit system is fully modular. Each check implements `AuditModule`. The engine pre-fetches HTML once, then runs all modules in parallel via `Promise.all`.

```ts
interface AuditModule {
  id: string;
  requiresHtml?: boolean;  // set false for schema-only or API-only modules
  run(context: AuditModuleContext): Promise<AuditModuleResult>;
}

// Adding a new check:
// 1. Implement AuditModule in src/lib/seo-audit/modules/your-module.ts
// 2. Register it in the AuditEngine constructor or registerModule()
// 3. Score weights are in SCORING_WEIGHTS (ROI_IMPACT: 0.6, AI_VISIBILITY: 0.4)
```

---

## 3. Database & Prisma

### 3.1 Schema at a glance

66 models in `prisma/schema.prisma`. Key ownership relationships:

| Model | Purpose |
|---|---|
| `User` | Central entity. Has Subscription, Sites, Credits, StrategyMemory |
| `Site` | The SEO subject. Owns Audits, AeoReports, Competitors, Keywords, Blogs |
| `AeoReport` | Multi-model AEO snapshot. Stores `generativeShareOfVoice` (0–100) |
| `Audit / PageAudit` | Full-site vs per-page. `PageAudit` is the fan-out child |
| `TrackedKeyword` | User-pinned keyword rows. Separate from GSC-derived data |
| `SelfHealingLog` | Records every auto-fix action and its healing outcome |
| `StrategyMemory` | Aria voice agent memory — typed entries with optional expiry |
| `HealingOutcome` | Measured impact of a healing action (before/after GSoV diff) |
| `CreditHistory` | Immutable audit log of every credit deduction |
| `DripSequence` | Lead nurture state — tracks which drip emails have fired |

### 3.2 Prisma singleton pattern

The Prisma client in `src/lib/prisma.ts` uses the global singleton pattern to survive Next.js hot-reload. Connection pool size is environment-aware (20 in prod, 5 in dev). A slow-query logger fires at 500ms.

> **Import rule:** Always import via the named export: `import { prisma } from "@/lib/prisma"`. The file also has a default export which is a legacy leftover — remove it in the next cleanup pass.

### 3.3 Raw SQL for atomicity

Credit deduction uses `prisma.$executeRaw` to atomically check-and-decrement in a single statement. This is the only place in the codebase where raw SQL is acceptable. For everything else, use the Prisma query API.

```ts
// Atomic deduct — safe from race conditions
const result = await prisma.$executeRaw`
  UPDATE "User"
  SET credits = credits - ${cost}
  WHERE id = ${userId}
  AND credits >= ${cost}
`;
// result === 1 means success, 0 means insufficient credits
```

---

## 4. Authentication & Session

### 4.1 JWT cache layer

Session hydration uses a Redis read-through cache keyed by email with a 5-minute TTL. This avoids a DB round-trip on every authenticated request. Cache is busted in two scenarios:

- **Tier change:** Stripe webhook calls `bumpSessionVersion(userId)` which increments a `sessionVersion` field in `User.preferences` and deletes the Redis key.
- **Manual bust:** Call `redis.del(jwtCacheKey(email))` from any server context.

### 4.2 Account lockout

Brute-force protection is in `src/lib/auth/lockout.ts`. After 5 failed login attempts within a window, the account is locked for 15 minutes. This is Redis-backed. The lockout check runs before bcrypt comparison to avoid timing attacks.

### 4.3 Admin guard

Admin-only routes use `ensureAdminRole(email: string)` from `src/lib/admin-guard.ts`. It takes the user's **email string**, not the full user object. Note: `src/lib/auth/admin-guard.ts` exists but is just a re-export barrel pointing back to the root-level file — always import directly from `@/lib/admin-guard`.

---

## 5. AEO System — Answer Engine Optimisation

AEO is the platform's core differentiator. It measures how well a brand appears when LLMs answer queries, not just when Google ranks pages.

### 5.1 Multi-model check pipeline

An AEO audit calls multiple LLMs in parallel and aggregates results:

| Model | Role |
|---|---|
| Gemini (primary) | Citation detection, schema gap analysis, AIO (AI Overview) check |
| Perplexity | Citation likelihood scoring with source attribution |
| OpenAI (GPT-4) | Brand mention detection in conversational queries |
| Claude | Optional — cross-check for brand fact accuracy |
| Grok | Optional — X/Twitter context brand mentions |

### 5.2 Generative Share of Voice (GSoV)

GSoV (0–100) is the primary AEO score. It is stored in `AeoReport.generativeShareOfVoice`. The self-healing engine monitors GSoV drop between consecutive reports. Drop triggers:

- Absolute drop ≥ 10 points (when previous GSoV ≥ 20)
- Relative drop ≥ 15% (when previous GSoV < 20)

When a drop is detected, `detectGsovDrop()` returns `true` and the healing engine selects the appropriate fix action (`PR`, `CONTENT`, `SCHEMA`, or `ALERT`).

### 5.3 Fix engine

AEO fixes flow through `src/lib/aeo/fix-engine.ts`. It calls the SEO AI layer (`src/lib/seo/ai.ts`) for framework-aware code generation, then passes the result through a QA validation step before creating a GitHub PR or returning the patch.

> **Framework detection:** The fix engine detects the site's framework (Next.js, React-Vite, WordPress, etc.) and applies framework-specific constraints. For Next.js, it enforces the Metadata API for meta tags and prohibits hooks in layout files. Never bypass the framework map.

---

## 6. Billing & Tier System

### 6.1 Tier definitions

Four tiers in `src/lib/stripe/plans.ts`: `FREE`, `STARTER`, `PRO`, `AGENCY`.

| Tier | Key limits |
|---|---|
| `FREE` | 1 site, 5 audits/month, 50 credits, GSC only |
| `STARTER` | 3 sites, 15 audits/month, 150 credits, rank tracking, 2 competitors/site |
| `PRO` | 10 sites, 50 audits/month, 500 credits, Ahrefs, white-label |
| `AGENCY` | 50 sites, 200 audits/month, 2000 credits, client portal, developer API |

### 6.2 Feature gating

Use `hasFeature(tier, featureKey)` for any UI or API that should be tier-restricted. Do not read the feature map directly.

```ts
import { hasFeature } from "@/lib/stripe/plans";

if (!hasFeature(user.tier, "competitor")) {
  return { error: "Upgrade to Starter to access competitor analysis" };
}
```

### 6.3 Stripe webhook idempotency

Every Stripe webhook is stored in `WebhookEvent` with a unique `[provider, providerEventId]` constraint. The handler checks this before processing to prevent double-execution on Stripe retries. Expired `IdempotencyKey` rows are cleaned up by a scheduled job.

---

## 7. Blog Generation Pipeline

### 7.1 Pipeline stages

Blog generation is a multi-stage pipeline running inside a single Inngest job (`generateBlogJob`):

| Stage | Description |
|---|---|
| 1. SERP context | Fetches top-10 Google results via Serper, scrapes competitor headings and word counts |
| 2. Intent detection | Classifies keyword intent (informational, commercial, navigational, transactional) |
| 3. Prompt context | Builds `PromptContext` — business type, tone rules, funnel stage, internal link targets |
| 4. Gemini generation | Streams blog content using structured schema output (`Type.OBJECT` with strict field definitions) |
| 5. Internal linking | Post-processes output to inject relevant internal links from the site's published pages |
| 6. Humanise pass | Optional second Gemini call to reduce AI-detectable patterns |
| 7. CMS publish | Optional — pushes to WordPress/Webflow/Hashnode via `publishBlogToCmsJob` |

### 7.2 Prompt rules system

All prompt construction goes through `src/lib/blog/rules.ts`. Rules are functional — `getClaimRules(tone, businessType)`, `getToneRules()`, `getStructureRules()` etc. Never inline prompt strings in the Inngest job. Add new rules as functions, compose them in `buildPromptContext()`.

---

## 8. Observability

### 8.1 Logging

Always use the `logger` singleton from `src/lib/logger.ts`. It emits JSON lines in all environments (debug suppressed in prod). Never use `console.log` directly.

```ts
import { logger, formatError } from "@/lib/logger";

logger.info("[AEO] Check complete", { siteId, score });

try { ... } catch(err) {
  logger.error("[AEO] Check failed", { siteId, error: formatError(err) });
}
```

Use `formatError(err)` in the meta object — it handles non-Error throws and preserves stack traces.

### 8.2 Distributed tracing (OTEL)

OpenTelemetry is configured in `src/lib/telemetry.ts` and initialised via Next.js instrumentation. Wrap expensive operations with `traced()`:

```ts
import { traced } from "@/lib/telemetry";

const result = await traced(
  "aeo.multimodel.check",
  { siteId, keyword },
  () => auditMultiModelMentions(url, queries)
);
```

The tracer is a no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, so adding `traced()` calls is always safe in development.

### 8.3 Slow query detection

Prisma emits a `query` event. Any query exceeding 500ms is logged as a warning with the (truncated) query string. Watch for these in staging — they usually indicate a missing index or an N+1 pattern.

---

## 9. Security Rules

### 9.1 SSRF prevention

Any code that fetches a user-supplied URL must call `isValidPublicDomain(domain)` from `src/lib/security.ts` before making the request. It blocks localhost, `.local`, `.internal` TLDs, and all direct IP addresses including the AWS metadata endpoint (`169.254.169.254`).

> **Hard rule:** Never skip `isValidPublicDomain()` for user-submitted URLs. Every audit, AEO check, and crawler endpoint is a potential SSRF vector. The self-healing GitHub PR path is also covered — see `BLOCKED_PATH_PREFIXES` in `src/lib/github/index.ts`.

### 9.2 GitHub PR safety

The GitHub auto-fix path blocks writes to `.github/workflows/`, `.git/`, and `.env` via `BLOCKED_PATH_PREFIXES`. File size is capped at 1MB. Never extend these limits without a security review.

### 9.3 Environment validation

All environment variables are validated at startup via Zod schema in `src/lib/env.ts`. Production-only vars (Stripe keys, Upstash credentials) use `z.string().min(1)` conditionally. The Dockerfile sets `SKIP_ENV_VALIDATION=1` during `next build` to avoid requiring secrets at build time.

---

## 10. Inngest Jobs — Complete Inventory

All jobs are registered in `src/app/api/inngest/route.ts`. Fan-out children are called out explicitly — forgetting to register a child causes silent event drops.

### 10.1 Core pipeline jobs

| Job | Description |
|---|---|
| `generateBlogJob` | Full blog generation — SERP → AI → links → humanise → optional CMS publish |
| `runAeoAuditJob` | Per-site AEO check orchestrator |
| `processAeoSiteJob` | Fan-out child: one AEO check per site |
| `runWeeklyAuditJob` | Cron-triggered full-site audit |
| `processManualAuditJob` | Dashboard "Run Audit" button — non-blocking, user-initiated |
| `runPageAuditJob` | Fan-out parent: dispatches per-page audit events |
| `processPageAuditJob` | Fan-out child: single page audit — **MUST be registered** |
| `computeBenchmarksJob` | Monday 03:00 UTC — builds industry benchmark stats |
| `measureHealingOutcomesJob` | Daily 4am UTC — measures before/after GSoV for healing actions |
| `runFullStrategyJob` | Multi-agent parallel strategy orchestration |

### 10.2 Cron and alert jobs

| Job | Description |
|---|---|
| `creditsResetJob` | 1st of month 00:00 UTC — resets user credits to tier allowance |
| `uptimeMonitorJob` | Uptime orchestrator — fans out to `uptimeSiteCheckerJob` |
| `uptimeSiteCheckerJob` | Fan-out child — checks one site's uptime. **MUST be registered** |
| `weeklyDigestJob` | Weekly email digest with rank movements and recommendations |
| `leadDripSequenceJob` | Days 2, 5, 10 post-signup nurture emails |
| `magicFirstAuditJob` | New user: activation email + first audit trigger |
| `checkOneQueryJob` | Query library fan-out child — **MUST be registered** |
| `runSerpGapAnalysisJob` | SERP gap analysis on demand |
| `freshnessDecayCron` | Content freshness decay scoring — runs daily |

---

## 11. Known Technical Debt

### 11.1 Immediate — before next deployment

| Issue | Fix |
|---|---|
| Unlisted runtime deps | `p-limit`, `server-only`, and all 4 `@opentelemetry/*` packages are missing from `package.json`. Run: `pnpm add p-limit server-only @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/auto-instrumentations-node` |
| `prisma.ts` dual export | Both named (`export const prisma`) and default (`export default prisma`) exist. Remove the default export, migrate all import sites with grep. |
| `genBlogmodal.tsx` dead | Superseded by `BlogStepper.tsx`. Delete `src/app/dashboard/blogs/genBlogmodal.tsx`. |
| Legacy rate-limit stubs | Root-level `rate-limit/tiered.ts` and `rate-limit/cleanup.ts` are shadowed by the `burst/` subdirectory. Delete both stubs. |

### 11.2 Short-term cleanup

| Issue | Fix |
|---|---|
| Missing `knip.json` | Create `knip.json` with entry patterns for `src/lib/inngest/**`, `scripts/**`, `public/**`. This will clear ~200 false-positive unused export warnings. |
| `hasFeature` alias | `canAccessFeature` in `plans.ts` is a direct alias of `hasFeature`. Remove the alias, update all call sites. |
| `@livekit/components-core` | Listed in `optimizePackageImports` in `next.config.ts` but flagged unused by knip. Verify voice feature status and either remove or document. |
| Content scoring Redis | `src/lib/content-scoring/index.ts` creates its own Redis instance instead of using the shared singleton from `@/lib/redis`. Consolidate. |

---

## 12. Development Workflow

### 12.1 npm scripts

| Script | Purpose |
|---|---|
| `npm run dev:next` | Next.js dev server only (no voice agent) |
| `npm run dev` | Full stack: Next.js + voice agent via tsx + dotenv |
| `npm run inngest` | Local Inngest dev server — required for background job testing |
| `npm run studio` | Prisma Studio — visual DB browser |
| `npm run migrate` | `prisma migrate dev` — creates migration + regenerates client |
| `npm run migrate:deploy` | `prisma migrate deploy` — production only, applies pending migrations |
| `npm run test` | Vitest unit tests (run once) |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run agent:dev` | Build `livekit-agent.ts` then start in dev mode |

### 12.2 Minimum local environment variables

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/aiseo
NEXTAUTH_SECRET=<random-32-chars>
NEXTAUTH_URL=http://localhost:3000
GEMINI_API_KEY=<key>
UPSTASH_REDIS_REST_URL=<url>       # or use local Redis with REDIS_URL
UPSTASH_REDIS_REST_TOKEN=<token>
LIVEKIT_URL=<url>                  # required even if not using voice
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
SKIP_ENV_VALIDATION=1              # set during next build only
```

> **Docker Compose:** `docker-compose.yml` provides a local PostgreSQL + Inngest dev server. Set `INNGEST_BASE_URL=http://inngest:8288` inside Docker to route job events to the local server instead of Inngest Cloud.

### 12.3 Adding a new Inngest job — checklist

1. Create the function file in `src/lib/inngest/functions/your-job.ts`
2. Export it from `src/lib/inngest/functions/index.ts`
3. Import and add to the `functions: []` array in `src/app/api/inngest/route.ts`
4. If it is a fan-out child, add a comment noting it must not be removed

### 12.4 Adding a new audit module — checklist

1. Implement `AuditModule` interface in `src/lib/seo-audit/modules/`
2. Set `requiresHtml: false` if your module uses only API data
3. Register in the engine constructor and update `AEO_WEIGHTS` if AEO-related (weights must sum to 1.0)
4. Add credit cost to `src/lib/credits/constants.ts` if the module calls external APIs

---

## 13. Quick Reference

### Daily-use imports

| Symbol | Import path |
|---|---|
| `getAuthenticatedUser` | `import { getAuthenticatedUser } from "@/lib/server-only"` |
| `prisma` | `import { prisma } from "@/lib/prisma"` |
| `logger` / `formatError` | `import { logger, formatError } from "@/lib/logger"` |
| `redis` | `import { redis } from "@/lib/redis"` |
| `inngest` | `import { inngest } from "@/lib/inngest/client"` |
| `consumeCredits` | `import { consumeCredits } from "@/lib/credits"` |
| `rateLimit` | `import { rateLimit } from "@/lib/rate-limit"` |
| `hasFeature` | `import { hasFeature } from "@/lib/stripe/plans"` |
| `isValidPublicDomain` | `import { isValidPublicDomain } from "@/lib/security"` |
| `traced` | `import { traced } from "@/lib/telemetry"` |
| `bumpSessionVersion` | `import { bumpSessionVersion } from "@/lib/session-version"` |

### Files that are NOT dead code (knip false positives)

| File / path | Why it is alive |
|---|---|
| `src/app/actions/aeoAutopilot.ts` | Referenced by API route and dashboard page |
| `src/app/actions/onpage.ts` | Referenced by decay API route and audits page |
| `src/app/actions/services.ts` | Referenced by `auditFix.ts`, `site.ts`, `llmMentions.ts` |
| `public/embed.js` | Served directly over HTTP — entry point for embed widget |
| `optiaiseo/assets/editor.js` | WordPress plugin sidebar asset |
| `src/lib/inngest/functions/cron-*.ts` | All registered in `inngest/route.ts` via `serve()` |
| `src/lib/rate-limit/index.ts` exports | Consumed through the barrel — knip can't see through it |
| `src/lib/telemetry.ts` | Initialised by Next.js instrumentation, not imported directly |

---

*Generated from live source analysis of the AISEO codebase.*