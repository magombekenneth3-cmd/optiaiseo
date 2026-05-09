 1 · ENTERPRISE tier referenced but never defined Tier type is "FREE | STARTER | PRO | AGENCY" — no ENTERPRISE. Yet audit.ts, page-audit.ts, backlinks.ts and credits/index.ts all branch on "ENTERPRISE". getPlan("ENTERPRISE") silently falls back to FREE limits — paid users get downgraded. 2 · STARTER excluded from cron fan-out (weekly audit, backlinks) cron-schedule.ts getPaidSites() queries subscriptionTier IN ["PRO","AGENCY"] only. STARTER plan pays for audits (auditsPerMonth: 15) but their sites are never queued by weekly audit or backlinks crons — a silent feature regression for paying users. 3 · Credit pack amount hardcoded in webhook (not from CREDIT_PACK constant) handleInvoicePaid() calls addCreditPackCredits(userId, 50). The canonical CREDIT_PACK.credits constant in plans.ts is also 50 — but they're not linked. Changing CREDIT_PACK.credits silently leaves the webhook granting the wrong amount. 4 · Site-limit check bypasses guards.ts — reads raw JWT tier, not effective tier site.ts calls withinLimit(user.subscriptionTier, "sites", …) directly on the session tier without going through getUserTier(). Trial users get FREE limits (1 site) even during their 7-day PRO trial; subscription expiry / past_due also not checked here. 5 · Annual billing: webhook maps apriceId → tier but annual price IDs aren't mapped getTierFromPriceId() only checks STRIPE_STARTER_PRICE_ID / _PRO_ / _AGENCY_. Annual variants (STRIPE_STARTER_ANNUAL_PRICE_ID etc.) are never compared, so an annual subscription fires the "__UNKNOWN__" branch → user stays on FREE. 6 · plans.test.ts fixtures don't match actual plan prices (stale test data) Test fixture has STARTER=$29, PRO=$79, AGENCY=$199. Actual plans.ts has STARTER=$19, PRO=$49, AGENCY=$149. Tests pass using invented prices — any pricing regression in the real config would go undetected. 7 · Credentials signup doesn't emit user.registered — no drip / magic audit signup.ts (credentials flow) calls inngest.send("user.registered"). But auth.ts signIn() for OAuth providers creates users too — without ever emitting the event. OAuth new users get no referral-code generation via Inngest and no magic first audit. Critical High Medium Billing Test quality Onboarding Files involved: stripe/plans.ts · stripe/webhook.ts · stripe/guards.ts · inngest/functions/cron-schedul


 # Bug Analysis & Fix Guide

Seven confirmed bugs across billing, scheduling, and onboarding. Each section describes exactly where the code is broken, why it matters, and the minimal surgical fix.

---

## Bug 1 — `ENTERPRISE` tier referenced but never defined

**Severity:** Critical · Billing  
**Files:** `src/lib/inngest/functions/audit.ts`, `src/lib/inngest/functions/page-audit.ts`, `src/lib/inngest/functions/backlinks.ts`, `src/lib/credits/index.ts`

### What's broken

`plans.ts` defines `Tier = "FREE" | "STARTER" | "PRO" | "AGENCY"` — no `ENTERPRISE`. Yet four files branch on the string `"ENTERPRISE"`:

- **`audit.ts` line ~88:** `const isPaid = ["PRO", "AGENCY", "ENTERPRISE"].includes(...)` — harmless here because ENTERPRISE still lands in the truthy branch, but it's a lie the type system can't catch.
- **`page-audit.ts` lines ~22–28:** `PAGE_LIMIT` map includes `ENTERPRISE: 100`. `getTierPageLimit()` reads `site.user.subscriptionTier` straight from the DB. If the string `"ENTERPRISE"` ever reaches the DB, the lookup works — but no Stripe webhook can write it because `getTierFromPriceId()` never produces it.
- **`backlinks.ts` cron fan-out line ~33:** `subscriptionTier: { in: ["PRO", "AGENCY", "ENTERPRISE"] }` — same ghost tier, no effect in practice but inconsistent.
- **`credits/index.ts` `resetMonthlyCredits()`:** Has an `"ENTERPRISE"` entry that grants `AGENCY_MONTHLY_CREDITS`. This runs against the DB, so if someone manually sets a user's tier to `"ENTERPRISE"` in the DB, it would credit them. Again no code path sets that tier legitimately.

