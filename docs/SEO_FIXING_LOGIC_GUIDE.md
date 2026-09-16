# Senior Guide: SEO Diagnosis and Fixing Logic

## Purpose and current design

OptiAISEO is not merely an audit UI. Its intended control loop is:

```text
Fetch once -> run audit modules -> normalize findings -> rank work
    -> generate a bounded fix or manual guide -> human reviews a PR
    -> deploy -> wait for indexed/field evidence -> measure impact
```

The first five stages are implemented. The last two need stronger release and measurement gates before the product can honestly operate as an autonomous remediation system.

The main implementation points are:

| Concern | Primary code |
| --- | --- |
| Audit profiles and module selection | `src/lib/seo-audit/index.ts` |
| Parallel execution, score calculation, recommendation ordering | `src/lib/seo-audit/engine.ts` |
| Technical crawlability/performance checks | `src/lib/seo-audit/modules/technical.ts` |
| robots.txt and sitemap validation | `src/lib/onpage/validator.ts` |
| Interactive AI/manual repair | `src/app/actions/auditFix.ts` |
| PR creation guardrails | `src/lib/github/index.ts` |
| Autonomous AEO regression response | `src/lib/self-healing/engine.ts` |
| Post-fix audit trigger | `src/lib/self-healing/measure-impact.ts` |

## How the present logic works

### 1. Diagnose

`AuditEngine.runAudit()` fetches the target HTML once, then runs the selected modules concurrently. This avoids repeated cold-start requests. Each module has a 45-second limit and the complete audit has a 90-second limit; a module failure is retained in telemetry and excluded from the overall-score average.

Profiles have deliberately different coverage:

- `free`: on-page, technical, content quality
- `page`: page-focused checks including schema, accessibility, image SEO, AEO
- `full`: the complete set, including off-page, local, performance, social and brand/entity checks

This is a good separation, but the UI and API must always expose the profile and failed-module count. A score from three successful checks is not comparable to a full-site score from fifteen.

### 2. Convert findings into a queue

Failed or warning checklist items with recommendations become `NormalizedRecommendation` records. They are ordered by:

`priorityScore = ROI impact x 0.60 + AI visibility impact x 0.40`

There is a second priority model, `computePriority()`, based on estimated traffic impact, ease, and confidence. These two models are currently separate. That makes it possible for the same issue to rank differently depending on which flow presents it.

### 3. Generate a remediation

`triggerAutoFix()` authenticates the caller, confirms site ownership, rate-limits the operation, detects the framework, and limits the model prompt to inferred allowed files. Static guides are preferred for known issues; otherwise Gemini returns one replacement file or a manual guide. Output passes path/content validation, sanitisation, and a confidence threshold.

The review flow returns content to the client. `pushAuditFixPR()` then checks ownership again and creates a branch and PR. The GitHub layer rejects unsafe paths, protected prefixes, oversized files, and duplicate operation branches.

### 4. Self-heal

`generateHealingPlan()` compares the two newest AEO reports. A material GSoV drop or a failed formerly-passing high/medium-impact check can create an alert, content recommendation, or PR action. Duplicate fingerprints suppress repeated actions within 24 hours. In AUTOPILOT mode, generated code undergoes lightweight QA and may be sent to GitHub.

## What is strong already

- Single HTML fetch, parallel modules, per-module timeouts, and telemetry are sound operational choices.
- The technical validator makes a real attempt to parse robots rules and inspect sitemap depth rather than checking only for a 200 response.
- Fix generation has ownership checks, quotas, framework awareness, static fallbacks, a confidence gate, and PR-based delivery instead of direct production writes.
- GitHub branch names are operation-specific, which prevents a retry from force-overwriting an existing branch.
- Self-healing has a kill-switch path, action fingerprints, and retains an audit log.

## Senior review: risks to fix before expanding automation

### P0 — prevent destructive or invalid changes

