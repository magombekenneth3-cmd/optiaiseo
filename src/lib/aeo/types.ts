export interface ModelCitationResult {
  modelName: "gemini" | "gpt-4o" | "perplexity";
  queriesRun: number;
  citationCount: number;
  citationRate: number;   // 0-100
  topCitedQueries: string[];
  missedQueries: string[];
}

export interface MultiModelAeoResult {
  models: ModelCitationResult[]
}
