

import { createFindingFingerprint } from "./fingerprint";
import type { AgentExecution, AgentFinding } from "./types";
import type { CrawlSnapshot } from "./snapshots";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InternalLinkData {
  totalPages: number;
  orphanCount: number;
  deepCount: number;
  avgDepth: number;
  maxDepth: number;
  avgInboundLinks: number;
  underlinkedPages: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

export function analyzeInternalLinks(
  siteId: string,
  snapshot: CrawlSnapshot,
): AgentExecution<InternalLinkData> {
  const findings: AgentFinding[] = [];
  const { linkGraph } = snapshot;
  const nodes = linkGraph.nodes;

  if (nodes.length === 0) {
    return {
      data: {
        totalPages: 0,
        orphanCount: 0,
        deepCount: 0,
        avgDepth: 0,
        maxDepth: 0,
        avgInboundLinks: 0,
        underlinkedPages: [],
      },
      findings: [],
      itemsProcessed: 0,
    };
  }

  // Orphan pages
  const orphanPages = nodes.filter((n) => n.isOrphan);
  for (const node of orphanPages) {
    findings.push({
      type: "ORPHAN_PAGE",
      severity: "MEDIUM",
      title: "Orphan page — no internal links",
      description: `${node.url} has zero internal inbound links. Search engines may not discover this page through crawling.`,
      evidence: [
        {
          sourceType: "CRAWL",
          sourceId: node.url,
          metric: "inboundLinks",
          value: "0",
          metadata: { pageRankScore: node.pageRankScore },
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "PAGE", id: node.url },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "ORPHAN_PAGE",
        resourceType: "PAGE",
        resourceId: node.url,
      }),
    });
  }

  // Deep pages (depth > 3)
  const deepPages = nodes.filter((n) => n.depth > 3);
  for (const node of deepPages.slice(0, 20)) {
    findings.push({
      type: "DEEP_PAGE",
      severity: "LOW",
      title: "Page too deep in site structure",
      description: `${node.url} is at depth ${node.depth} from the homepage. Important pages should be within 3 clicks.`,
      evidence: [
        {
          sourceType: "CRAWL",
          sourceId: node.url,
          metric: "depth",
          value: String(node.depth),
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 1.0,
      affectedResource: { type: "PAGE", id: node.url },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "DEEP_PAGE",
        resourceType: "PAGE",
        resourceId: node.url,
      }),
    });
  }

  // Underlinked pages — pages with only 1 internal link
  const underlinkedPages = nodes.filter(
    (n) => n.inboundLinks.length === 1 && !n.isOrphan,
  );

  if (underlinkedPages.length > nodes.length * 0.3) {
    findings.push({
      type: "HIGH_UNDERLINKED_RATIO",
      severity: "MEDIUM",
      title: "Many pages have only one internal link",
      description: `${underlinkedPages.length} of ${nodes.length} pages (${Math.round((underlinkedPages.length / nodes.length) * 100)}%) have only 1 internal inbound link. Improving internal linking distributes authority more evenly.`,
      evidence: [
        {
          sourceType: "CRAWL",
          metric: "underlinkedRatio",
          value: String(
            Math.round((underlinkedPages.length / nodes.length) * 100),
          ),
          metadata: {
            underlinkedCount: underlinkedPages.length,
            totalPages: nodes.length,
          },
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 0.9,
      affectedResource: { type: "SITE", id: snapshot.domain },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "HIGH_UNDERLINKED_RATIO",
        resourceType: "SITE",
        resourceId: snapshot.domain,
      }),
    });
  }

  // PageRank concentration — check if top 10% of pages hold > 50% of PageRank
  const sortedByPR = [...nodes].sort(
    (a, b) => b.pageRankScore - a.pageRankScore,
  );
  const top10Pct = Math.max(1, Math.floor(nodes.length * 0.1));
  const totalPR = nodes.reduce((sum, n) => sum + n.pageRankScore, 0);
  const top10PctPR = sortedByPR
    .slice(0, top10Pct)
    .reduce((sum, n) => sum + n.pageRankScore, 0);
  const concentrationPct =
    totalPR > 0 ? Math.round((top10PctPR / totalPR) * 100) : 0;

  if (concentrationPct > 70 && nodes.length > 10) {
    findings.push({
      type: "PAGERANK_CONCENTRATION",
      severity: "LOW",
      title: "Internal link authority is heavily concentrated",
      description: `The top ${top10Pct} pages hold ${concentrationPct}% of internal PageRank. Consider distributing internal links more evenly to boost underperforming pages.`,
      evidence: [
        {
          sourceType: "COMPUTED",
          metric: "pageRankConcentration",
          value: String(concentrationPct),
          metadata: { top10Pct, totalPages: nodes.length },
          observedAt: new Date().toISOString(),
        },
      ],
      confidence: 0.7,
      affectedResource: { type: "SITE", id: snapshot.domain },
      fingerprint: createFindingFingerprint({
        siteId,
        type: "PAGERANK_CONCENTRATION",
        resourceType: "SITE",
        resourceId: snapshot.domain,
      }),
    });
  }

  // Compute stats
  const avgInbound =
    nodes.length > 0
      ? nodes.reduce((sum, n) => sum + n.inboundLinks.length, 0) / nodes.length
      : 0;

  return {
    data: {
      totalPages: nodes.length,
      orphanCount: orphanPages.length,
      deepCount: deepPages.length,
      avgDepth: linkGraph.avgDepth,
      maxDepth: linkGraph.maxDepth,
      avgInboundLinks: Math.round(avgInbound * 10) / 10,
      underlinkedPages: underlinkedPages.map((n) => n.url),
    },
    findings,
    itemsProcessed: nodes.length,
  };
}
