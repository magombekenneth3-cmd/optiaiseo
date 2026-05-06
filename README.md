# AISEO — Voice-First AI SEO Strategist

> **Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com) — #GeminiLiveAgentChallenge**
> 
> **Challenge Categories Tackled:**
> 1. **🗣️ Live Agents:** Native voice-in/voice-out utilizing Gemini 2.5 Flash Native Audio Preview + LiveKit. Sub-second latency, barge-in support.
> 2. **☸️ UI Navigators:** Integrated Multimodal Vision. Aria can independently use Playwright to take screenshots of live URLs and use `gemini-3.1-pro-view` to evaluate visual UX complexity, accessibility, and design conversion. 

AISEO is a real-time, voice-driven AI platform that turns SEO from a manual grind into a live, interrupted conversation. Talk to **Aria**, your AI SEO strategist: she audits your site, visually critiques your design, checks your visibility in AI search engines (ChatGPT, Perplexity, Claude), and even stages GitHub Pull Requests to fix issues automatically.

---

## ✨ Key Features

| Feature                           | Description                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 🎙️ **Live Voice Agent (Aria)**    | Real-time bidirectional voice via Gemini 2.5 Flash Native Audio + LiveKit WebRTC. Supports natural barge-in |
| 👁️ **Multimodal UX Vision**       | Ask Aria to "Look at my design." She spins up Playwright, screenshots the DOM, and critiques the visual UI  |
| 🔍 **Technical SEO Audits**       | Full crawl: Core Web Vitals, meta tags, heading hierarchy, schema markup, canonical URLs                    |
| 🤖 **AEO (AI Search) Visibility** | Checks if your brand appears when ChatGPT, Perplexity, Claude, and Gemini answer industry queries           |
| 📊 **Competitor Gap Analysis**    | Keyword gap analysis using Google Search data                                                               |
| 🛠️ **Auto-Fix Pull Requests**     | Aria detects missing optimizations and stages a GitHub PR to fix them — automatically                       |
| 📝 **AI Blog Generation**         | Gemini 3.1 Pro View generates and publishes SEO-optimized blog posts                                        |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Browser                              │
│   Next.js React App  ←─── LiveKit WebRTC ───→  Aria Voice Agent     │
└─────────────────┬───────────────────────────────────────────────────┘
                  │ HTTPS / WSS
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Google Cloud Run                                  │
│                                                                      │
│  ┌────────────────────┐       ┌──────────────────────────────────┐   │
│  │  aiseo-frontend    │       │      aiseo-agent (Worker)        │   │
│  │  Next.js + WS      │       │  @livekit/agents + Gemini Live   │   │
│  │  (Port 3000)       │       │  (Port 8081)                     │   │
│  └─────────┬──────────┘       └──────────────┬───────────────────┘   │
│            │                                 │                       │
└────────────┼─────────────────────────────────┼───────────────────────┘
             │                                 │
    ┌────────▼───────────┐       ┌─────────────▼──────────────────┐
    │  Google Cloud      │       │  LiveKit Cloud (WebRTC)        │
    │  Firestore         │       │  Room, Track routing           │
    │  (Sessions, Logs)  │       │  Barge-in / VAD                │
    └────────────────────┘       └────────────────────────────────┘
             │                                 │
    ┌────────▼─────────────────────────────────▼──────────────────┐
    │              Gemini 2.0 Flash Live API                       │
    │  (Multimodal: Audio In → Audio Out, native VAD)              │
    └─────────────────────────────────────────────────────────────┘
             │
    ┌────────▼────────────────────────────────────────────────────┐
    │  External Integrations                                       │
    │  GitHub API  ·  Stripe  ·  OpenAI  ·  Anthropic             │
    │  Perplexity  ·  Google Search Console  ·  Inngest (BG Jobs) │
    └─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Local Setup (< 5 minutes)

### Prerequisites

- **Node.js 20+** and **pnpm** (`npm install -g pnpm`)
- **ffmpeg** — `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux)
- **PostgreSQL** database (or use the provided Docker Compose)
- A **LiveKit Cloud** account (free tier at [livekit.io](https://livekit.io)) — get `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/aiseo
cd aiseo

# 2. Install all dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
# → Edit .env and fill in at minimum:
#   DATABASE_URL, NEXTAUTH_SECRET, GEMINI_API_KEY,
#   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

# 4. Start the database
docker-compose up db -d

# 5. Create DB schema
pnpm prisma db push

# 6. Start the Next.js app (Terminal 1)
pnpm dev

# 7. Start the Aria voice agent worker (Terminal 2)
pnpm agent
```

Open **http://localhost:3000** → Sign up → Dashboard → **Talk to Aria** → click "🎙 Start Voice Session"

---

## ☁️ Google Cloud Deployment

### Quick Deploy (one command)

```bash
# Make sure gcloud is authenticated
gcloud auth login

