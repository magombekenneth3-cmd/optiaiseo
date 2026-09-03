/**
 * Phase D.4 — Prompt Management
 *
 * Versioned system prompts per action type.
 * Each prompt:
 *   - Has a stable promptVersion string
 *   - Has a SHA-256 promptHash for audit trail
 *   - Includes the strict JSON output format
 *   - Lists ONLY the allowed fields for the action
 *   - Explicitly states what the LLM CANNOT do
 *   - Never mentions actionType, safetyTier, status as returnable fields
 */

import { createHash } from "crypto";
import type { LLMDecisionInput, AllowedLLMField } from "./types";

// ── Prompt Registry ─────────────────────────────────────────────────────────

interface PromptTemplate {
  readonly version: string;
  readonly hash: string;
  readonly build: (input: LLMDecisionInput) => string;
}

function hashTemplate(template: string): string {
  return createHash("sha256").update(template).digest("hex").slice(0, 16);
}

// ── Shared JSON Schema Instruction ──────────────────────────────────────────

function jsonSchemaInstruction(allowedFields: readonly AllowedLLMField[]): string {
  const fieldList = allowedFields.map((f) => `"${f}"`).join(" | ");
  return `
Respond ONLY with valid JSON matching this exact schema:
{
  "proposedChanges": [
    {
      "field": ${fieldList},
      "proposedValue": "<your proposed value>",
      "reasoning": "<why this change improves SEO>"
    }
  ],
  "reasoning": "<overall rationale for the changes>",
  "confidence": <number between 0.0 and 1.0>
}

RULES:
- The "field" MUST be one of: ${fieldList}
- Do NOT return any fields not listed above
- Do NOT return "actionType", "safetyTier", "status", "approvalHash", or any other field
- Do NOT suggest actions outside the specified field(s)
- Do NOT modify page structure, redirects, or deletion
- Keep values within reasonable length limits
- Be specific and actionable
`.trim();
}

// ── Per-Action Templates ────────────────────────────────────────────────────

const TITLE_TEMPLATE = `You are an SEO specialist. Your ONLY task is to propose a better title tag for the given page.

CONTEXT:
- Page URL: {{targetUrl}}
- Current title: {{currentTitle}}
- Primary keyword: {{primaryKeyword}}
- Category: {{category}}

EVIDENCE:
{{evidence}}

CONSTRAINTS:
- Title MUST be ≤ 70 characters
- Title MUST include the primary keyword naturally
- Title MUST be compelling for search engine click-through

{{jsonSchema}}`;

const META_DESCRIPTION_TEMPLATE = `You are an SEO specialist. Your ONLY task is to propose a better meta description for the given page.

CONTEXT:
- Page URL: {{targetUrl}}
- Current meta description: {{currentMetaDescription}}
- Current title: {{currentTitle}}
- Primary keyword: {{primaryKeyword}}
- Category: {{category}}

EVIDENCE:
{{evidence}}

CONSTRAINTS:
- Meta description MUST be ≤ 160 characters
- Meta description MUST include the primary keyword naturally
- Meta description MUST be compelling and action-oriented

{{jsonSchema}}`;

const CONTENT_GUIDANCE_TEMPLATE = `You are an SEO content strategist. Your ONLY task is to provide specific guidance for refreshing the given page's content.

CONTEXT:
- Page URL: {{targetUrl}}
- Current title: {{currentTitle}}
- Word count: {{wordCount}}
- Primary keyword: {{primaryKeyword}}
- Category: {{category}}

EVIDENCE:
{{evidence}}

CONSTRAINTS:
- Provide specific, actionable content refresh guidance
- Focus on what to update, add, or improve
- Do NOT suggest structural changes (redirects, deletion, consolidation)

{{jsonSchema}}`;

