import { ExtractedEntity } from "./entity-extraction";
import { SerperResult } from "./discovery-engine";

export interface CandidateCompetitor extends ExtractedEntity {
  domain: string;
  sourceUrls: string[];
  geoMatch: boolean;
  serviceMatch: boolean;
  isListArticleOrAggregator: boolean;
}

export function scoreCompetitors(
  candidates: CandidateCompetitor[],
  geoKeyword: string
): Array<CandidateCompetitor & { score: number }> {
  return candidates.map(c => {
    let score = 0;

    // 1. Frequency (appears in multiple sources)
    const frequency = c.sourceUrls.length;
    score += Math.min(frequency * 1.5, 5); // Max 5 points for frequency

    // 2. Geo Match (domain TLD or content mentions geo)
    if (c.geoMatch || c.domain.endsWith(`.${geoKeyword.toLowerCase()}`)) {
      score += 2;
    }

    // 3. Service Match (pricing pages, service keywords)
    if (c.serviceMatch) {
      score += 2;
    }

    // 4. Quality penalty (exclude aggregators/blogs)
    if (c.isListArticleOrAggregator) {
      score -= 5;
    }

    // 5. AI Confidence bonus
    score += c.confidence * 1.0;

    // Normalize to 0-10
    const normalizedScore = Math.max(0, Math.min(10, parseFloat(score.toFixed(1))));

    return {
      ...c,
      score: normalizedScore,
    };
  }).sort((a, b) => b.score - a.score);
}