1. **The model is asked for an entire file, but does not receive the repository file it replaces.** A syntactically valid `app/layout.tsx` can silently delete analytics, fonts, existing JSON-LD, redirects, or unrelated metadata. `createAutoFixPR()` writes the supplied file content as a full blob.

   Replace full-file generation with a structured patch contract: `{ path, baseBlobSha, unifiedDiff, rationale, checks }`. Read the current file from GitHub, apply the patch server-side, reject a SHA mismatch, and show a diff. Permit generated full files only for brand-new `robots.txt` or sitemap files.

2. **The final PR action does not reapply the framework allowlist.** `triggerAutoFix()` validates model output, but `pushAuditFixPR()` accepts any non-traversal path. Browser/client state must never be treated as an authorization boundary.

   Persist a short-lived, signed server-side fix proposal containing site ID, allowed path, base SHA, content hash, issue ID, expiry, and generation ID. `pushAuditFixPR()` must load it and reject all client-supplied path/content values that do not match.

3. **Generated fixes are not compiled or tested against the target repository.** Content validation and heuristic confidence are useful filters, not evidence that a Next.js app builds.

   Add a required CI status check to auto-fix PRs. At minimum run formatting, typecheck, lint, and build; add a targeted metadata/robots/schema test per fix type. Never auto-merge generated changes.

### P1 — correct diagnosis and prioritisation

4. **The overall SEO score is an unweighted arithmetic mean of module scores.** A failed indexing check can be diluted by many cosmetic passes, and audit profiles are not comparable.

   Publish three values: `indexabilityGate`, weighted `technical/content/authority` score, and `coverage` (completed weighted checks / expected checks). Make an indexing block cap the public health score until fixed. Weight check severity, affected URL count, confidence, and business scope—not only module averages.

5. **There are two incompatible ranking models.** `SCORING_WEIGHTS` in the engine and `computePriority()` in the types file lead to inconsistent backlogs.

   Define one versioned `PrioritizationPolicy`. Inputs should include severity, affected pages, indexability, expected organic value, effort, confidence, and recency. Store the policy version and components with every recommendation so ranking can be explained and changed safely.

6. **Several technical pass/fail checks prove presence, not correctness.** A `robots.txt` can exist while blocking the audited URL; a sitemap can be reachable but malformed, stale, non-canonical, or exclude important URLs. The page check also does not demonstrate response-header `X-Robots-Tag`, canonical consistency, redirect behavior, or Google index status.

   Treat fetch results as evidence with a scope. Resolve the canonical URL, evaluate robots rules for Googlebot against that exact path, inspect headers, parse XML namespaces and child sitemap indexes recursively within limits, and cross-check with Search Console when authorized. Report “unknown” when evidence is absent; do not convert unknown to pass.

7. **AEO/GSoV movement is treated as a technical regression too readily.** Model responses and competitor movement are noisy; the current comparison uses only two reports and can generate a repair after a score swing without a deployment correlation.

   Require a sustained change over a baseline window, annotate site deployments/content changes, and demand check-level evidence before creating a PR. In AUTOPILOT, permit alerts by default; require explicit approval for any fix not tied to a verified technical regression.

### P1 — measure real outcomes, not immediate activity

8. **Impact measurement is dispatched immediately after PR creation.** A PR may never merge or deploy, and crawling/indexing/field-performance outcomes cannot appear at that time.

   Model the lifecycle explicitly: `proposed -> PR opened -> merged -> deployed -> recrawled -> observed -> measured/rolled back`. Trigger validation after deployment evidence and measure at distinct windows: immediate technical recrawl, 7–14 day indexing/CTR observation, and 28-day trend comparison. Use a comparable control set where possible.

9. **Duplicate suppression is not atomic.** Reading recent logs and then creating a log has a race under concurrent jobs.

   Persist a deterministic action fingerprint with a database unique constraint covering `siteId`, fingerprint, and time bucket (or use a durable idempotency key). Let the database arbitrate duplicate creation.

## Recommended target architecture

