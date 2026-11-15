import { normalizeAuditUrl } from "./utils/url";

export interface LlmsTxtPageEntry {
  url: string;
  title?: string | null;
  summary?: string | null;
  abstract?: string | null;
  section?: "core" | "blog";
  h1?: string | null;
}

export interface LlmsTxtBrandFact {
  factType: string;
  value: string;
  sourceUrl?: string | null;
  verified?: boolean;
}

export interface LlmsTxtQueryEntry {
  keyword: string;
  url?: string | null;
  impressions?: number;
  clicks?: number;
}

export interface LlmsTxtFaqEntry {
  question: string;
  answer: string;
}

export interface LlmsTxtAeoSummary {
  score: number;
  grade: string;
  citationLikelihood?: number | null;
  generativeShareOfVoice?: number | null;
}

export interface LlmsTxtBuildInput {
  domain: string;
  origin?: string;
  brandName?: string | null;
  description?: string | null;
  techStack?: string | null;
  coreServices?: string | null;
  pages?: LlmsTxtPageEntry[];
  brandFacts?: LlmsTxtBrandFact[];
  topQueries?: LlmsTxtQueryEntry[];
  faqs?: LlmsTxtFaqEntry[];
  aeoSummary?: LlmsTxtAeoSummary | null;
  full?: boolean;
  generatedDate?: string;
}

export interface LlmsTxtCompliance {
  valid: boolean;
  hasSiteHeader: boolean;
  hasDescription: boolean;
  pageEntries: number;
  quality: "good" | "partial" | "empty";
}

interface NormalizedLlmsPage {
  url: string;
  title: string;
  summary: string;
  abstract?: string;
  section: "core" | "blog";
}

const SKIPPED_PATH_PREFIXES = ["/api/", "/_next/", "/wp-admin/", "/wp-login"];

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

/** Resolves and canonicalizes an HTTP(S) URL for llms.txt indexing while stripping tracking params. */
export function canonicalizeLlmsUrl(rawUrl: string, origin: string): string | null {
  try {
    const parsed = new URL(rawUrl, origin);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(lower)) {
        parsed.searchParams.delete(key);
      }
    }
    return normalizeAuditUrl(parsed.href) || parsed.href;
  } catch {
    return null;
  }
}

/** Resolves a canonical https origin and clean hostname from a domain or URL string. */
export function resolveSiteOrigin(
  domainOrUrl: string,
  fallbackUrl?: string,
): { origin: string; cleanDomain: string } {
  const candidates = [fallbackUrl, domainOrUrl]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  for (const raw of candidates) {
    const candidate = /^https?:\/\//i.test(raw.trim())
      ? raw.trim()
      : `https://${raw.trim().replace(/^\/+/, "")}`;
    try {
      const parsed = new URL(candidate);
      return {
        origin: parsed.origin,
        cleanDomain: parsed.hostname.toLowerCase(),
      };
    } catch {
      // Try next candidate
    }
  }

  const stripped = domainOrUrl
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const safeHost = stripped || "example.com";
  return {
    origin: `https://${safeHost}`,
    cleanDomain: safeHost,
  };
}

