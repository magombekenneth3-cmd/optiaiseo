export const TTL = {
  MENTION_S:     60 * 60 * 24,       // 24 h
  PERPLEXITY_S:  60 * 60 * 6,        // 6 h
  SPOT_CHECK_S:  60 * 60 * 6,        // 6 h — query discovery spot-check cache
  QUESTIONS_S:   60 * 60 * 48,       // 48 h
  EMBEDDING_S:   60 * 60 * 24 * 7,   // 7 days
  MULTI_MODEL_S: 60 * 60 * 24 * 7,   // 7 days — aggregated AEO results
  CACHE_STATS_S: 60 * 5,             // 5 min — admin dashboard cache
} as const;