```text
Evidence collection
  -> normalized issue (scope, URLs, evidence, confidence, policy version)
  -> prioritization policy
  -> remediation planner
       -> deterministic template where possible
       -> bounded AI patch only when necessary
  -> server-side patch application against a pinned base SHA
  -> static validation + isolated CI
  -> reviewable PR
  -> merge/deployment webhook
  -> recrawl + Search Console/field-data observation
  -> causal impact record or rollback alert
```

The key design rule is: AI may propose a constrained change; it must not be the source of truth for site state, authorization, validation, or measured outcome.

## Remediation policy by issue class

| Class | Default action | Automation level | Acceptance evidence |
| --- | --- | --- | --- |
| Indexability: noindex, robots, canonical, redirects | Blocker; inspect exact URL and headers | Draft only | URL allowed, canonical resolves, expected 200/3xx chain, GSC inspection when available |
| Sitemap | Validate entries and canonical URLs | Deterministic patch preferred | XML parses, URLs return expected status, submitted/processed in GSC |
| Titles/descriptions/OG | Review content and duplicate cluster | Bounded patch | Unique metadata, rendered tags, no unintended replacement |
| Structured data | Generate from page facts, not generic claims | Patch + schema test | Valid JSON-LD, type matches page, Rich Results validation where applicable |
| Core Web Vitals | Diagnose traces and real-user data | Recommendation only | Lab regression avoided; field metric improves over a full collection window |
| Internal links | Crawl graph and determine orphan/priority pages | Suggested patch | Links render, destination is canonical/indexable, crawl depth improves |
| AEO/GSoV | Treat as experiment/monitoring signal | Alert first | Repeated sample with prompt/model/version and confidence interval |

## Delivery plan

### Phase 1: safety foundations

1. Create a `FixProposal` record and signed approval token.
2. Change model output from full content to a unified diff pinned to the repository blob SHA.
3. Validate the proposal again in `pushAuditFixPR()` and reject tampered paths/content.
4. Add tests for traversal, allowlist bypass, stale SHA, protected file changes, and prompt-injection-like issue text.

### Phase 2: reliable audit evidence

1. Add an evidence model to each checklist item: fetch timestamp, URL, HTTP response, source, confidence, and unknown reason.
2. Implement exact-path robots/header/canonical evaluation and robust sitemap parsing.
3. Consolidate the two priority functions into one stored policy.
4. Make score coverage and audit profile first-class UI/API fields.

### Phase 3: verified execution

1. Run generated PRs through isolated CI and required repository checks.
2. Consume merge/deploy webhooks; do not assume that PR creation means deployment.
3. Schedule recrawls and delayed GSC/CrUX measurement.
4. Make self-healing alert-only until this lifecycle is operational and observed false-positive rates are acceptable.

## Definition of done for any automated fix

- The issue is reproducible with stored evidence.
- The fix is the smallest possible diff and is pinned to the source revision.
- Authorization, allowed paths, and content hash are enforced server-side at dispatch time.
- Validation includes syntax/type/build checks plus an issue-specific assertion.
- A human can understand the PR, affected URLs, evidence, rollback path, and expected outcome.
- Deployment is confirmed independently of GitHub PR creation.
- The issue is rechecked after deployment; business impact is recorded only after an appropriate observation window.
- If proof is missing, the outcome is `unknown`, never `fixed`.

## Useful regression test matrix

| Scenario | Expected result |
| --- | --- |
| `X-Robots-Tag: noindex` with no HTML robots tag | Indexability failure |
| robots allows root but blocks audited path | Crawlability failure for that URL |
| sitemap index with an inaccessible child | Warning with child URL evidence |
| model proposes `../../.env` or a non-allowlisted path | Proposal and PR rejected |
| repository file changes after proposal generation | SHA conflict; regenerate proposal |
| malformed generated TSX | CI fails; no auto-merge/measurement |
| GSoV drops once without technical regression | Alert only, no PR |
| PR opened but not merged | State remains proposed/open; no impact claim |
| deployment confirmed and issue persists | Mark ineffective; suppress repeat and escalate |
