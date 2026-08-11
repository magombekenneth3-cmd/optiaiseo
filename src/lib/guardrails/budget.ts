export interface JobBudget {
    maxCredits: number;
    maxLlmCalls: number;
    maxSearchCalls: number;
    maxRuntimeMs: number;
}

export class BudgetExceededError extends Error {
    constructor(metric: string, limit: number) {
        super(`AI Job Budget Exceeded: ${metric} surpassed limit of ${limit}`);
        this.name = "BudgetExceededError";
    }
}

export const DEFAULT_BLOG_BUDGET: JobBudget = {
    maxCredits: 10,
    maxLlmCalls: 5,
    maxSearchCalls: 10,
    maxRuntimeMs: 270000, // 4.5 minutes
};

export const DEFAULT_AUDIT_BUDGET: JobBudget = {
    maxCredits: 10,
    maxLlmCalls: 3,
    maxSearchCalls: 5,
    maxRuntimeMs: 180000, // 3 minutes
};

export class JobBudgetTracker {
    private budget: JobBudget;
    private llmCalls = 0;
    private searchCalls = 0;
    private startTime: number;

    constructor(budget: JobBudget) {
        this.budget = budget;
        this.startTime = Date.now();
    }

    recordLlmCall() {
        this.llmCalls++;
        if (this.llmCalls > this.budget.maxLlmCalls) {
            throw new BudgetExceededError("maxLlmCalls", this.budget.maxLlmCalls);
        }
        this.checkRuntime();
    }

    recordSearchCall() {
        this.searchCalls++;
        if (this.searchCalls > this.budget.maxSearchCalls) {
            throw new BudgetExceededError("maxSearchCalls", this.budget.maxSearchCalls);
        }
        this.checkRuntime();
    }

    checkRuntime() {
        const elapsed = Date.now() - this.startTime;
        if (elapsed > this.budget.maxRuntimeMs) {
            throw new BudgetExceededError("maxRuntimeMs", this.budget.maxRuntimeMs);
        }
    }
}