The real danger is `getPlan("ENTERPRISE")` silently falling back to `PLANS.FREE` (see `getPlan()` in `plans.ts`: `return PLANS[tier as Tier] ?? PLANS.FREE`). Any guard call using the raw tier string from the DB would give a previously-enterprise user FREE limits.

### Fix

**Option A (recommended) — add ENTERPRISE as a first-class tier alias for AGENCY:**

```ts
// src/lib/stripe/plans.ts — add after AGENCY block
export const PLANS = {
  // ... existing tiers ...
  ENTERPRISE: {
    ...PLANS.AGENCY,
    name: "Enterprise",
    tier: "ENTERPRISE" as const,
  },
} as const

export type Tier = "FREE" | "STARTER" | "PRO" | "AGENCY" | "ENTERPRISE"
```

Then update `assertStripePriceIds()` and `getTierFromPriceId()` in `webhook.ts` to map an enterprise price ID when you have one.

**Option B — remove ENTERPRISE references and normalise to AGENCY everywhere:**

```ts
// src/lib/inngest/functions/page-audit.ts
const PAGE_LIMIT: Record<string, number> = {
  FREE:   5,
  STARTER: 10,
  PRO:    25,
  AGENCY: 50,   // remove ENTERPRISE line
};

// src/lib/inngest/functions/audit.ts
const isPaid = ["STARTER", "PRO", "AGENCY"].includes((tier ?? "").toUpperCase());

// src/lib/credits/index.ts — remove ENTERPRISE row from tiers array
const tiers = [
  { tier: "FREE",    amount: FREE_MONTHLY_CREDITS },
  { tier: "STARTER", amount: STARTER_MONTHLY_CREDITS },
  { tier: "PRO",     amount: PRO_MONTHLY_CREDITS },
  { tier: "AGENCY",  amount: AGENCY_MONTHLY_CREDITS },
  // ← ENTERPRISE row removed
];
```

Option A is safer if you plan to introduce an enterprise tier later. Option B removes dead code now.

---

## Bug 2 — STARTER excluded from cron fan-out

**Severity:** Critical · Billing (silent feature regression for paying users)  
**File:** `src/lib/inngest/functions/cron-schedule.ts`

### What's broken

`getPaidSites()` is the single shared helper used by every cron fan-out (weekly audit, backlinks, rank tracker, AEO, blog, competitor alerts):

```ts
// cron-schedule.ts ~line 22
async function getPaidSites() {
    return prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        //                                          ^^^^^^^^^^^^^^^^^^^
        //                                          STARTER missing here
        select: { id: true, domain: true, userId: true },
    });
}
```

STARTER pays for `auditsPerMonth: 15`, `backlinks: false` (feature flag), and `rankTracking: true`. Their sites are silently skipped by every cron job. The backlink fan-out (`backlinks.ts`) has an identical inline filter:

```ts
// backlinks.ts ~line 33
where: { user: { subscriptionTier: { in: ["PRO", "AGENCY", "ENTERPRISE"] } } },
```

The backlinks feature flag (`backlinks: false` for STARTER in `plans.ts`) means STARTER users legitimately shouldn't get the backlinks cron — but they should get the weekly audit and rank tracker.

### Fix

Split `getPaidSites()` into two helpers — one for all paid tiers, one for backlink-eligible tiers:

```ts
// cron-schedule.ts

/** All paid tiers — used for audits, rank tracking, AEO, blog, competitor alerts */
async function getPaidSites() {
    return prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["STARTER", "PRO", "AGENCY"] } } },
        select: { id: true, domain: true, userId: true },
    });
}

/** Tiers with backlinks feature enabled (PRO and above) */
async function getBacklinkEligibleSites() {
    return prisma.site.findMany({
        where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
        select: { id: true, domain: true, userId: true },
    });
}
```

Then update `cronWeeklyBacklinks` to call `getBacklinkEligibleSites()`:

```ts
// cronWeeklyBacklinks handler
const sites = await step.run("fetch-backlink-sites", getBacklinkEligibleSites);
```

And update the inline filter in `backlinks.ts` to match:

```ts
// backlinks.ts cron fan-out branch
where: { user: { subscriptionTier: { in: ["PRO", "AGENCY"] } } },
// (remove ENTERPRISE — it's not a real tier, see Bug 1)
```

---

## Bug 3 — Credit pack amount hardcoded in webhook

**Severity:** High · Billing  
**File:** `src/lib/stripe/webhook.ts`

### What's broken

```ts
// webhook.ts handleInvoicePaid(), ~line 112
await addCreditPackCredits(subscription.userId, 50)
//                                              ^^
//                                              hardcoded — not CREDIT_PACK.credits
```

