/**
 * Phase D.3 — Planning Module Barrel Export
 */

export { PLANNING_VERSION } from "./types";
export type {
  PlanningInput,
  ActionPlan,
  PlanningResult,
  PlanningDecision,
  PlanningReason,
  PlanningConstraints,
  PlanningEvidence,
  ActionPlanner,
} from "./types";

export {
  CATEGORY_ACTION_MAP,
  GROWTH_ACTION_MAP,
  getPreferredAction,
  getAllowedActions,
  isActionAllowedForCategory,
  resolveActionType,
  selectActionType,
} from "./action-taxonomy";

export { PLANNER_REGISTRY, getPlanner } from "./action-planners";
export { validatePlanningInput, validatePlan } from "./validator";
export { verifyPlanningEvidenceFence } from "./planning-fence";
export { planOpportunity, loadPlanningInput } from "./planner";