const INTERNAL_LINKS_TEMPLATE = `You are an SEO link strategist. Your ONLY task is to propose internal linking improvements for the given page.

CONTEXT:
- Page URL: {{targetUrl}}
- Current title: {{currentTitle}}
- Primary keyword: {{primaryKeyword}}
- Category: {{category}}

EVIDENCE:
{{evidence}}

CONSTRAINTS:
- Suggest specific anchor text and target page patterns
- Focus on topically related pages
- Do NOT suggest external links or redirects

{{jsonSchema}}`;

const CONTENT_BRIEF_TEMPLATE = `You are an SEO content strategist. Your ONLY task is to generate a content brief for the given page.

CONTEXT:
- Page URL: {{targetUrl}}
- Current title: {{currentTitle}}
- Primary keyword: {{primaryKeyword}}
- Category: {{category}}

EVIDENCE:
{{evidence}}

CONSTRAINTS:
- Provide a structured content brief with target topics, headings, and key points
- Focus on search intent alignment
- Do NOT suggest structural changes

{{jsonSchema}}`;

// ── Template Registry ───────────────────────────────────────────────────────

const TEMPLATES: Readonly<Record<string, string>> = {
  UPDATE_TITLE_TAG: TITLE_TEMPLATE,
  UPDATE_META_DESCRIPTION: META_DESCRIPTION_TEMPLATE,
  REFRESH_CONTENT: CONTENT_GUIDANCE_TEMPLATE,
  ADD_INTERNAL_LINKS: INTERNAL_LINKS_TEMPLATE,
  GENERATE_CONTENT_BRIEF: CONTENT_BRIEF_TEMPLATE,
};

const PROMPT_VERSIONS: Readonly<Record<string, string>> = {
  UPDATE_TITLE_TAG: "d4-title-v1",
  UPDATE_META_DESCRIPTION: "d4-meta-v1",
  REFRESH_CONTENT: "d4-refresh-v1",
  ADD_INTERNAL_LINKS: "d4-links-v1",
  GENERATE_CONTENT_BRIEF: "d4-brief-v1",
};

// Pre-compute hashes at module load (deterministic)
const PROMPT_HASHES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TEMPLATES).map(([action, tmpl]) => [action, hashTemplate(tmpl)])
);

// ── Evidence Formatter ──────────────────────────────────────────────────────

function formatEvidence(input: LLMDecisionInput): string {
  if (input.evidence.length === 0) return "No evidence available.";
  return input.evidence
    .map(
      (e) =>
        `- [${e.sourceType}] ${e.metric ?? "signal"}: ${e.value ?? "detected"} (${e.daysAgo}d ago)`
    )
    .join("\n");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the prompt template for an action type.
 * Returns null if the action is not LLM-enhanceable.
 */
export function getPromptForAction(
  actionType: string,
  input: LLMDecisionInput
): PromptTemplate | null {
  const template = TEMPLATES[actionType];
  if (!template) return null;

  const version = PROMPT_VERSIONS[actionType];
  const hash = PROMPT_HASHES[actionType];

  return {
    version,
    hash,
    build: (inp: LLMDecisionInput) => {
      const jsonSchema = jsonSchemaInstruction(inp.constraints.allowedFields);
      return template
        .replace("{{targetUrl}}", inp.targetUrl)
        .replace("{{currentTitle}}", inp.currentState.title ?? "(no title)")
        .replace(
          "{{currentMetaDescription}}",
          inp.currentState.metaDescription ?? "(no meta description)"
        )
        .replace("{{primaryKeyword}}", inp.primaryKeyword)
        .replace("{{category}}", inp.category)
        .replace("{{wordCount}}", String(inp.currentState.wordCount))
        .replace("{{evidence}}", formatEvidence(inp))
        .replace("{{jsonSchema}}", jsonSchema);
    },
  };
}

/**
 * Get the prompt version for an action type.
 */
export function getPromptVersion(actionType: string): string | null {
  return PROMPT_VERSIONS[actionType] ?? null;
}

/**
 * Get the prompt hash for an action type.
 */
export function getPromptHash(actionType: string): string | null {
  return PROMPT_HASHES[actionType] ?? null;
}