`plans.ts` defines:

```ts
export const CREDIT_PACK = {
    credits: 50,   // ← canonical value
    price: 9,
    ...
} as const
```

Both are `50` today, so there's no live defect — but the connection is broken. If someone changes `CREDIT_PACK.credits` to e.g. `100`, the webhook will keep granting 50.

### Fix

Import the constant and use it:

```ts
// webhook.ts — add to imports
import { CREDIT_PACK } from "@/lib/stripe/plans"

// inside handleInvoicePaid()
await addCreditPackCredits(subscription.userId, CREDIT_PACK.credits)
```

One line change. The linter should prevent the literal from creeping back.

---

## Bug 4 — Site-limit check bypasses `guards.ts`

**Severity:** High · Billing  
**File:** `src/app/actions/site.ts`

### What's broken

```ts
// site.ts createSite() inside $transaction
const { withinLimit } = await import("@/lib/stripe/plans")
// ...
if (!withinLimit(user.subscriptionTier, "sites", currentSiteCount)) {
//               ^^^^^^^^^^^^^^^^^^^^
//               raw JWT tier — not the effective tier
```

`user.subscriptionTier` comes from the session JWT which is populated in `auth.ts` directly from `dbUser.subscriptionTier`. It is never passed through `getUserTier()` (in `guards.ts`), which is the only place that:

1. Calls `resolveEffectiveTier()` — honours 7-day PRO trials.
2. Checks `sub.status === "canceled"` or `sub.status === "past_due"`.
3. Checks `sub.currentPeriodEnd < new Date()` for expired subscriptions.

Consequences:
- A user in their 7-day free PRO trial gets `subscriptionTier = "FREE"` in the DB (trials are tracked via `trialEndsAt`, not the tier column), so they hit the FREE 1-site cap instead of the PRO 10-site cap.
- A `past_due` user keeps their paid site limit because the webhook sets `subscriptionTier = "FREE"` only after `invoice.payment_failed` fires — there's a race window.

### Fix

Replace the raw `withinLimit` call with `requireWithinLimit` from `guards.ts`:

```ts
// site.ts — change import
import { requireWithinLimit } from "@/lib/stripe/guards"

// inside createSite(), replace the $transaction block check:
const newSite = await prisma.$transaction(async (tx) => {
    const currentSiteCount = await tx.site.count({ where: { userId: user.id } })

    // requireWithinLimit calls getUserTier() which handles trials + expiry
    await requireWithinLimit(user.id, "sites", currentSiteCount)
    //    ^ throws TierError if over limit

    return tx.site.create({ ... })
})
```

Catch the `TierError` in the outer try/catch:

```ts
} catch (err: unknown) {
    if (err instanceof TierError) {
        return { success: false, error: err.message }
    }
    // ... existing error handling
}
```

Note: `requireWithinLimit` does a DB round-trip (to resolve tier) outside the Prisma transaction. This is acceptable — the transaction itself is the atomicity boundary for the site count. The tier resolution is read-only and non-transactional by design.

---

## Bug 5 — Annual billing: annual price IDs never mapped

**Severity:** Critical · Billing  
**File:** `src/lib/stripe/webhook.ts`

### What's broken

```ts
function getTierFromPriceId(priceId: string | null | undefined): string {
    if (!priceId) return "FREE"
    if (priceId === process.env.STRIPE_AGENCY_PRICE_ID)  return "AGENCY"
    if (priceId === process.env.STRIPE_PRO_PRICE_ID)     return "PRO"
    if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return "STARTER"
    return "__UNKNOWN__"
    //     ^^^^^^^^^^^^^
    //     annual price IDs fall here → user stays on FREE
}
```

`plans.ts` declares `annualPriceId` for every paid tier (reading from `STRIPE_STARTER_ANNUAL_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`, `STRIPE_AGENCY_ANNUAL_PRICE_ID`). None of these environment variables are checked in `getTierFromPriceId()`.

When an annual subscriber pays, Stripe fires `checkout.session.completed` and `invoice.paid` with the annual `priceId`. `getTierFromPriceId()` returns `"__UNKNOWN__"`. `assertKnownTier()` blocks the update and fires an admin alert. The user is never upgraded — they stay on FREE despite having paid for a year.

`assertStripePriceIds()` also only checks the three monthly IDs, so annual price ID misconfiguration is invisible at startup.

### Fix