# Deploy everything to Cloud Run
chmod +x deploy.sh
./deploy.sh YOUR_GCP_PROJECT_ID
```

### Or via Google Cloud Build (CI/CD)

```bash
gcloud builds submit --config cloudbuild.yaml --project YOUR_PROJECT_ID
```

### Or via GitHub Actions

1. In your GitHub repo → **Settings → Secrets**, add:
   - `GCP_PROJECT_ID` — your GCP project ID
   - `GCP_SA_KEY` — contents of your GCP service account JSON key
2. Push to `main` — deployment runs automatically via `.github/workflows/deploy.yml`

### Set Cloud Run Environment Variables

After first deploy, configure secrets:

```bash
gcloud run services update aiseo-frontend \
  --region=us-central1 \
  --set-env-vars="NODE_ENV=production,NEXTAUTH_URL=https://YOUR_DOMAIN" \
  --set-secrets="DATABASE_URL=database-url:latest,GEMINI_API_KEY=gemini-api-key:latest,..."
```

---

## 🔑 Environment Variables

| Variable                                    | Description                               | Required    |
| ------------------------------------------- | ----------------------------------------- | ----------- |
| `DATABASE_URL`                              | PostgreSQL connection string              | ✅          |
| `NEXTAUTH_SECRET`                           | Random 32-char string for JWT signing     | ✅          |
| `NEXTAUTH_URL`                              | App URL (e.g. `https://your-app.run.app`) | ✅          |
| `GEMINI_API_KEY`                            | Google AI Studio API Key                  | ✅          |
| `LIVEKIT_URL`                               | LiveKit WebSocket URL (`wss://...`)       | ✅          |
| `LIVEKIT_API_KEY`                           | LiveKit API Key                           | ✅          |
| `LIVEKIT_API_SECRET`                        | LiveKit API Secret                        | ✅          |
| `GOOGLE_ID` & `GOOGLE_SECRET`               | Google OAuth (for login + Search Console) | Recommended |
| `GITHUB_ID` & `GITHUB_SECRET`               | GitHub OAuth (for Auto-Fix PRs)           | Recommended |
| `OPENAI_API_KEY`                            | AEO visibility check on ChatGPT           | Optional    |
| `ANTHROPIC_API_KEY`                         | AEO visibility on Claude                  | Optional    |
| `PERPLEXITY_API_KEY`                        | AEO visibility on Perplexity              | Optional    |
| `STRIPE_SECRET_KEY`                         | Payments and usage limits                 | Optional    |
| `UPSTASH_REDIS_REST_URL`                    | Rate limiting & caching                   | Optional    |
| `RESEND_API_KEY`                            | Email digest alerts                       | Optional    |
| `INNGEST_EVENT_KEY` & `INNGEST_SIGNING_KEY` | Background job queuing                    | Optional    |
| `SERPAPI_KEY` or `SERPER_API_KEY`           | SERP rank tracking                        | Optional    |

---

## 🛠️ Tech Stack

| Layer               | Technology                                                      |
| ------------------- | --------------------------------------------------------------- |
| **AI Voice**        | Gemini 2.0 Flash Realtime (via `@livekit/agents-plugin-google`) |
| **AI Text/Audit**   | `@google/genai` SDK — Gemini Flash                              |
| **WebRTC**          | LiveKit Cloud (room management, VAD, barge-in)                  |
| **Frontend**        | Next.js 16, React 18, TailwindCSS                               |
| **Backend**         | Node.js custom server with WebSocket                            |
| **Database**        | PostgreSQL + Prisma ORM                                         |
| **Cloud**           | Google Cloud Run, Google Cloud Firestore, Google Cloud Build    |
| **Background Jobs** | Inngest                                                         |
| **Payments**        | Stripe                                                          |

---

## 📁 Project Structure

```
aiseo/
├── Dockerfile              # Frontend + WebSocket server
├── Dockerfile.agent        # LiveKit voice agent worker
├── docker-compose.yml      # Full local stack
├── cloudbuild.yaml         # GCP Cloud Build pipeline
├── deploy.sh               # One-shot deploy script
├── .github/workflows/      # GitHub Actions CI/CD
├── livekit-agent.ts        # Aria voice agent entry point
├── server.ts               # Custom Next.js + WebSocket server
├── src/
│   ├── app/
│   │   ├── dashboard/voice/ # Voice UI page
│   │   └── api/livekit/     # LiveKit token endpoint
│   ├── components/agents-ui/ # LiveKit React voice components
│   └── lib/
│       ├── gemini/          # Gemini AI actions
│       └── voice/           # Voice session management
└── prisma/                  # Database schema
```

---

## 📜 License

MIT © 2026 — Built with ❤️ for the Google Gemini Live Agent Challenge

---

## Devpost Submission Checklist

- **Text Description:** Use `DEVPOST_SUBMISSION.md` as the canonical submission text and copy into Devpost.
- **Public Repo:** Push this repository to a public GitHub repo and include the URL in your Devpost entry.
- **Spin-up Instructions:** Point judges to this README's "Local Setup" and the `deploy.sh` script for Cloud Run.
- **GCP Proof:** Record a short screencast showing the Cloud Run service and logs (or include a link to a service YAML/Cloud Build step in the repo). See `DEVPOST_SUBMISSION.md` for suggested screenshots/recording steps.
- **Architecture Diagram:** The system diagram is in `docs/architecture.mmd` — include it in the Devpost file upload.
- **Demo Video:** Keep it under 4 minutes and show live interaction (voice + screenshot analysis + tool calls). Use the demo script in `DEVPOST_SUBMISSION.md`.
