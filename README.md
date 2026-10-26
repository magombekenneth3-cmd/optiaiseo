# OptiAISEO

**Get cited by AI search — and prove it.**

OptiAISEO is an SEO and AEO (Answer Engine Optimization) platform. It audits your site, tracks whether ChatGPT, Perplexity, Claude, and Gemini cite your brand, proposes fixes as GitHub pull requests or CMS updates, and verifies whether each fix actually shipped and moved the needle.

Production: [optiaiseo.online](https://optiaiseo.online)

---

## Core activation path

1. **Connect a site** — domain, Google Search Console, optional GA4 and GitHub.
2. **Run an audit** — technical SEO, on-page, schema, and AI-search visibility.
3. **Approve the first fix** — auto-fix PR (GitHub) or guided CMS change.
4. **See the verified result** — PR state, deployment commit, and before/after GSC metrics.

---

## Features

| Area | What it does |
| --- | --- |
| Technical SEO audits | Crawl, Core Web Vitals, meta, headings, canonicals, schema, indexability |
| AEO visibility | Brand citation tracking across ChatGPT, Perplexity, Claude, and Gemini |
| Auto-fix | GitHub PRs with fix proposals; manual guides for CMS platforms without write access |
| Keyword research | GSC data first, DataForSEO for measured volume/difficulty; unmeasured metrics are shown as unavailable, never estimated silently |
| Rank tracking | SERP snapshots via SerpAPI or Serper |
| Blog generation | Evidence-gated pipeline with claim ledger, publication gate, and content lint |
| Publishing | WordPress, Ghost, Shopify, Webflow, Wix, Framer, Next.js, plus Medium and Hashnode syndication |
| Competitors and backlinks | Competitor gap analysis and backlink data via DataForSEO |
| Reports | Weekly email digests, client portal, and PDF reports |
| Voice strategist | Optional LiveKit voice agent ("Aria") for conversational audits |

---

## Tech stack

| Layer | Technology |
| --- | --- |
| App | Next.js 15 (App Router), React 18, Tailwind CSS 4, custom Node server (`server.ts`) |
| Database | PostgreSQL + Prisma 5 |
| Background jobs | Inngest |
| AI | Gemini (`@google/genai`) as primary; OpenAI, Anthropic, Perplexity for AEO checks and fallbacks |
| Data providers | Google Search Console, GA4, DataForSEO, SerpAPI / Serper |
| Payments | Stripe (monthly and annual plans, credit packs) |
| Caching / rate limits | Upstash Redis |
| Email | Resend |
| Monitoring | Sentry |
| Hosting | Railway (Dockerfile build, `/api/health` healthcheck) |

---

## Local setup

### Prerequisites

- Node.js 20+ and pnpm 8 (`corepack enable`)
- PostgreSQL (or Docker)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com)

### Steps

```bash
git clone https://github.com/magombekenneth3-cmd/optiaiseo.git
cd optiaiseo

pnpm install

cp .env.example .env
# Fill in at minimum: DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL,
# NEXT_PUBLIC_APP_URL, GEMINI_API_KEY

docker-compose -f docker-compose.dev.yml up -d

pnpm migrate

pnpm dev
```

In a second terminal, run the Inngest dev server so background jobs execute:

```bash
pnpm inngest
```

Open http://localhost:3000.

### Demo mode

To explore the UI without AI or LiveKit keys:

```bash
DEMO_MODE=1 pnpm dev
```

Demo mode returns canned AI responses and skips external AI/LiveKit calls.

### Voice agent (optional)

Requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`:

```bash
pnpm agent
```

---

## Environment variables

See [`.env.example`](.env.example) for the full list. Variables marked `[REQUIRED IN PRODUCTION]` cause a startup failure when missing in production. The app also logs startup warnings for missing data-provider and Stripe price variables.

| Variable | Purpose | Required |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` | Auth and canonical app URL | ✅ |
| `GEMINI_API_KEY` | Primary AI provider | ✅ |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments | ✅ in production |
| `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_AGENCY_PRICE_ID` | Monthly plan checkout | ✅ in production |
| `STRIPE_*_ANNUAL_PRICE_ID` | Annual plan checkout | Recommended |
| `CRON_SECRET` | Authenticates cron endpoints | ✅ in production |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Background jobs | ✅ in production |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting and caching | ✅ in production |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google login, Search Console, GA4 | Recommended |
| `GITHUB_ID`, `GITHUB_SECRET` | Auto-fix pull requests | Recommended |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | Measured keyword volume, difficulty, backlinks | Recommended |
| `SERPAPI_KEY` or `SERPER_API_KEY` | Rank tracking | Recommended |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY` | Multi-engine AEO checks | Optional |
| `RESEND_API_KEY` | Transactional and digest email | Optional |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Voice agent | Optional |

### Google Search Console OAuth

Register this redirect URI for each environment:

```
https://your-domain/api/auth/callback/google-gsc
```

For local development use `http://localhost:3000/api/auth/callback/google-gsc`. The app uses a dedicated `google-gsc` provider because it requests Search Console scopes; registering only `/api/auth/callback/google` is not sufficient.

---

## Deployment

Production runs on **Railway** using the root `Dockerfile` (see [`railway.toml`](railway.toml)). Railway health-checks `/api/health`.

Apply database migrations before or during release:

```bash
pnpm migrate:deploy
```

---

## Testing

```bash
pnpm test          # unit and integration tests (Vitest)
pnpm test:e2e      # end-to-end tests (Playwright)
pnpm lint
```

---

## Project structure

```
.
├── Dockerfile              # App + custom server image (Railway)
├── Dockerfile.agent        # LiveKit voice agent worker
├── railway.toml            # Railway build and deploy config
├── server.ts               # Custom Next.js + WebSocket server
├── livekit-agent.ts        # Voice agent entry point
├── prisma/                 # Schema and migrations
├── src/
│   ├── app/                # Routes, dashboard pages, API routes
│   ├── components/         # UI components
│   └── lib/                # Domain logic (audits, AEO, keywords, publishers, Inngest jobs)
└── tests/                  # Vitest and Playwright suites
```

---

## Contributing

Run `pnpm lint` and `pnpm test` before opening a pull request. CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
