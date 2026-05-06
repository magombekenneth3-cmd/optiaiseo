-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'AGENCY_ADMIN', 'EDITOR', 'CLIENT_VIEWER');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestPath" TEXT NOT NULL DEFAULT '',
    "requestChecksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + '24:00:00'::interval),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "subscriptionTier" TEXT NOT NULL DEFAULT 'FREE',
    "trialEndsAt" TIMESTAMP(3),
    "preferences" JSONB,
    "whiteLabel" JSONB,
    "gscConnected" BOOLEAN NOT NULL DEFAULT false,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "viewerId" TEXT,
    "domain" TEXT NOT NULL,
    "targetKeyword" TEXT,
    "operatingMode" TEXT NOT NULL DEFAULT 'REPORT_ONLY',
    "githubRepoUrl" TEXT,
    "mediumToken" TEXT,
    "hashnodeToken" TEXT,
    "hashnodePublicationId" TEXT,
    "coreServices" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blogTone" TEXT DEFAULT 'Authoritative & Professional',
    "techStack" TEXT DEFAULT 'nextjs',
    "authorName" TEXT,
    "authorRole" TEXT,
    "authorBio" TEXT,
    "realExperience" TEXT,
    "realNumbers" TEXT,
    "localContext" TEXT,
    "plannerState" JSONB,
    "niche" TEXT,
    "location" TEXT,
    "targetCustomer" TEXT,
    "wordPressConfig" JSONB,
    "ghostConfig" JSONB,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandFact" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "factType" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AhrefsSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "domainRating" DOUBLE PRECISION,
    "organicTraffic" INTEGER,
    "backlinks" INTEGER,
    "referringDomains" INTEGER,
    "topKeywords" JSONB,
    "backlinkDomains" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AhrefsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "intent" TEXT,
    "position" INTEGER NOT NULL,
    "url" TEXT,
    "device" TEXT NOT NULL DEFAULT 'desktop',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiShareOfVoice" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "modelName" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "brandMentioned" BOOLEAN NOT NULL DEFAULT false,
    "competitorsMentioned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiShareOfVoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklinkAlert" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "dr" DOUBLE PRECISION,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklinkAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnPageReport" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "issues" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnPageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "categoryScores" JSONB NOT NULL,
    "issueList" JSONB NOT NULL,
    "fixStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lcp" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "inp" DOUBLE PRECISION,
    "runTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pipelineType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metaDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "targetKeywords" TEXT[],
    "hashnodeUrl" TEXT,
    "mediumUrl" TEXT,
    "wordPressUrl" TEXT,
    "ghostUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "ogImage" TEXT,
    "needsRefresh" BOOLEAN NOT NULL DEFAULT false,
    "interactiveWidget" TEXT,
    "schemaMarkup" TEXT,

    CONSTRAINT "Blog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendingTopic" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "keywords" TEXT[],
    "newsData" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendingTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "metadata" JSONB,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorKeyword" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER,
    "searchVolume" INTEGER,
    "difficulty" INTEGER,
    "url" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AeoSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "citationScore" INTEGER NOT NULL,
    "generativeShareOfVoice" INTEGER NOT NULL,
    "citationLikelihood" INTEGER NOT NULL,
    "perplexityScore" INTEGER NOT NULL,
    "chatgptScore" INTEGER NOT NULL,
    "claudeScore" INTEGER NOT NULL,
    "googleAioScore" INTEGER NOT NULL,
    "grokScore" INTEGER NOT NULL DEFAULT 0,
    "copilotScore" INTEGER NOT NULL DEFAULT 0,
    "platformBreakdown" JSONB NOT NULL,
    "failedChecks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AeoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AeoReport" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "citationScore" INTEGER NOT NULL DEFAULT 0,
    "schemaTypes" TEXT[],
    "checks" JSONB NOT NULL,
    "topRecommendations" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "citationLikelihood" INTEGER NOT NULL DEFAULT 0,
    "generativeShareOfVoice" INTEGER NOT NULL DEFAULT 0,
    "multiEngineScore" JSONB,
    "multiModelResults" JSONB,

    CONSTRAINT "AeoReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfHealingLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "impactScore" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfHealingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorAlertLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "competitor" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "oldPos" INTEGER NOT NULL,
    "newPos" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorAlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AeoEvent" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "blogId" TEXT,
    "eventType" TEXT NOT NULL,
    "intent" TEXT,
    "revenue" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AeoEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexingLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "trigger" TEXT NOT NULL,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPageAnalysis" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorPageAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_idempotencyKey_userId_key" ON "IdempotencyKey"("idempotencyKey", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Site_userId_idx" ON "Site"("userId");

-- CreateIndex
CREATE INDEX "BrandFact_siteId_idx" ON "BrandFact"("siteId");

-- CreateIndex
CREATE INDEX "RankSnapshot_siteId_keyword_idx" ON "RankSnapshot"("siteId", "keyword");

-- CreateIndex
CREATE INDEX "RankSnapshot_recordedAt_idx" ON "RankSnapshot"("recordedAt");

-- CreateIndex
CREATE INDEX "AiShareOfVoice_siteId_keyword_idx" ON "AiShareOfVoice"("siteId", "keyword");

-- CreateIndex
CREATE INDEX "AiShareOfVoice_recordedAt_idx" ON "AiShareOfVoice"("recordedAt");

-- CreateIndex
CREATE INDEX "Audit_siteId_runTimestamp_idx" ON "Audit"("siteId", "runTimestamp");

-- CreateIndex
CREATE INDEX "Blog_siteId_status_createdAt_idx" ON "Blog"("siteId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_siteId_domain_key" ON "Competitor"("siteId", "domain");

-- CreateIndex
CREATE INDEX "AeoSnapshot_siteId_idx" ON "AeoSnapshot"("siteId");

-- CreateIndex
CREATE INDEX "AeoSnapshot_createdAt_idx" ON "AeoSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "AeoReport_siteId_idx" ON "AeoReport"("siteId");

-- CreateIndex
CREATE INDEX "AeoReport_createdAt_idx" ON "AeoReport"("createdAt");

-- CreateIndex
CREATE INDEX "SelfHealingLog_siteId_idx" ON "SelfHealingLog"("siteId");

-- CreateIndex
CREATE INDEX "SelfHealingLog_createdAt_idx" ON "SelfHealingLog"("createdAt");

-- CreateIndex
CREATE INDEX "CompetitorAlertLog_siteId_sentAt_idx" ON "CompetitorAlertLog"("siteId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorAlertLog_siteId_competitor_keyword_newPos_key" ON "CompetitorAlertLog"("siteId", "competitor", "keyword", "newPos");

-- CreateIndex
CREATE INDEX "AeoEvent_siteId_idx" ON "AeoEvent"("siteId");

-- CreateIndex
CREATE INDEX "AeoEvent_createdAt_idx" ON "AeoEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_ownerId_key" ON "TeamMember"("userId", "ownerId");

-- CreateIndex
CREATE INDEX "IndexingLog_siteId_createdAt_idx" ON "IndexingLog"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "IndexingLog_status_idx" ON "IndexingLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_token_key" ON "TeamInvitation"("token");

-- CreateIndex
CREATE INDEX "CompetitorPageAnalysis_siteId_createdAt_idx" ON "CompetitorPageAnalysis"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "CompetitorPageAnalysis_userId_createdAt_idx" ON "CompetitorPageAnalysis"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandFact" ADD CONSTRAINT "BrandFact_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AhrefsSnapshot" ADD CONSTRAINT "AhrefsSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiShareOfVoice" ADD CONSTRAINT "AiShareOfVoice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklinkAlert" ADD CONSTRAINT "BacklinkAlert_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnPageReport" ADD CONSTRAINT "OnPageReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blog" ADD CONSTRAINT "Blog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorKeyword" ADD CONSTRAINT "CompetitorKeyword_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AeoSnapshot" ADD CONSTRAINT "AeoSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AeoReport" ADD CONSTRAINT "AeoReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfHealingLog" ADD CONSTRAINT "SelfHealingLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AeoEvent" ADD CONSTRAINT "AeoEvent_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "Blog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AeoEvent" ADD CONSTRAINT "AeoEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexingLog" ADD CONSTRAINT "IndexingLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPageAnalysis" ADD CONSTRAINT "CompetitorPageAnalysis_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPageAnalysis" ADD CONSTRAINT "CompetitorPageAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
