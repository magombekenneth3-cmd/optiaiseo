/**
 * Agent Context Store
 * Manages the shared state between the LiveKit AgentInterface
 * and the right-side ContextCanvas.  No external libraries needed —
 * plain React Context + useReducer.
 */

"use client";

import { createContext, useContext, useReducer, ReactNode } from "react";

// ── Supported chart types the agent can push ──────────────────────────
export type ChartType =
  | "keyword_bar" // keyword → count
  | "competitor_bar" // competitor word-count comparison
  | "nlp_radar" // NLP entity coverage
  | "readability_gauge" // Flesch-Kincaid grade
  | "idle";

export interface KeywordBarRow {
  keyword: string;
  count: number;
}
export interface CompetitorBarRow {
  site: string;
  words: number;
}
export interface NlpRadarRow {
  subject: string;
  score: number;
  fullScore: number;
}

export type ChartPayload =
  | { type: "keyword_bar"; data: KeywordBarRow[]; title: string }
  | { type: "competitor_bar"; data: CompetitorBarRow[]; title: string }
  | { type: "nlp_radar"; data: NlpRadarRow[]; title: string }
  | { type: "readability_gauge"; gradeLevel: number; label: string }
  | { type: "vision_critique"; title: string }
  | { type: "idle" };

export interface AgentUIState {
  activeTool: string | null;
  toolLog: string[];
  chart: ChartPayload;
  domain: string | null;
  isProcessing: boolean;
  awaitingUserInput: boolean;
  awaitingTimeoutMs?: number | null;
  lastKeepaliveAt?: number | null;
  keepaliveMessage?: string | null;
  pendingUrl?: string | null;
  seoHealth: number | null;
  aiVisibility: number | null;
  insights: Array<{ title: string; description: string; type: "seo" | "aeo" | "content" }> | null;
  recommendedActions: string[] | null;
  selectedSite: { id: string; domain: string } | null;
}

type Action =
  | { type: "TOOL_START"; tool: string }
  | { type: "TOOL_LOG"; message: string }
  | { type: "SET_CHART"; chart: ChartPayload }
  | { type: "SET_DOMAIN"; domain: string }
  | { type: "AWAITING_USER_INPUT"; timeoutMs?: number }
  | { type: "KEEPALIVE"; message?: string }
  | { type: "PENDING_URL"; url: string }
  | { type: "CLEAR_PENDING_URL" }
  | { type: "RESET" }
  | { type: "SET_SELECTED_SITE"; site: { id: string; domain: string } }
  | { type: "SET_METRICS"; metrics: { seoHealth: number | null; aiVisibility: number | null; insights: Array<{ title: string; description: string; type: "seo" | "aeo" | "content" }>; recommendedActions: string[] } };

const initial: AgentUIState = {
  activeTool: null,
  toolLog: [],
  chart: { type: "idle" },
  domain: null,
  isProcessing: false,
  awaitingUserInput: false,
  awaitingTimeoutMs: null,
  lastKeepaliveAt: null,
  keepaliveMessage: null,
  pendingUrl: null,
  seoHealth: null,
  aiVisibility: null,
  insights: null,
  recommendedActions: null,
  selectedSite: null,
};

function reducer(state: AgentUIState, action: Action): AgentUIState {
  switch (action.type) {
    case "TOOL_START":
      return {
        ...state,
        activeTool: action.tool,
        isProcessing: true,
        toolLog: [...state.toolLog.slice(-49), `> ${action.tool}...`],
      };
    case "TOOL_LOG":
      return {
        ...state,
        toolLog: [...state.toolLog.slice(-49), action.message],
        isProcessing: false,
      };
    case "SET_CHART":
      return { ...state, chart: action.chart };
    case "SET_DOMAIN":
      return { ...state, domain: action.domain };
    case "AWAITING_USER_INPUT":
      return {
        ...state,
        awaitingUserInput: true,
        awaitingTimeoutMs: action.timeoutMs ?? null,
      };
    case "KEEPALIVE":
      return {
        ...state,
        lastKeepaliveAt: Date.now(),
        keepaliveMessage: action.message ?? null,
      };
    case "PENDING_URL":
      return { ...state, pendingUrl: action.url };
    case "CLEAR_PENDING_URL":
      return { ...state, pendingUrl: null };
    case "SET_METRICS":
      return {
        ...state,
        seoHealth: action.metrics.seoHealth,
        aiVisibility: action.metrics.aiVisibility,
        insights: action.metrics.insights,
        recommendedActions: action.metrics.recommendedActions,
      };
    case "RESET":
      return initial;
    case "SET_SELECTED_SITE":
      return { ...state, selectedSite: action.site, domain: action.site.domain };
    default:
      return state;
  }
}

const AgentCtx = createContext<{
  state: AgentUIState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AgentStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  return (
    <AgentCtx.Provider value={{ state, dispatch }}>
      {children}
    </AgentCtx.Provider>
  );
}

export function useAgentStore() {
  const ctx = useContext(AgentCtx);
  if (!ctx)
    throw new Error("useAgentStore must be used inside AgentStoreProvider");
  return ctx;
}