```ts
// webhook.ts

export function assertStripePriceIds(): void {
    const required = [
        "STRIPE_STARTER_PRICE_ID",
        "STRIPE_PRO_PRICE_ID",
        "STRIPE_AGENCY_PRICE_ID",
        // Add annual variants:
        "STRIPE_STARTER_ANNUAL_PRICE_ID",
        "STRIPE_PRO_ANNUAL_PRICE_ID",
        "STRIPE_AGENCY_ANNUAL_PRICE_ID",
    ]
    const missing = required.filter(k => !process.env[k])
    if (missing.length > 0) {
        logger.warn("[Stripe] Missing price ID env vars", { missing })
    }
}

function getTierFromPriceId(priceId: string | null | undefined): string {
    if (!priceId) return "FREE"

    // Monthly
    if (priceId === process.env.STRIPE_AGENCY_PRICE_ID)         return "AGENCY"
    if (priceId === process.env.STRIPE_PRO_PRICE_ID)            return "PRO"
    if (priceId === process.env.STRIPE_STARTER_PRICE_ID)        return "STARTER"

    // Annual — ADD THESE:
    if (priceId === process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID)  return "AGENCY"
    if (priceId === process.env.STRIPE_PRO_ANNUAL_PRICE_ID)     return "PRO"
    if (priceId === process.env.STRIPE_STARTER_ANNUAL_PRICE_ID) return "STARTER"

    return "__UNKNOWN__"
}
```

No other changes needed — the rest of the webhook correctly uses the returned tier string.

> **Env var checklist:** Make sure `STRIPE_STARTER_ANNUAL_PRICE_ID`, `STRIPE_PRO_ANNUAL_PRICE_ID`, and `STRIPE_AGENCY_ANNUAL_PRICE_ID` are set in Railway (or whatever hosting you use). Without them `process.env.*` returns `undefined` and the comparisons silently evaluate to `priceId === undefined` — always false — so annual subs still hit `"__UNKNOWN__"`.

---

## Bug 6 — `plans.test.ts` fixtures don't match actual plan prices

**Severity:** Medium · Test quality  
**File:** `tests/unit/plans.test.ts`

### What's broken

The test file defines its own inline `PLANS` fixture instead of importing from `src/lib/stripe/plans.ts`. The fixture prices are stale:

| Tier    | Test fixture | Actual `plans.ts` |
|---------|-------------|-------------------|
| STARTER | $29/mo      | $19/mo            |
| PRO     | $79/mo      | $49/mo            |
| AGENCY  | $199/mo     | $149/mo           |

The tests pass because they only validate internal consistency (annual < monthly × 12, credits escalate, etc.) — not that the values match production. A pricing change in `plans.ts` would go completely undetected.

### Fix

Remove the inline fixture and import directly from the source. The env-var dependency (`process.env.STRIPE_*_PRICE_ID`) is the only wrinkle — stub those before import:

```ts
// tests/unit/plans.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest"

beforeAll(() => {
    // Stub price IDs so plans.ts can be imported without real env vars
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_monthly_test")
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_monthly_test")
    vi.stubEnv("STRIPE_AGENCY_PRICE_ID", "price_agency_monthly_test")
    vi.stubEnv("STRIPE_STARTER_ANNUAL_PRICE_ID", "price_starter_annual_test")
    vi.stubEnv("STRIPE_PRO_ANNUAL_PRICE_ID", "price_pro_annual_test")
    vi.stubEnv("STRIPE_AGENCY_ANNUAL_PRICE_ID", "price_agency_annual_test")
    vi.stubEnv("STRIPE_CREDIT_PACK_PRICE_ID", "price_credit_pack_test")
})

// Import AFTER stubEnv so the module reads the stubbed values
const { PLANS, CREDIT_PACK } = await import("@/lib/stripe/plans")

describe("PLANS — pricing matches source", () => {
    it("STARTER monthly price is $19", () => {
        expect(PLANS.STARTER.price.monthly).toBe(19)
    })
    it("PRO monthly price is $49", () => {
        expect(PLANS.PRO.price.monthly).toBe(49)
    })
    it("AGENCY monthly price is $149", () => {
        expect(PLANS.AGENCY.price.monthly).toBe(149)
    })
    it("annual price is cheaper than monthly × 12 for each tier", () => {
        for (const plan of [PLANS.STARTER, PLANS.PRO, PLANS.AGENCY]) {
            expect(plan.price.annual * 12).toBeLessThan(plan.price.monthly * 12)
        }
    })
})

describe("CREDIT_PACK", () => {
    it("credits value matches source", () => {
        expect(CREDIT_PACK.credits).toBe(50) // update this test when CREDIT_PACK changes
    })
})
```

