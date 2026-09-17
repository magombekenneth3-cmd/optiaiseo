/**
 * Normalizes the score shapes emitted by the legacy and autonomous
 * opportunity pipelines into the 0–100 value the dashboard displays.
 */
export function normalizeOpportunityScore(value: unknown): number | null {
  let candidate = value;

  if (typeof candidate === "string") {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return clampScore(numeric);

    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return clampScore(candidate);
  }

  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    const final = record.final ?? record.finalScore;
    if (typeof final === "number" && Number.isFinite(final)) {
      return clampScore(final);
    }
  }

  return null;
}

/**
 * Proposal confidence is normally persisted as a fraction (0–1), while a few
 * older producers use a 0–100 value. Accept both without misrepresenting it.
 */
export function normalizeConfidenceScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampScore(value >= 0 && value <= 1 ? value * 100 : value);
}

export function getProposalDisplayScore(
  opportunityScore: unknown,
  confidence: unknown
): number {
  return normalizeOpportunityScore(opportunityScore)
    ?? normalizeConfidenceScore(confidence)
    ?? 0;
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}
