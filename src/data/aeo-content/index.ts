import type { AeoGuideContent } from "./types";

import { content as whatIsAnswerEngineOptimization } from "./what-is-answer-engine-optimization";
import { content as whatIsGenerativeEngineOptimization } from "./what-is-generative-engine-optimization";
import { content as whatIsAiSearchEngine } from "./what-is-ai-search-engine";
import { content as whatIsAiOverviewSeo } from "./what-is-ai-overview-seo";
import { content as aiSearchRankingFactors } from "./ai-search-ranking-factors";
import { content as zeroClickSearchAeo } from "./zero-click-search-aeo";
import { content as futureOfSeoAiSearch } from "./future-of-seo-ai-search";
import { content as aeoMetricsKpis } from "./aeo-metrics-kpis";
import { content as howToAppearInGoogleAiOverviews } from "./how-to-appear-in-google-ai-overviews";
import { content as howToRankInChatgptSearch } from "./how-to-rank-in-chatgpt-search";
import { content as howToRankInPerplexityAi } from "./how-to-rank-in-perplexity-ai";
import { content as howToOptimizeForAnswerEngines } from "./how-to-optimize-for-answer-engines";
import { content as aiOptimizationChecklist } from "./ai-optimization-checklist";
import { content as structuredDataForAiSearch } from "./structured-data-for-ai-search";
import { content as contentFormatAiAnswers } from "./content-format-ai-answers";
import { content as aeoAuditGuide } from "./aeo-audit-guide";
import { content as brandMentionsAiSearch } from "./brand-mentions-ai-search";
import { content as aeoForLocalBusiness } from "./aeo-for-local-business";
import { content as llmSeoStrategy } from "./llm-seo-strategy";
import { content as aeoStrategy2026 } from "./aeo-strategy-2026";
import { content as aeoContentStrategy } from "./aeo-content-strategy";
import { content as eeatForAiSearch } from "./eeat-for-ai-search";
import { content as topicalAuthorityAiSearch } from "./topical-authority-ai-search";
import { content as conversationalSearchSeo } from "./conversational-search-seo";
import { content as aeoLinkBuilding } from "./aeo-link-building";
import { content as voiceSearchAeo } from "./voice-search-aeo";
import { content as knowledgeGraphSeo } from "./knowledge-graph-seo";
import { content as aeoForSaas } from "./aeo-for-saas";
import { content as aeoForEcommerce } from "./aeo-for-ecommerce";
import { content as answerEngineOptimizationVsSeo } from "./answer-engine-optimization-vs-seo";
import { content as aeoVsGeo } from "./aeo-vs-geo";
import { content as aeoVsPpc } from "./aeo-vs-ppc";
import { content as featuredSnippetsVsAiAnswers } from "./featured-snippets-vs-ai-answers";
import { content as answerEngineOptimizationTools } from "./answer-engine-optimization-tools";
import { content as optiaiseoAeoPlatform } from "./optiaiseo-aeo-platform";
import { content as aiCitationTracking } from "./ai-citation-tracking";
import { content as aeoCaseStudy2026 } from "./aeo-case-study-2026";
import { content as aeoForAgencies } from "./aeo-for-agencies";

const allContent: AeoGuideContent[] = [
  whatIsAnswerEngineOptimization,
  whatIsGenerativeEngineOptimization,
  whatIsAiSearchEngine,
  whatIsAiOverviewSeo,
  aiSearchRankingFactors,
  zeroClickSearchAeo,
  futureOfSeoAiSearch,
  aeoMetricsKpis,
  howToAppearInGoogleAiOverviews,
  howToRankInChatgptSearch,
  howToRankInPerplexityAi,
  howToOptimizeForAnswerEngines,
  aiOptimizationChecklist,
  structuredDataForAiSearch,
  contentFormatAiAnswers,
  aeoAuditGuide,
  brandMentionsAiSearch,
  aeoForLocalBusiness,
  llmSeoStrategy,
  aeoStrategy2026,
  aeoContentStrategy,
  eeatForAiSearch,
  topicalAuthorityAiSearch,
  conversationalSearchSeo,
  aeoLinkBuilding,
  voiceSearchAeo,
  knowledgeGraphSeo,
  aeoForSaas,
  aeoForEcommerce,
  answerEngineOptimizationVsSeo,
  aeoVsGeo,
  aeoVsPpc,
  featuredSnippetsVsAiAnswers,
  answerEngineOptimizationTools,
  optiaiseoAeoPlatform,
  aiCitationTracking,
  aeoCaseStudy2026,
  aeoForAgencies,
];

export const AEO_CONTENT: Record<string, AeoGuideContent> = Object.fromEntries(
  allContent.map((c) => [c.slug, c])
);