> **Note on `price` shape:** `plans.ts` defines `price: { monthly: 19, annual: 15 }` for paid tiers. The old fixture used `price: number`. Update all test assertions to use `.price.monthly` and `.price.annual`.

---

## Bug 7 — OAuth signup doesn't emit `user.registered`

**Severity:** High · Onboarding  
**Files:** `src/app/actions/signup.ts`, `src/lib/auth.ts`

### What's broken

**Credentials flow** (`signup.ts`) correctly fires `inngest.send("user.registered", ...)` after creating the user. This triggers the drip sequence and magic first audit.

**OAuth flow** (`auth.ts` `signIn` callback) creates new users here:

```ts
// auth.ts signIn callback ~line 170
if (!dbUser) {
    dbUser = await prisma.user.create({ ... })

    try {
        const code = `REF-${...}`
        await prisma.referral.create({ ... })
    } catch { /* Non-fatal */ }

    // ← NO inngest.send("user.registered") here
}
```

OAuth users (Google, GitHub) get:
- ✅ A referral code created inline
- ✅ The `aiseo_ref` cookie credited to the referrer
- ❌ No `user.registered` Inngest event
- ❌ No drip email sequence
- ❌ No magic first audit

### Fix

Add the Inngest send inside the `!dbUser` branch in `auth.ts`. The `signIn` callback is `async`, so `await` works fine:

```ts
// auth.ts signIn callback — inside the `if (!dbUser)` block, after referral creation

if (!dbUser) {
    const trialEndsAt = new Date()
    trialEndsAt.setDate(trialEndsAt.getDate() + 7)
    dbUser = await prisma.user.create({
        data: {
            email: user.email,
            name: user.name ?? user.email.split("@")[0],
            image: user.image,
            trialEndsAt,
        },
    })

    // Referral code (existing)
    try {
        const code = `REF-${crypto.randomUUID().replace(/-/g, "").substring(0, 8).toUpperCase()}`
        await prisma.referral.create({ data: { ownerId: dbUser.id, code } })
    } catch { /* Non-fatal */ }

    // ← ADD THIS: fire onboarding events for OAuth new users
    try {
        const { inngest } = await import("@/lib/inngest/client")
        await inngest.send({
            name: "user.registered",
            data: {
                userId: dbUser.id,
                email: dbUser.email!,
                name: dbUser.name ?? dbUser.email!.split("@")[0],
            },
        })
    } catch (err) {
        logger.warn("[Auth] inngest user.registered failed for OAuth user", {
            error: (err as Error)?.message,
        })
    }
}
```

The `inngest.send` is non-blocking and wrapped in a try/catch — a failure here doesn't block sign-in.

---

## Summary Table

| # | Bug | Severity | File(s) | Impact |
|---|-----|----------|---------|--------|
| 1 | `ENTERPRISE` tier undefined | Critical | `plans.ts`, `audit.ts`, `page-audit.ts`, `backlinks.ts`, `credits/index.ts` | Ghost tier, silent FREE fallback for any manual DB entry |
| 2 | STARTER excluded from cron fan-out | Critical | `cron-schedule.ts`, `backlinks.ts` | Paying STARTER users never get weekly audits or rank tracking |
| 3 | Credit pack amount hardcoded | High | `webhook.ts` | Changing `CREDIT_PACK.credits` won't update what the webhook grants |
| 4 | Site limit bypasses guards.ts | High | `site.ts` | Trial users capped at FREE (1 site); expired/past_due not enforced |
| 5 | Annual price IDs not mapped | Critical | `webhook.ts` | Annual subscribers stay on FREE forever |
| 6 | Stale test price fixtures | Medium | `plans.test.ts` | Pricing regressions in `plans.ts` go undetected |
| 7 | OAuth signup missing `user.registered` | High | `auth.ts` | OAuth users get no drip sequence and no magic first audit |

---

## Suggested fix order

1. **Bug 5** — Annual billing breakage. Revenue loss right now.
2. **Bug 2** — STARTER cron exclusion. Paying users getting nothing.
3. **Bug 4** — Site limit guard bypass. Trial/expired users hitting wrong limits.
4. **Bug 7** — OAuth onboarding event. Every OAuth signup misses drip + audit.
5. **Bug 3** — Credit pack hardcode. Low risk today, time bomb later.
6. **Bug 1** — ENTERPRISE cleanup. Code hygiene + prevent future confusion.
7. **Bug 6** — Test fixtures. Important but not user-facing.