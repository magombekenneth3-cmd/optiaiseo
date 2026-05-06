#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — One-shot GCP Cloud Run deployment for AISEO
#
# Prerequisites:
#   - gcloud CLI installed & authenticated (gcloud auth login)
#   - PROJECT_ID exported or passed as first arg
#
# Usage:
#   ./deploy.sh                    # uses $GCP_PROJECT_ID env var
#   ./deploy.sh my-gcp-project-id  # explicit project
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_ID="${1:-${GCP_PROJECT_ID:-}}"
REGION="us-central1"
REPO="aiseo-repo"
FRONTEND_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/aiseo-frontend"
AGENT_IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/aiseo-agent"

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: GCP project ID required."
  echo "   Usage: ./deploy.sh <project-id>  OR  export GCP_PROJECT_ID=<project-id>"
  exit 1
fi

echo "🚀 Deploying AISEO to Google Cloud Run"
echo "   Project : $PROJECT_ID"
echo "   Region  : $REGION"
echo ""

# ── Enable required GCP APIs ────────────────────────────────────────────────
echo "── Enabling required GCP APIs ───────────────────────────────────────"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID" --quiet

# ── Seed secrets from local .env if they don't exist yet ──────────────────
if [ -f ".env" ]; then
  echo ""
  echo "── Syncing .env secrets to GCP Secret Manager ──────────────────────"
  while IFS='=' read -r key value; do
    # Skip comments, blank lines, and lines without a value
    [[ "$key" =~ ^#.*$ || -z "$key" || -z "$value" ]] && continue
    # Strip surrounding quotes from value
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    # Create or update the secret
    if gcloud secrets describe "$key" --project="$PROJECT_ID" &>/dev/null; then
      echo -n "$value" | gcloud secrets versions add "$key" --data-file=- --project="$PROJECT_ID" --quiet
    else
      echo -n "$value" | gcloud secrets create "$key" --data-file=- --replication-policy=automatic --project="$PROJECT_ID" --quiet
    fi
    echo "  ✓ $key"
  done < .env
  echo "  Secrets synced."
else
  echo "⚠️  No .env file found — skipping secret sync. Secrets must already exist in GCP Secret Manager."
fi

# ── Authenticate & set project ─────────────────────────────────────────────
gcloud config set project "$PROJECT_ID"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

# ── Create Artifact Registry repo if it doesn't exist ─────────────────────
gcloud artifacts repositories describe "$REPO" \
  --location="$REGION" --quiet 2>/dev/null || \
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="AISEO container images"

echo ""
echo "── Step 1/4: Building Frontend image ────────────────────────────────"
docker build -t "$FRONTEND_IMAGE" -f Dockerfile .
docker push "$FRONTEND_IMAGE"

echo ""
echo "── Step 2/4: Building Agent image ───────────────────────────────────"
docker build -t "$AGENT_IMAGE" -f Dockerfile.agent .
docker push "$AGENT_IMAGE"

echo ""
echo "── Step 3/4: Deploying Frontend to Cloud Run ────────────────────"
gcloud run deploy aiseo-frontend \
  --image="$FRONTEND_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=3000 \
  --memory=1Gi \
  --cpu=2 \
  --concurrency=80 \
  --min-instances=1 \
  --max-instances=20 \
  --timeout=60 \
  --session-affinity \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="\
DATABASE_URL=DATABASE_URL:latest,\
NEXTAUTH_SECRET=NEXTAUTH_SECRET:latest,\
NEXTAUTH_URL=NEXTAUTH_URL:latest,\
NEXT_PUBLIC_APP_URL=NEXT_PUBLIC_APP_URL:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
LIVEKIT_URL=LIVEKIT_URL:latest,\
LIVEKIT_API_KEY=LIVEKIT_API_KEY:latest,\
LIVEKIT_API_SECRET=LIVEKIT_API_SECRET:latest,\
GOOGLE_ID=GOOGLE_ID:latest,\
GOOGLE_SECRET=GOOGLE_SECRET:latest,\
GITHUB_ID=GITHUB_ID:latest,\
GITHUB_SECRET=GITHUB_SECRET:latest,\
OPENAI_API_KEY=OPENAI_API_KEY:latest,\
ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,\
PERPLEXITY_API_KEY=PERPLEXITY_API_KEY:latest,\
SERPER_API_KEY=SERPER_API_KEY:latest,\
STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest,\
STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest,\
RESEND_API_KEY=RESEND_API_KEY:latest,\
CRON_SECRET=CRON_SECRET:latest,\
UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,\
UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest"

echo ""
echo "── Step 4/4: Deploying Agent Worker to Cloud Run ────────────────"
gcloud run deploy aiseo-agent \
  --image="$AGENT_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --port=8081 \
  --memory=2Gi \
  --cpu=4 \
  --concurrency=10 \
  --min-instances=1 \
  --max-instances=10 \
  --timeout=3600 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="\
DATABASE_URL=DATABASE_URL:latest,\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
LIVEKIT_URL=LIVEKIT_URL:latest,\
LIVEKIT_API_KEY=LIVEKIT_API_KEY:latest,\
LIVEKIT_API_SECRET=LIVEKIT_API_SECRET:latest,\
UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,\
UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest"

echo ""
FRONTEND_URL=$(gcloud run services describe aiseo-frontend \
  --region="$REGION" --format="value(status.url)")
echo "✅ Deployment complete!"
echo "   Frontend URL: $FRONTEND_URL"
echo "   Agent is running as a private internal service."
echo ""
echo "⚠️  Don't forget to set your environment variables as Cloud Run secrets!"
echo "   Run: gcloud run services update aiseo-frontend --region=$REGION --set-secrets=..."
