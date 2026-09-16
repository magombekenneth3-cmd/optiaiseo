/**
 * Test Factories — Week 5
 *
 * Type-safe factory builders for each domain model.
 * Each factory produces valid state for the most common lifecycle stage.
 * Override any field to test edge cases.
 */

import { stores } from "./setup";

let counter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++counter}_${Date.now()}`;
}

// Reset counter between tests
export function resetFactoryCounter() { counter = 0; }

// ── Site ───────────────────────────────────────────────────────────────────

interface SiteOverrides {
  id?: string;
  domain?: string;
  operatingMode?: "REPORT_ONLY" | "SUPERVISED" | "AUTOPILOT";
  autonomousTierLimit?: number;
  dailyBudgetUnits?: number;
  maxConcurrentMutations?: number;
  githubRepoUrl?: string | null;
  [key: string]: unknown;
}

export function createSite(overrides: SiteOverrides = {}) {
  return stores.site.create({
    data: {
      id: overrides.id ?? nextId("site"),
      domain: overrides.domain ?? "test-site.com",
      operatingMode: overrides.operatingMode ?? "SUPERVISED",
      autonomousTierLimit: overrides.autonomousTierLimit ?? 1,
      dailyBudgetUnits: overrides.dailyBudgetUnits ?? 5,
      maxConcurrentMutations: overrides.maxConcurrentMutations ?? 3,
      githubRepoUrl: overrides.githubRepoUrl ?? null,
      name: overrides.domain ?? "Test Site",
      ...overrides,
    },
  });
}

// ── GrowthDecision ─────────────────────────────────────────────────────────

interface DecisionOverrides {
  id?: string;
  siteId?: string;
  url?: string;
  action?: string;
  primaryKeyword?: string;
  status?: string;
  opportunityStatus?: string;
  [key: string]: unknown;
}

export function createDecision(overrides: DecisionOverrides = {}) {
  return stores.growthDecision.create({
    data: {
      id: overrides.id ?? nextId("decision"),
      siteId: overrides.siteId ?? "site_1",
      url: overrides.url ?? "/blog/test-article",
      action: overrides.action ?? "IMPROVE_SEARCH_INTENT",
      primaryKeyword: overrides.primaryKeyword ?? "test keyword",
      status: overrides.status ?? "APPROVED",
      opportunityStatus: overrides.opportunityStatus ?? "OPEN",
      ...overrides,
    },
  });
}

// ── BudgetReservation ──────────────────────────────────────────────────────

interface BudgetOverrides {
  id?: string;
  siteId?: string;
  status?: string;
  operationId?: string | null;
  traceId?: string | null;
  reason?: string | null;
  [key: string]: unknown;
}

export function createBudgetReservation(overrides: BudgetOverrides = {}) {
  return stores.budgetReservation.create({
    data: {
      id: overrides.id ?? nextId("budget"),
      siteId: overrides.siteId ?? "site_1",
      status: overrides.status ?? "RESERVED",
      operationId: overrides.operationId ?? null,
      traceId: overrides.traceId ?? null,
      reason: overrides.reason ?? null,
      reservedAt: new Date(),
      consumedAt: overrides.status === "CONSUMED" ? new Date() : null,
      releasedAt: overrides.status === "RELEASED" ? new Date() : null,
      ...overrides,
    },
  });
}

// ── CircuitBreaker ─────────────────────────────────────────────────────────

interface CircuitOverrides {
  id?: string;
  siteId?: string;
  channel?: string;
  state?: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  lastFailureAt?: Date | null;
  openedAt?: Date | null;
  nextAttemptAt?: Date | null;
  halfOpenProbeInFlight?: boolean;
  [key: string]: unknown;
}

export function createCircuitBreaker(overrides: CircuitOverrides = {}) {
  return stores.circuitBreaker.create({
    data: {
      id: overrides.id ?? nextId("circuit"),
      siteId: overrides.siteId ?? "site_1",
      channel: overrides.channel ?? "wordpress",
      state: overrides.state ?? "CLOSED",
      consecutiveFailures: overrides.consecutiveFailures ?? 0,
      consecutiveSuccesses: overrides.consecutiveSuccesses ?? 0,
      lastFailureAt: overrides.lastFailureAt ?? null,
      lastSuccessAt: overrides.lastSuccessAt ?? null,
      openedAt: overrides.openedAt ?? null,
      nextAttemptAt: overrides.nextAttemptAt ?? null,
      halfOpenProbeInFlight: overrides.halfOpenProbeInFlight ?? false,
      ...overrides,
    },
  });
}

// ── ExecutionClaim ──────────────────────────────────────────────────────────

interface ClaimOverrides {
  id?: string;
  siteId?: string;
  opportunityId?: string;
  proposalId?: string;
  claimedBy?: string;
  status?: string;
  generation?: number;
  [key: string]: unknown;
}

export function createExecutionClaim(overrides: ClaimOverrides = {}) {
  return stores.autonomousExecutionClaim.create({
    data: {
      id: overrides.id ?? nextId("claim"),
      siteId: overrides.siteId ?? "site_1",
      opportunityId: overrides.opportunityId ?? nextId("opp"),
      proposalId: overrides.proposalId ?? nextId("proposal"),
      claimedBy: overrides.claimedBy ?? "host:test:1000",
      status: overrides.status ?? "ACTIVE",
      generation: overrides.generation ?? 1,
      claimedAt: new Date(),
      ...overrides,
    },
  });
}

// ── ExecutionTrace ─────────────────────────────────────────────────────────

interface TraceOverrides {
  id?: string;
  siteId?: string;
  opportunityId?: string;
  actionType?: string;
  safetyTier?: number;
  operatingMode?: string;
  policyDecision?: string;
  policyReason?: string;
  effectiveTierLimit?: number;
  triggerType?: string;
  actorType?: string;
  opportunityScore?: number;
  executionResult?: string | null;
  operationId?: string | null;
  verificationStatus?: string | null;
  [key: string]: unknown;
}

export function createExecutionTrace(overrides: TraceOverrides = {}) {
  return stores.executionTrace.create({
    data: {
      id: overrides.id ?? nextId("trace"),
      siteId: overrides.siteId ?? "site_1",
      opportunityId: overrides.opportunityId ?? nextId("opp"),
      actionType: overrides.actionType ?? "UPDATE_META_DESCRIPTION",
      safetyTier: overrides.safetyTier ?? 1,
      operatingMode: overrides.operatingMode ?? "SUPERVISED",
      policyDecision: overrides.policyDecision ?? "AUTHORIZED",
      policyReason: overrides.policyReason ?? "Authorized",
      effectiveTierLimit: overrides.effectiveTierLimit ?? 1,
      triggerType: overrides.triggerType ?? "CRON",
      actorType: overrides.actorType ?? "SYSTEM",
      opportunityScore: overrides.opportunityScore ?? 75,
      executionResult: overrides.executionResult ?? null,
      operationId: overrides.operationId ?? null,
      verificationStatus: overrides.verificationStatus ?? null,
      discoveredAt: new Date(),
      ...overrides,
    },
  });
}

// ── MutationOperation ──────────────────────────────────────────────────────

interface OperationOverrides {
  id?: string;
  siteId?: string;
  status?: string;
  actorId?: string;
  actorType?: string;
  mutationType?: string;
  targetModel?: string;
  targetId?: string;
  expectedVersion?: number;
  currentVersion?: number;
  riskLevel?: string;
  riskScore?: number;
  idempotencyKey?: string | null;
  [key: string]: unknown;
}

export function createMutationOperation(overrides: OperationOverrides = {}) {
  return stores.mutationOperation.create({
    data: {
      id: overrides.id ?? nextId("op"),
      siteId: overrides.siteId ?? "site_1",
      status: overrides.status ?? "PROPOSED",
      actorId: overrides.actorId ?? "system:growth-engine",
      actorType: overrides.actorType ?? "SYSTEM",
      mutationType: overrides.mutationType ?? "BLOG_CONTENT_UPDATE",
      targetModel: overrides.targetModel ?? "Blog",
      targetId: overrides.targetId ?? nextId("blog"),
      expectedVersion: overrides.expectedVersion ?? 1,
      currentVersion: overrides.currentVersion ?? 1,
      riskLevel: overrides.riskLevel ?? "LOW",
      riskScore: overrides.riskScore ?? 15,
      idempotencyKey: overrides.idempotencyKey ?? null,
      ...overrides,
    },
  });
}

// ── Experiment (D.5 format) ────────────────────────────────────────────────

interface ExperimentOverrides {
  id?: string;
  siteId?: string;
  status?: string;
  outcome?: string | null;
  outcomeConfidence?: number | null;
  decisionId?: string | null;
  opportunityId?: string | null;
  hypothesis?: string;
  successMetric?: string;
  successThreshold?: number;
  configHash?: string;
  [key: string]: unknown;
}

export function createExperiment(overrides: ExperimentOverrides = {}) {
  return stores.experiment.create({
    data: {
      id: overrides.id ?? nextId("exp"),
      siteId: overrides.siteId ?? "site_1",
      status: overrides.status ?? "COMPLETED",
      outcome: overrides.outcome ?? "WIN",
      outcomeConfidence: overrides.outcomeConfidence ?? 0.85,
      decisionId: overrides.decisionId ?? null,
      opportunityId: overrides.opportunityId ?? nextId("opp"),
      hypothesis: overrides.hypothesis ?? "This action will improve rankings",
      successMetric: overrides.successMetric ?? "position",
      successThreshold: overrides.successThreshold ?? -2.0,
      configVersion: "d5-v1",
      configHash: overrides.configHash ?? "sha256_test_hash",
      maxDurationDays: 28,
      maxMutationCount: 1,
      maxBudgetUnits: 1,
      completedAt: overrides.status === "COMPLETED" ? new Date() : null,
      ...overrides,
    },
  });
}

// ── ExperimentVariant ──────────────────────────────────────────────────────

interface VariantOverrides {
  id?: string;
  experimentId?: string;
  variantKey?: string;
  isControl?: boolean;
  actionType?: string | null;
  baselineMetrics?: Record<string, unknown> | null;
  postMetrics?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export function createExperimentVariant(overrides: VariantOverrides = {}) {
  return stores.experimentVariant.create({
    data: {
      id: overrides.id ?? nextId("variant"),
      experimentId: overrides.experimentId ?? "exp_1",
      variantKey: overrides.variantKey ?? (overrides.isControl ? "control" : "treatment"),
      isControl: overrides.isControl ?? false,
      actionType: overrides.actionType ?? "IMPROVE_SEARCH_INTENT",
      baselineMetrics: overrides.baselineMetrics ?? { position: 15, clicks: 100, impressions: 5000, ctr: 0.02 },
      postMetrics: overrides.postMetrics ?? { position: 8, clicks: 180, impressions: 6000, ctr: 0.03 },
      ...overrides,
    },
  });
}

// ── LearnedSignal ──────────────────────────────────────────────────────────

interface SignalOverrides {
  id?: string;
  siteId?: string;
  signalType?: string;
  actionType?: string;
  adjustment?: number;
  magnitude?: string;
  derivedFrom?: number;
  winRate?: number;
  reason?: string;
  status?: string;
  version?: number;
  [key: string]: unknown;
}

export function createLearnedSignal(overrides: SignalOverrides = {}) {
  return stores.learnedSignal.create({
    data: {
      id: overrides.id ?? nextId("signal"),
      siteId: overrides.siteId ?? "site_1",
      signalType: overrides.signalType ?? "RISK_ADJUSTMENT",
      actionType: overrides.actionType ?? "IMPROVE_SEARCH_INTENT",
      adjustment: overrides.adjustment ?? -10,
      magnitude: overrides.magnitude ?? "MODERATE",
      derivedFrom: overrides.derivedFrom ?? 8,
      winRate: overrides.winRate ?? 0.75,
      reason: overrides.reason ?? "Test signal",
      status: overrides.status ?? "ACTIVE",
      version: overrides.version ?? 1,
      activatedAt: overrides.status === "ACTIVE" ? new Date() : null,
      ...overrides,
    },
  });
}

// ── SelfHealingLog ─────────────────────────────────────────────────────────

interface HealingLogOverrides {
  id?: string;
  siteId?: string;
  issueType?: string;
  description?: string;
  actionTaken?: string;
  impactScore?: number | null;
  status?: string;
  fingerprint?: string | null;
  dedupeBucket?: string | null;
  [key: string]: unknown;
}

export function createSelfHealingLog(overrides: HealingLogOverrides = {}) {
  return stores.selfHealingLog.create({
    data: {
      id: overrides.id ?? nextId("heal"),
      siteId: overrides.siteId ?? "site_1",
      issueType: overrides.issueType ?? "GSOV_DROP",
      description: overrides.description ?? "Test healing action",
      actionTaken: overrides.actionTaken ?? "LOGGED_ALERT",
      impactScore: overrides.impactScore ?? 5,
      status: overrides.status ?? "COMPLETED",
      fingerprint: overrides.fingerprint ?? null,
      dedupeBucket: overrides.dedupeBucket ?? null,
      ...overrides,
    },
  });
}

// ── AeoReport ──────────────────────────────────────────────────────────────

interface AeoReportOverrides {
  id?: string;
  siteId?: string;
  generativeShareOfVoice?: number;
  checks?: unknown[];
  [key: string]: unknown;
}

export function createAeoReport(overrides: AeoReportOverrides = {}) {
  return stores.aeoReport.create({
    data: {
      id: overrides.id ?? nextId("aeo"),
      siteId: overrides.siteId ?? "site_1",
      generativeShareOfVoice: overrides.generativeShareOfVoice ?? 50,
      checks: overrides.checks ?? [],
      createdAt: overrides.createdAt ?? new Date(),
      ...overrides,
    },
  });
}

// ── Blog ───────────────────────────────────────────────────────────────────

interface BlogOverrides {
  id?: string;
  siteId?: string;
  slug?: string;
  title?: string;
  content?: string;
  status?: string;
  version?: number;
  [key: string]: unknown;
}

export function createBlog(overrides: BlogOverrides = {}) {
  return stores.blog.create({
    data: {
      id: overrides.id ?? nextId("blog"),
      siteId: overrides.siteId ?? "site_1",
      slug: overrides.slug ?? "test-article",
      title: overrides.title ?? "Test Article",
      content: overrides.content ?? "<h1>Test</h1><p>Content here.</p>",
      status: overrides.status ?? "PUBLISHED",
      version: overrides.version ?? 1,
      ...overrides,
    },
  });
}