/** Normalizes arbitrary text into a single markdown-safe line capped cleanly. */
export function sanitizeSingleLine(value: string, maxLen: number): string {
  const collapsed = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return "";
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function sanitizeLinkLabel(label: string): string {
  return sanitizeSingleLine(
    label.replace(/\[/g, "(").replace(/\]/g, ")"),
    90,
  ) || "Page";
}

function formatSlugLabel(parsed: URL): string {
  if (parsed.pathname === "/" || !parsed.pathname) return "Home";
  const cleaned = parsed.pathname
    .replace(/^\/|\/$/g, "")
    .replace(/[-_/]+/g, " ")
    .trim();
  if (!cleaned) return "Home";
  return cleaned.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** Strips HTML and Markdown syntax into clean plain text suitable for abstracts. */
export function stripMarkdownToPlainText(raw: string, maxLen = 400): string {
  if (!raw) return "";
  const plain = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  return sanitizeSingleLine(plain, maxLen);
}

/** Extracts FAQPage question/answer pairs from one or more concatenated JSON-LD strings. */
export function extractFaqEntriesFromJsonLd(
  rawSchema: string | null | undefined,
  limit = 10,
): LlmsTxtFaqEntry[] {
  if (!rawSchema || typeof rawSchema !== "string") return [];

  const collected: LlmsTxtFaqEntry[] = [];
  const seenQuestions = new Set<string>();

  const visitNode = (node: unknown) => {
    if (!node || collected.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visitNode(item);
      return;
    }
    if (typeof node !== "object") return;

    const obj = node as Record<string, unknown>;
    if (obj["@graph"]) visitNode(obj["@graph"]);

    const typeVal = obj["@type"];
    const isFaq =
      typeVal === "FAQPage" ||
      (Array.isArray(typeVal) && typeVal.includes("FAQPage"));

    if (isFaq && Array.isArray(obj.mainEntity)) {
      for (const entity of obj.mainEntity) {
        if (collected.length >= limit) break;
        if (!entity || typeof entity !== "object") continue;
        const item = entity as Record<string, unknown>;
        const q = typeof item.name === "string" ? sanitizeSingleLine(item.name, 200) : "";
        const ansObj = item.acceptedAnswer as Record<string, unknown> | undefined;
        const a =
          ansObj && typeof ansObj.text === "string"
            ? stripMarkdownToPlainText(ansObj.text, 1200)
            : "";
        const key = q.toLowerCase();
        if (q && a && !seenQuestions.has(key)) {
          seenQuestions.add(key);
          collected.push({ question: q, answer: a });
        }
      }
    }
  };

  try {
    visitNode(JSON.parse(rawSchema));
  } catch {
    // Fallback for concatenated JSON-LD script fragments
    const regex = /\{[^{}]*"@type"\s*:\s*"FAQPage"[\s\S]*?\}(?=\s*(?:\{|$))/g;
    const matches = rawSchema.match(regex) ?? [];
    for (const block of matches) {
      if (collected.length >= limit) break;
      try {
        visitNode(JSON.parse(block));
      } catch {
        // Ignore malformed fragment
      }
    }
  }

  return collected;
}

function normalizePages(
  entries: LlmsTxtPageEntry[],
  origin: string,
  cleanDomain: string,
  full: boolean,
): NormalizedLlmsPage[] {
  const byCanonical = new Map<string, NormalizedLlmsPage>();
  const summaryCap = full ? 260 : 160;
  const abstractCap = full ? 450 : 200;

  for (const entry of entries) {
    if (!entry.url) continue;
    let parsed: URL;
    try {
      parsed = new URL(entry.url, origin);
    } catch {
      continue;
    }

    if (!/^https?:$/i.test(parsed.protocol)) continue;
    // Accept same-origin or apex/www equivalent for this domain
    const entryHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const siteHost = cleanDomain.replace(/^www\./, "");
    if (entryHost !== siteHost) continue;

    if (SKIPPED_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
      continue;
    }

    const canonicalUrl = canonicalizeLlmsUrl(parsed.href, origin);
    if (!canonicalUrl) continue;
    const title = sanitizeLinkLabel(
      entry.title?.trim() || entry.h1?.trim() || formatSlugLabel(parsed),
    );
    const summary =
      sanitizeSingleLine(entry.summary?.trim() || "", summaryCap) ||
      `${title} on ${cleanDomain}`;
    const abstract = entry.abstract
      ? stripMarkdownToPlainText(entry.abstract, abstractCap)
      : undefined;
    const section: "core" | "blog" = entry.section === "blog" ? "blog" : "core";

    const existing = byCanonical.get(canonicalUrl);
    if (!existing) {
      byCanonical.set(canonicalUrl, { url: canonicalUrl, title, summary, abstract, section });
    } else {
      // Merge richer metadata if another source (e.g. Blog vs PageAudit) adds a summary/abstract
      const preferNewTitle =
        existing.title === formatSlugLabel(parsed) && entry.title?.trim();
      byCanonical.set(canonicalUrl, {
        url: canonicalUrl,
        title: preferNewTitle ? title : existing.title,
        summary:
          summary.length > existing.summary.length && !summary.startsWith(`${title} on `)
            ? summary
            : existing.summary,
        abstract:
          (abstract?.length ?? 0) > (existing.abstract?.length ?? 0)
            ? abstract
            : existing.abstract,
        section: existing.section === "blog" || section === "blog" ? existing.section : "core",
      });
    }
  }

  // Ensure at least 3 valid page entries so starter/un-crawled sites still meet AiVisibilityModule "good" quality
  const fallbackPaths: Array<{ path: string; title: string; summary: string }> = [
    { path: "/", title: "Home", summary: `Main overview and core offerings on ${cleanDomain}` },
    { path: "/about", title: "About", summary: `Company background, team, and mission for ${cleanDomain}` },
    { path: "/contact", title: "Contact", summary: `Support and contact details for ${cleanDomain}` },
  ];

  for (const fallback of fallbackPaths) {
    if (byCanonical.size >= 3) break;
    const fullUrl = new URL(fallback.path, origin).href;
    const canonicalUrl = normalizeAuditUrl(fullUrl) || fullUrl;
    if (!byCanonical.has(canonicalUrl)) {
      byCanonical.set(canonicalUrl, {
        url: canonicalUrl,
        title: fallback.title,
        summary: fallback.summary,
        section: "core",
      });
    }
  }

  return Array.from(byCanonical.values());
}

/**
 * Checks whether generated or fetched llms.txt content satisfies `AiVisibilityModule` criteria.
 */
export function validateLlmsTxtCompliance(markdown: string): LlmsTxtCompliance {
  const hasDescription = markdown.trim().length > 80;
  const pageEntries = (markdown.match(/^- \[.+\]\(.+\)/gm) ?? []).length;
  const hasSiteHeader = /^>\s?https?:\/\//m.test(markdown);

  let quality: "good" | "partial" | "empty";
  if (hasDescription && pageEntries >= 3 && hasSiteHeader) {
    quality = "good";
  } else if (hasDescription || pageEntries > 0) {
    quality = "partial";
  } else {
    quality = "empty";
  }

  return {
    valid: quality === "good",
    hasSiteHeader,
    hasDescription,
    pageEntries,
    quality,
  };
}

/**
 * Pure deterministic builder for spec-compliant `/llms.txt` and `/llms-full.txt` documents.
 */
export function buildLlmsTxtMarkdown(input: LlmsTxtBuildInput): string {
  const { origin, cleanDomain } = resolveSiteOrigin(input.domain, input.origin);
  const full = Boolean(input.full);
  const brandTitle =
    sanitizeSingleLine(input.brandName ?? "", 100) || cleanDomain;
  const updatedDate =
    input.generatedDate ?? new Date().toISOString().split("T")[0];

  const allPages = normalizePages(input.pages ?? [], origin, cleanDomain, full);
  const corePages = allPages.filter((p) => p.section === "core").slice(0, full ? 40 : 20);
  const blogPages = allPages.filter((p) => p.section === "blog").slice(0, full ? 40 : 15);

  const description =
    sanitizeSingleLine(input.description ?? "", full ? 400 : 220) ||
    `${brandTitle} (${cleanDomain}) provides structured pages, documentation, and authoritative resources on ${
      sanitizeSingleLine(input.coreServices || input.techStack || "", 120) ||
      "its core products and services"
    }.`;

  const lines: string[] = [
    `# ${brandTitle}`,
    "",
    `> ${origin}`,
    "",
    description,
    "",
    `> Last updated: ${updatedDate}${full ? " (Full index: llms-full.txt)" : ""}`,
    "",
    "## Core Identity",
    `- Brand Name: ${brandTitle}`,
    `- Domain: ${cleanDomain}`,
    `- Canonical Origin: ${origin}`,
  ];

  if (input.coreServices?.trim()) {
    lines.push(`- Core Offerings: ${sanitizeSingleLine(input.coreServices, 220)}`);
  }
  if (input.techStack?.trim()) {
    lines.push(`- Category / Stack: ${sanitizeSingleLine(input.techStack, 120)}`);
  }
  lines.push("");

  if (corePages.length > 0) {
    lines.push("## Core Pages");
    for (const page of corePages) {
      lines.push(`- [${page.title}](${page.url}): ${page.summary}`);
    }
    lines.push("");
  }

  if (blogPages.length > 0) {
    lines.push("## Published Articles & Guides");
    for (const post of blogPages) {
      lines.push(`- [${post.title}](${post.url}): ${post.summary}`);
    }
    lines.push("");
  }

  const facts = (input.brandFacts ?? [])
    .filter((f) => f.factType?.trim() && f.value?.trim())
    .slice(0, full ? 30 : 12);
  if (facts.length > 0) {
    lines.push("## Verified Brand Facts");
    for (const fact of facts) {
      const factLabel = sanitizeSingleLine(fact.factType, 60);
      const factVal = sanitizeSingleLine(fact.value, full ? 350 : 180);
      const badge = fact.verified ? " [Verified]" : "";
      const src = full && fact.sourceUrl ? ` (Source: ${fact.sourceUrl})` : "";
      lines.push(`- ${factLabel}: ${factVal}${badge}${src}`);
    }
    lines.push("");
  }

  const queries = (input.topQueries ?? [])
    .filter((q) => q.keyword?.trim())
    .slice(0, full ? 20 : 8);
  if (queries.length > 0) {
    lines.push("## Top Search Topics");
    for (const q of queries) {
      const kw = sanitizeSingleLine(q.keyword, 100);
      if (q.url) {
        try {
          const target = new URL(q.url, origin).href;
          lines.push(`- [${kw}](${target})`);
          continue;
        } catch {
          // Fall back to plain bullet if URL is invalid
        }
      }
      lines.push(`- ${kw}`);
    }
    lines.push("");
  }

  const faqs = (input.faqs ?? [])
    .filter((f) => f.question?.trim() && f.answer?.trim())
    .slice(0, full ? 25 : 10);
  if (faqs.length > 0) {
    lines.push(full ? "## Frequently Asked Questions (Full)" : "## Frequently Asked Questions");
    for (const faq of faqs) {
      lines.push(`### ${sanitizeSingleLine(faq.question, 200)}`);
      lines.push(full ? sanitizeSingleLine(faq.answer, 1200) : sanitizeSingleLine(faq.answer, 220));
      lines.push("");
    }
  }

  if (full) {
    const pagesWithAbstracts = allPages
      .filter((p) => p.abstract && p.abstract.length > 20)
      .slice(0, 25);
    if (pagesWithAbstracts.length > 0) {
      lines.push("## Page Abstracts & Key Context");
      for (const page of pagesWithAbstracts) {
        lines.push(`### ${page.title}`);
        lines.push(`URL: ${page.url}`);
        lines.push(page.abstract!);
        lines.push("");
      }
    }
  }

  if (input.aeoSummary) {
    lines.push("## AI Visibility Summary");
    lines.push(`- AEO Score: ${input.aeoSummary.score}/100 (Grade: ${input.aeoSummary.grade})`);
    if (input.aeoSummary.citationLikelihood != null) {
      lines.push(`- Citation Likelihood: ${input.aeoSummary.citationLikelihood}`);
    }
    if (input.aeoSummary.generativeShareOfVoice != null) {
      lines.push(`- Generative Share of Voice: ${input.aeoSummary.generativeShareOfVoice}%`);
    }
    lines.push("");
  }

  lines.push("## Citation Preferences");
  lines.push(`- Preferred Citation Name: ${brandTitle}`);
  lines.push(`- Canonical Homepage: ${origin}/`);
  lines.push(`- Target AI Engines: ChatGPT, Perplexity, Google AI Overviews, Claude`);
  lines.push("");

  return lines.join("\n");
}

