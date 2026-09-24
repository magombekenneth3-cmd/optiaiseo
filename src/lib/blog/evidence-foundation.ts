import { z } from "zod";

export const EvidenceSourceTypeSchema = z.enum([
  "EXTERNAL_SOURCE",
  "FIRST_PARTY_EXPERIENCE",
  "FIRST_PARTY_DATA",
  "GSC_DATA",
  "SERP_OBSERVATION",
  "INFERENCE",
  "LLM_GENERATED",
]);

export const BlogClaimTypeSchema = z.enum([
  "STATISTIC",
  "FACT",
  "QUOTE",
  "COMPARISON",
  "EXPERIENCE",
  "OPINION",
  "RECOMMENDATION",
]);

export const BlogClaimStatusSchema = z.enum([
  "PENDING",
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNSUPPORTED",
  "DISPUTED",
  "RETRACTED",
]);

export const EvidenceSupportLevelSchema = z.enum([
  "STRONG",
  "MODERATE",
  "WEAK",
  "CONTRADICTORY",
  "NEUTRAL",
]);

export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;
export type BlogClaimType = z.infer<typeof BlogClaimTypeSchema>;
export type BlogClaimStatus = z.infer<typeof BlogClaimStatusSchema>;
export type EvidenceSupportLevel = z.infer<typeof EvidenceSupportLevelSchema>;

const FACTUAL_SOURCE_TYPES: ReadonlySet<EvidenceSourceType> = new Set([
  "EXTERNAL_SOURCE",
  "FIRST_PARTY_EXPERIENCE",
  "FIRST_PARTY_DATA",
  "GSC_DATA",
  "SERP_OBSERVATION",
]);

const NON_FACTUAL_SOURCE_TYPES: ReadonlySet<EvidenceSourceType> = new Set([
  "LLM_GENERATED",
  "INFERENCE",
]);

export function isFactualSource(sourceType: EvidenceSourceType): boolean {
  return FACTUAL_SOURCE_TYPES.has(sourceType);
}

export function isNonFactualSource(sourceType: EvidenceSourceType): boolean {
  return NON_FACTUAL_SOURCE_TYPES.has(sourceType);
}

export function isLlmGenerated(sourceType: EvidenceSourceType): boolean {
  return sourceType === "LLM_GENERATED";
}

export const LEGACY_SOURCE_TYPE_MAP: Record<string, EvidenceSourceType> = {
  official: "EXTERNAL_SOURCE",
  research: "EXTERNAL_SOURCE",
  government: "EXTERNAL_SOURCE",
  company: "EXTERNAL_SOURCE",
  news: "EXTERNAL_SOURCE",
  expert: "FIRST_PARTY_EXPERIENCE",
  other: "EXTERNAL_SOURCE",
};

export function mapLegacySourceType(legacyType: string): EvidenceSourceType {
  return LEGACY_SOURCE_TYPE_MAP[legacyType] ?? "EXTERNAL_SOURCE";
}

export const ResearchArtifactInputSchema = z.object({
  blogId: z.string().min(1),
  url: z.string().url().nullable(),
  title: z.string().max(500).nullable(),
  publisher: z.string().max(200).nullable(),
  publishedAt: z.date().nullable(),
  sourceType: EvidenceSourceTypeSchema,
  contentHash: z.string().max(128).nullable(),
  snippet: z.string().max(4000).nullable(),
  confidence: z.number().min(0).max(1),
  authorityScore: z.number().min(0).max(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const EvidenceItemInputSchema = z.object({
  artifactId: z.string().min(1),
  sourceType: EvidenceSourceTypeSchema,
  content: z.string().min(1).max(8000),
  extractedClaim: z.string().max(1500).nullable(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const BlogClaimInputSchema = z.object({
  blogId: z.string().min(1),
  text: z.string().min(1).max(1500),
  type: BlogClaimTypeSchema,
  status: BlogClaimStatusSchema.default("PENDING"),
  sectionId: z.string().max(100).nullable(),
  position: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const ClaimEvidenceInputSchema = z.object({
  claimId: z.string().min(1),
  evidenceId: z.string().min(1),
  supportLevel: EvidenceSupportLevelSchema,
  reasoning: z.string().max(2000).nullable(),
});

export type ResearchArtifactInput = z.infer<typeof ResearchArtifactInputSchema>;
export type EvidenceItemInput = z.infer<typeof EvidenceItemInputSchema>;
export type BlogClaimInput = z.infer<typeof BlogClaimInputSchema>;
export type ClaimEvidenceInput = z.infer<typeof ClaimEvidenceInputSchema>;

export function computeClaimStatus(
  evidenceLinks: Array<{ supportLevel: EvidenceSupportLevel; sourceType: EvidenceSourceType }>
): BlogClaimStatus {
  if (evidenceLinks.length === 0) return "UNSUPPORTED";

  const factual = evidenceLinks.filter(link => isFactualSource(link.sourceType));
  if (factual.length === 0) return "UNSUPPORTED";

  const hasContradiction = factual.some(link => link.supportLevel === "CONTRADICTORY");
  if (hasContradiction) return "DISPUTED";

  const strong = factual.filter(link => link.supportLevel === "STRONG");
  if (strong.length > 0) return "SUPPORTED";

  const moderate = factual.filter(link => link.supportLevel === "MODERATE");
  if (moderate.length > 0) return "PARTIALLY_SUPPORTED";

  return "UNSUPPORTED";
}

export function computeEvidenceCoverage(
  claims: Array<{ status: BlogClaimStatus }>
): number {
  if (claims.length === 0) return 0;
  const supported = claims.filter(
    c => c.status === "SUPPORTED" || c.status === "PARTIALLY_SUPPORTED"
  ).length;
  return Math.round((supported / claims.length) * 100);
}
