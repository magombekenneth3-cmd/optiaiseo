# AISEO Patch — All Fixes Applied

## Critical Bug Fixes

### 1. Missing og-image.png (Social sharing was broken)
- **Files**: `public/og-image-source.svg`, `scripts/generate-og-image.js`
- Added a branded 1200×630 SVG source for og-image generation.
- Run `node scripts/generate-og-image.js` to produce the PNG (requires `sharp`).
- Alternatively, use `@vercel/og` for dynamic per-page OG images.

### 2. Placeholder social links in footer
- **Files**: `src/components/home/HomeClient.tsx`
- Replaced `twitter.com/yourplatform` → `twitter.com/aiseoseo`
- Replaced `github.com/yourplatform` → `github.com/aiseoseo`
- Update these to your real handles before going live.

### 3. Stripe webhook — silent FREE downgrade hardened
- **Files**: `src/lib/stripe/webhook.ts`, `src/lib/env.ts`
- `getTierFromPriceId` now returns `__UNKNOWN__` sentinel (not `FREE`) for unrecognised price IDs.
- New `assertKnownTier()` guard halts webhook processing and logs a CRITICAL alert instead of silently downgrading paying users.
- `assertStripePriceIds()` exported for startup checks.
- `src/lib/env.ts` warns at startup if `STRIPE_PRO_PRICE_ID` or `STRIPE_AGENCY_PRICE_ID` are missing in production.

### 4. Mobile nav — hamburger menu added to landing page
- **Files**: `src/components/home/HomeClient.tsx`
- Added `Menu` / `X` icons, `mobileNavOpen` state, body scroll lock, Escape key handler.
- Added full-width right-side drawer with all nav links, Log in, and Get Started CTA.
- Desktop nav links remain hidden on mobile (`hidden md:flex`).

## High Priority UX Fixes

### 5. Skip-nav a11y link was in CSS but never rendered
- **Files**: `src/app/ClientLayout.tsx`
- Added `<a href="#main-content" class="skip-nav">Skip to main content</a>` as first child of layout.
- The `#main-content` anchor already existed in the dashboard; now correctly linked.

### 6. card-surface hover was invisible in light mode
- **Files**: `src/app/globals.css`
- Changed base hover `border-color` from `rgba(255,255,255,0.1)` (white on white) to `rgba(0,0,0,0.15)` (visible in light mode).
- Dark mode override remains correct at `rgba(255,255,255,0.12)`.

### 7 + 8. Notifications — real API + dynamic TopHeader
- **Files**: `src/app/api/notifications/route.ts` (new), `src/components/dashboard/TopHeader.tsx`
- `/api/notifications` now queries Prisma for: recent completed audits, pending blog reviews, new-user welcome.
- Returns real timestamps. Sorted by recency. Capped at 10.
- `TopHeader` replaces hardcoded array with `useNotifications()` hook (fetches on mount + every 60s).
- Notification bell indicator only shows when there are real notifications.
- Loading skeleton shown while fetching. Empty state with checkmark shown when caught up.
- Clicking notifications with `href` navigates to the relevant page.

### 9. Sidebar — tooltips on disabled context items
- **Files**: `src/components/dashboard/SidebarNav.tsx`
- Items requiring `siteId` (SEO Audits, Keywords, etc.) show "Select a site first" tooltip on hover when no site is active.
- Items are now `pointer-events-none` (not just dim) to prevent accidental navigation.

### 10. Annual pricing toggle on landing page
- **Files**: `src/components/home/HomeClient.tsx`
- Added `billingAnnual` state + animated toggle switch in pricing section header.
- Pro: $39/mo → $31/mo annual. Agency: $99/mo → $79/mo annual.
- "Billed annually — 2 months free" note appears under Pro price when annual is selected.
- Pricing CTAs now pass `?plan=pro&billing=annual` through signup for future checkout automation.
- "Save 20%" badge on the Annual toggle.

### 11. AEO empty state — benchmark teaser
- **Files**: `src/app/dashboard/page.tsx`
- Empty AEO card now shows "Top brands avg 68/100" instead of "Run deep AEO audit".
- Added "See where you rank →" link directly on the card.

### 12. Deprecated ConnectGSCBtn shim cleaned up
- **Files**: `src/components/ConnectGSCBtn.tsx`
- Clarified deprecation comment with explicit TODO to delete after confirming zero external callers.

## New Features (Competitive Gaps Closed)

### 13. Inline onboarding wizard
- **Files**: `src/components/dashboard/OnboardingInline.tsx`, `src/app/dashboard/page.tsx`
- Replaces the "Add Your First Site" button with a 3-step inline wizard (Domain → Audit → Done).
- Real-time domain validation. Calls `/api/sites` POST to create the site without leaving the page.
- After adding domain, immediately offers to run the first audit. "Skip for now" available.
- Wired into dashboard `isNewUser` branch.

### 14. ⌘K Command palette
- **Files**: `src/components/dashboard/CommandPalette.tsx`, `src/app/dashboard/layout.tsx`, `src/components/dashboard/TopHeader.tsx`
- Global `⌘K` / `Ctrl+K` shortcut opens a full-featured command palette.
- 15 commands covering all nav destinations. Fuzzy search with scoring (exact > prefix > contains > keywords > description).
- Keyboard navigation: `↑↓` to select, `↵` to open, `Esc` to close.
- Auto-scrolls selected item into view.
- Subtle `⌘K` search hint in TopHeader (desktop only).
- Wired into dashboard layout via `<CommandPalette />`.

### 15. Real-time job progress — JobPoller component
- **Files**: `src/components/dashboard/JobPoller.tsx`
- Generic polling component: polls a `pollUrl` every 5s while status is PENDING/RUNNING.
- Animated progress bar with elapsed/estimated time display.
- `onComplete` and `onError` callbacks. Auto-stops polling on terminal status.
- Wire into audit trigger and blog generation pages via `pollUrl="/api/audits/{id}/status"`.

### 16. Shareable audit link button
- **Files**: `src/app/dashboard/audits/[id]/ShareAuditButton.tsx`, `src/app/dashboard/audits/[id]/page.tsx`
- "Share" button next to Export in audit detail header.
- Uses `navigator.share()` on mobile; falls back to clipboard copy on desktop.
- Shows "Copied!" confirmation for 2s after copy.

### 17. Keyword rank history sparkline
- **Files**: `src/components/dashboard/KeywordSparkline.tsx`
- SVG sparkline component for position-over-time in keyword rows.
- Color-coded by trend: green = improved, red = declined, gray = flat.
- Shows delta badge (↑3 / ↓2) next to the sparkline.
- Wire into keyword table rows by passing `data={keyword.positionHistory}`.

## How to run

```bash
npm install
# Generate og-image PNG:
node scripts/generate-og-image.js
# Dev server:
npm run dev
```

Update social handles in `src/components/home/HomeClient.tsx` before deploying.
