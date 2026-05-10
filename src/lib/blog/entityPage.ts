/**
 * src/lib/blog/entityPage.ts
 *
 * Entity-page generator — creates a dedicated service page (not a blog post)
 * for each distinct service entity discovered from coreServices.
 *
 * Pipeline type: "ENTITY_PAGE"
 * Structure: what → how → pricing → FAQs → CTA → internal links
 */

import { callGeminiJson } from "@/lib/gemini/client";
import { generateServiceSchema } from "@/lib/schema/serviceSchema";
import type { ServiceEntity } from "@/app/actions/entityDiscovery";


export interface EntityPagePlan {
  entity: ServiceEntity;
  title: string;
  h1: string;
  metaDescription: string;
  sections: {
    what: string;
    how: string;
    pricing: string;
    faqs: { question: string; answer: string }[];
    cta: string;
  };
  schema: string;       // JSON string of Service JSON-LD
  internalLinks: { text: string; slug: string }[];
}


/**
 * Calls Gemini to produce a complete entity-page plan —
 * title, H1, meta, all body sections, FAQs, and internal link suggestions.
 */
export async function generateEntityPage(
  entity: ServiceEntity,
  site: {
    domain: string;
    niche?: string | null;
    location?: string | null;
    coreServices?: string | null;
    authorName?: string | null;
  },
  relatedEntities: ServiceEntity[]
): Promise<EntityPagePlan> {

  const prompt = `
You are writing a dedicated service page for a specific entity, following entity-first SEO principles.

Entity: ${entity.fullName}
Business Domain: ${site.domain}
Industry: ${site.niche || "Not specified"}
Location: ${site.location || "Not specified"}
Core Services (for internal linking context): ${site.coreServices || "Not specified"}

RULES — this is NOT a blog post:
- One page = one entity. Do not mention multiple services as the main topic.
- Every section must directly address the specific service "${entity.fullName}".
- Use the location "${site.location || ""}" naturally in the copy — do not force it.
- The FAQ must answer questions someone searching for "${entity.fullName}" would actually ask.
- The CTA must be specific to this service.
- whatSection: 2-3 paragraphs of HTML using <p> tags
- howSection: numbered steps using <ol><li> tags
- pricingSection: honest pricing context (no exact numbers if unknown) using <p> tags
- Each FAQ answer should be 2-4 sentences

Return ONLY valid JSON:
{
  "title": "page title tag (50-60 chars, include location if local)",
  "h1": "page H1 heading (include service + location)",
  "metaDescription": "meta description 150-160 chars, include a CTA",
  "whatSection": "<p>HTML paragraphs explaining what this specific service is</p>",
  "howSection": "<ol><li>step</li></ol> HTML numbered process",
  "pricingSection": "<p>HTML pricing context</p>",
  "faqs": [
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." },
    { "question": "...", "answer": "..." }
  ],
  "ctaText": "specific call to action sentence for this service",
  "internalLinkSuggestions": [
    { "anchorText": "text to link", "targetService": "related service keyword phrase" }
  ]
}
`;

  const result = await callGeminiJson<{
    title: string;
    h1: string;
    metaDescription: string;
    whatSection: string;
    howSection: string;
    pricingSection: string;
    faqs: { question: string; answer: string }[];
    ctaText: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internalLinkSuggestions?: any[];
  }>(prompt, { maxOutputTokens: 3000, temperature: 0.3 });

  const schema = generateServiceSchema({
    name: entity.fullName,
    domain: site.domain,
    slug: entity.suggestedSlug,
    description: result.metaDescription,
    location: site.location,
  });

  // Match internal link suggestions to known entity slugs
  const internalLinks = (result.internalLinkSuggestions ?? []).map((s) => {
    const targetSlug =
      relatedEntities.find(
        (e) =>
          e.name.toLowerCase().includes((s.targetService ?? "").toLowerCase()) ||
          e.fullName.toLowerCase().includes((s.targetService ?? "").toLowerCase())
      )?.suggestedSlug ?? "";

    return {
      text: s.anchorText ?? "",
      slug: targetSlug ? `/services/${targetSlug}` : "#",
    };
  }).filter((l) => l.text && l.slug !== "#");

  return {
    entity,
    title: result.title,
    h1: result.h1,
    metaDescription: result.metaDescription,
    sections: {
      what: result.whatSection,
      how: result.howSection,
      pricing: result.pricingSection,
      faqs: result.faqs ?? [],
      cta: result.ctaText,
    },
    schema,
    internalLinks,
  };
}


/**
 * Assembles the EntityPagePlan into a complete, self-contained HTML body.
 * This is the content field stored in the Blog model.
 */
export function assembleEntityPageHtml(page: EntityPagePlan): string {
  const faqHtml = page.sections.faqs
    .map(
      (f) =>
        `<div class="faq-item">
  <h3>${f.question}</h3>
  <p>${f.answer}</p>
</div>`
    )
    .join("\n");

  const faqSchemaItems = page.sections.faqs.map((f) => ({
    "@type": "Question",
    "name": f.question,
    "acceptedAnswer": { "@type": "Answer", "text": f.answer },
  }));

  const faqSchema =
    page.sections.faqs.length > 0
      ? `<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": faqSchemaItems }, null, 2)}
</script>`
      : "";

  const internalLinksHtml =
    page.internalLinks.length > 0
      ? `<div class="entity-related-services">
  <h3>Related Services</h3>
  <ul>
    ${page.internalLinks.map((l) => `<li><a href="${l.slug}">${l.text}</a></li>`).join("\n    ")}
  </ul>
</div>`
      : "";

  return `<h1>${page.h1}</h1>

<section class="entity-what">
  <h2>What is ${page.entity.name}?</h2>
  ${page.sections.what}
</section>

<section class="entity-how">
  <h2>How It Works</h2>
  ${page.sections.how}
</section>

<section class="entity-pricing">
  <h2>Pricing &amp; Investment</h2>
  ${page.sections.pricing}
</section>

<section class="entity-faq">
  <h2>Frequently Asked Questions</h2>
  ${faqHtml}
</section>

<section class="entity-cta">
  <h2>Get Started</h2>
  <p>${page.sections.cta}</p>
</section>

${internalLinksHtml}

${faqSchema}`;
}
