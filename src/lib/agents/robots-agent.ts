import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { CrawlSnapshot } from "./snapshots";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RobotsAnalysisData {
  hasRobotsTxt: boolean;
  disallowedPathCount: number;
  hasSitemapDeclaration: boolean;
  blockedImportantPaths: string[];
  blockedResourcePaths: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeRobots(
  siteId: string,
  snapshot: CrawlSnapshot,
): AgentExecution<RobotsAnalysisData> {
  const findings: AgentFinding[] = [];
  const { crawlResult, discoveryData } = snapshot;
  const { robotsTxt } = discoveryData;

  const hasRobotsTxt = robotsTxt.raw.length > 0;
  const hasSitemapDeclaration = robotsTxt.sitemapDeclarations.length > 0;
  const blockedPaths = robotsTxt.disallowedPaths;

  const blockedImportantPaths: string[] = [];
  const blockedResourcePaths: string[] = [];

  if (!hasRobotsTxt) {
    // Finding already created by discovery agent, skip here
    return {
      data: {
        hasRobotsTxt,
        disallowedPathCount: 0,
        hasSitemapDeclaration: false,
        blockedImportantPaths: [],
        blockedResourcePaths: [],
      },
      findings: [],
      itemsProcessed: 0,
    };
  }

  // Check if important page patterns are blocked
  const importantPatterns = ["/", "/blog", "/products", "/pricing", "/about"];
  for (const pattern of importantPatterns) {
    if (blockedPaths.some((bp) => pattern.startsWith(bp) && bp !== "/")) {
      blockedImportantPaths.push(pattern);
    }
  }

  if (blockedImportantPaths.length > 0) {
    findings.push({
      type: "IMPORTANT_PATH_BLOCKED",
      severity: "HIGH",
      title: "Important page paths blocked by robots.txt",
      description: `robots.txt blocks ${blockedImportantPaths.length} important path(s): ${blockedImportantPaths.join(", ")}. This may prevent search engines from indexing critical pages.`,
      evidence: [
        {
          sourceType: "ROBOTS",
          metric: "blockedPaths",
          value: String(blockedImportantPaths.length),
          metadata: { paths: blockedImportantPaths },
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: snapshot.domain },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "IMPORTANT_PATH_BLOCKED",
        resourceType: "SITE",
        resourceId: snapshot.domain,
      }),
    });
  }

  // Check if CSS/JS resources are blocked (affects rendering)
  const resourcePatterns = ["/css", "/js", "/_next", "/static", "/assets"];
  for (const pattern of resourcePatterns) {
    if (blockedPaths.some((bp) => bp === pattern || bp === `${pattern}/`)) {
      blockedResourcePaths.push(pattern);
    }
  }

  if (blockedResourcePaths.length > 0) {
    findings.push({
      type: "RESOURCES_BLOCKED",
      severity: "HIGH",
      title: "CSS/JS resources blocked by robots.txt",
      description: `robots.txt blocks ${blockedResourcePaths.length} resource path(s): ${blockedResourcePaths.join(", ")}. Google needs access to CSS and JavaScript to properly render and index pages.`,
      evidence: [
        {
          sourceType: "ROBOTS",
          metric: "blockedResourcePaths",
          value: String(blockedResourcePaths.length),
          metadata: { paths: blockedResourcePaths },
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: snapshot.domain },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "RESOURCES_BLOCKED",
        resourceType: "SITE",
        resourceId: snapshot.domain,
      }),
    });
  }

  // Check for overly broad disallow rules
  if (blockedPaths.includes("/")) {
    findings.push({
      type: "ENTIRE_SITE_BLOCKED",
      severity: "CRITICAL",
      title: "Entire site blocked by robots.txt",
      description: `robots.txt contains "Disallow: /" which blocks search engines from crawling the entire site. This is almost certainly unintentional for a public website.`,
      evidence: [
        {
          sourceType: "ROBOTS",
          metric: "disallowAll",
          value: "true",
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "SITE", id: snapshot.domain },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "ENTIRE_SITE_BLOCKED",
        resourceType: "SITE",
        resourceId: snapshot.domain,
      }),
    });
  }

  // Check for missing sitemap declaration
  if (!hasSitemapDeclaration) {
    // Finding already created by discovery agent, skip here
  }

  // Check for crawled pages that are blocked by robots.txt
  const crawledButBlocked = crawlResult.linkGraph.filter((node) =>
    isBlockedByRobots(node.url, blockedPaths),
  );

  if (crawledButBlocked.length > 0) {
    for (const node of crawledButBlocked.slice(0, 10)) {
      findings.push({
        type: "CRAWLED_BUT_BLOCKED",
        severity: "MEDIUM",
        title: "Internally linked page is blocked by robots.txt",
        description: `${node.url} is linked from other pages but is blocked by robots.txt. Either remove the disallow rule or remove the internal links.`,
        evidence: [
          {
            sourceType: "ROBOTS",
            metric: "blocked",
            value: "true",
            observedAt: new Date().toISOString(),
          },
          {
            sourceType: "CRAWL",
            sourceId: node.url,
            metric: "inboundLinks",
            value: String(node.inboundCount),
            observedAt: new Date().toISOString(),
          },
        ],
        confidence: 1.0,
        affectedResource: { type: "PAGE", id: node.url },
        fingerprint: createFindingFingerprint({
          siteId,
          type: "CRAWLED_BUT_BLOCKED",
          resourceType: "PAGE",
          resourceId: node.url,
        }),
      });
    }
  }

  return {
    data: {
      hasRobotsTxt,
      disallowedPathCount: blockedPaths.length,
      hasSitemapDeclaration,
      blockedImportantPaths,
      blockedResourcePaths,
    },
    findings,
    itemsProcessed: blockedPaths.length,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isBlockedByRobots(url: string, disallowedPaths: string[]): boolean {
  try {
    const pathname = new URL(url).pathname;
    return disallowedPaths.some(
      (blocked) => blocked !== "/" && pathname.startsWith(blocked),
    );
  } catch {
    return false;
  }
}
