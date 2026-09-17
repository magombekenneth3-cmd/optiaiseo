/**
 * Integration Test Setup — Week 5
 *
 * Provides a controllable Prisma mock that lets integration tests exercise
 * real business logic composition (authorize → createOperation → execute)
 * without requiring a running database.
 *
 * Design decisions:
 *   - Dynamic import interception: all autonomy modules use `await import("@/lib/prisma")`
 *     so we mock at the module level.
 *   - In-memory stores: each Prisma model gets a Map-backed store with
 *     findUnique, findFirst, findMany, create, update, updateMany, count, delete.
 *   - Tests get isolated state via `resetAllStores()` in beforeEach.
 *   - $transaction delegates to the callback with the same mock client.
 *
 * This is NOT a replacement for real-DB integration tests. It is the
 * "integration correctness" layer that proves subsystem composition
 * without infrastructure dependencies.
 */

import { vi, beforeEach } from "vitest";

// ── In-Memory Store ────────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string };

export class InMemoryStore<T extends Row = Row> {
  private rows = new Map<string, T>();
  private uniqueIndexes = new Map<string, Map<string, string>>(); // indexKey → compositeValue → id

  constructor(private modelName: string) {}

  reset() {
    this.rows.clear();
    this.uniqueIndexes.clear();
  }

  addUniqueIndex(fields: string[]) {
    const key = fields.join("_");
    this.uniqueIndexes.set(key, new Map());
  }

  private checkUniqueConstraints(row: T, excludeId?: string): void {
    for (const [indexKey, index] of this.uniqueIndexes) {
      const fields = indexKey.split("_");
      const compositeValue = fields.map(f => String((row as any)[f] ?? "")).join("|");
      const existingId = index.get(compositeValue);
      if (existingId && existingId !== excludeId) {
        const error: any = new Error(`Unique constraint violation on ${this.modelName}.${indexKey}`);
        error.code = "P2002";
        error.meta = { target: fields };
        throw error;
      }
    }
  }

  private setUniqueIndexes(row: T): void {
    for (const [indexKey, index] of this.uniqueIndexes) {
      const fields = indexKey.split("_");
      const compositeValue = fields.map(f => String((row as any)[f] ?? "")).join("|");
      index.set(compositeValue, row.id);
    }
  }

  private removeUniqueIndexes(row: T): void {
    for (const [indexKey, index] of this.uniqueIndexes) {
      const fields = indexKey.split("_");
      const compositeValue = fields.map(f => String((row as any)[f] ?? "")).join("|");
      index.delete(compositeValue);
    }
  }

  seed(rows: T[]) {
    for (const row of rows) {
      this.rows.set(row.id, { ...row });
      this.setUniqueIndexes(row);
    }
  }

  // Prisma-like query methods

  findUnique(args: { where: { id?: string; [key: string]: unknown } }): T | null {
    if (args.where.id) {
      return this.rows.get(args.where.id) ?? null;
    }
    // Support composite unique lookups
    for (const row of this.rows.values()) {
      const match = Object.entries(args.where).every(([k, v]) => {
        if (typeof v === "object" && v !== null) {
          // Handle composite unique: { field1_field2: { field1: "a", field2: "b" } }
          return Object.entries(v as Record<string, unknown>).every(
            ([subK, subV]) => (row as any)[subK] === subV
          );
        }
        return (row as any)[k] === v;
      });
      if (match) return row;
    }
    return null;
  }

  findUniqueOrThrow(args: { where: { id: string; [key: string]: unknown } }): T {
    const result = this.findUnique(args);
    if (!result) throw new Error(`${this.modelName} not found: ${JSON.stringify(args.where)}`);
    return result;
  }

  findFirst(args?: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown> }): T | null {
    const results = this.findMany(args);
    return results[0] ?? null;
  }

  findMany(args?: { where?: Record<string, unknown>; orderBy?: Record<string, string>; select?: Record<string, unknown>; take?: number; distinct?: string[] }): T[] {
    let results = Array.from(this.rows.values());

    if (args?.where) {
      results = results.filter(row => matchesWhere(row, args.where!));
    }

    if (args?.orderBy) {
      const [field, dir] = Object.entries(args.orderBy)[0];
      results.sort((a, b) => {
        const aVal = (a as any)[field];
        const bVal = (b as any)[field];
        if (aVal < bVal) return dir === "asc" ? -1 : 1;
        if (aVal > bVal) return dir === "asc" ? 1 : -1;
        return 0;
      });
    }

    if (args?.take) {
      results = results.slice(0, args.take);
    }

    return results;
  }

  count(args?: { where?: Record<string, unknown> }): number {
    if (!args?.where) return this.rows.size;
    return this.findMany({ where: args.where }).length;
  }

  create(args: { data: Partial<T> & { id?: string } }): T {
    const id = args.data.id ?? `${this.modelName.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const row = {
      ...args.data,
      id,
      createdAt: args.data.createdAt ?? now,
      updatedAt: args.data.updatedAt ?? now,
    } as unknown as T;
    this.checkUniqueConstraints(row);
    this.rows.set(id, row);
    this.setUniqueIndexes(row);
    return row;
  }

  update(args: { where: { id: string }; data: Partial<T> }): T {
    const existing = this.findUniqueOrThrow(args);
    const updated = { ...existing, ...args.data, updatedAt: new Date() } as T;
    this.removeUniqueIndexes(existing);
    this.checkUniqueConstraints(updated, existing.id);
    this.rows.set(existing.id, updated);
    this.setUniqueIndexes(updated);
    return updated;
  }

  updateMany(args: { where: Record<string, unknown>; data: Partial<T> }): { count: number } {
    const matches = this.findMany({ where: args.where });
    for (const row of matches) {
      this.update({ where: { id: row.id }, data: args.data });
    }
    return { count: matches.length };
  }

  upsert(args: { where: { id?: string; [key: string]: unknown }; create: Partial<T> & { id?: string }; update: Partial<T> }): T {
    const existing = this.findUnique(args);
    if (existing) {
      return this.update({ where: { id: existing.id }, data: args.update });
    }
    return this.create({ data: args.create });
  }

  delete(args: { where: { id: string } }): T {
    const existing = this.findUniqueOrThrow(args);
    this.removeUniqueIndexes(existing);
    this.rows.delete(existing.id);
    return existing;
  }

  deleteMany(args?: { where?: Record<string, unknown> }): { count: number } {
    if (!args?.where) {
      const count = this.rows.size;
      this.rows.clear();
      this.uniqueIndexes.forEach(idx => idx.clear());
      return { count };
    }
    const matches = this.findMany({ where: args.where });
    for (const row of matches) {
      this.removeUniqueIndexes(row);
      this.rows.delete(row.id);
    }
    return { count: matches.length };
  }

  aggregate(args: { where?: Record<string, unknown>; _sum?: Record<string, true>; _avg?: Record<string, true>; _count?: Record<string, true> }): Record<string, any> {
    const rows = args.where ? this.findMany({ where: args.where }) : Array.from(this.rows.values());
    const result: Record<string, any> = {};

    if (args._sum) {
      result._sum = {};
      for (const field of Object.keys(args._sum)) {
        result._sum[field] = rows.reduce((sum, r) => sum + (Number((r as any)[field]) || 0), 0);
      }
    }
    if (args._avg) {
      result._avg = {};
      for (const field of Object.keys(args._avg)) {
        const values = rows.map(r => Number((r as any)[field])).filter(v => !isNaN(v));
        result._avg[field] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
      }
    }
    if (args._count) {
      result._count = {};
      for (const field of Object.keys(args._count)) {
        result._count[field] = rows.filter(r => (r as any)[field] != null).length;
      }
    }

    return result;
  }

  // Direct access for test assertions
  getAll(): T[] { return Array.from(this.rows.values()); }
  getById(id: string): T | null { return this.rows.get(id) ?? null; }
}

// ── Where Matching ─────────────────────────────────────────────────────────

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      if (!Array.isArray(condition) || !condition.some((branch) => matchesWhere(row, branch as Record<string, unknown>))) return false;
      continue;
    }
    const value = (row as any)[key];

    if (condition === null || condition === undefined) {
      if (value !== condition) return false;
      continue;
    }

    if (typeof condition === "object" && condition !== null && !Array.isArray(condition) && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ("in" in cond) {
        if (!Array.isArray(cond.in) || !cond.in.includes(value)) return false;
      }
      if ("not" in cond) {
        if (value === cond.not) return false;
      }
      if ("gte" in cond) {
        if (value < (cond.gte as any)) return false;
      }
      if ("lte" in cond) {
        if (value > (cond.lte as any)) return false;
      }
      if ("lt" in cond) {
        if (value >= (cond.lt as any)) return false;
      }
      if ("gt" in cond) {
        if (value <= (cond.gt as any)) return false;
      }
      continue;
    }

    if (value !== condition) return false;
  }
  return true;
}

// ── Stores ─────────────────────────────────────────────────────────────────

export const stores = {
  site: new InMemoryStore("Site"),
  growthDecision: new InMemoryStore("GrowthDecision"),
  actionProposal: new InMemoryStore("ActionProposal"),
  mutationOperation: new InMemoryStore("MutationOperation"),
  mutationEffect: new InMemoryStore("MutationEffect"),
  mutationSnapshot: new InMemoryStore("MutationSnapshot"),
  experiment: new InMemoryStore("Experiment"),
  experimentVariant: new InMemoryStore("ExperimentVariant"),
  experimentMeasurement: new InMemoryStore("ExperimentMeasurement"),
  budgetReservation: new InMemoryStore("BudgetReservation"),
  circuitBreaker: new InMemoryStore("CircuitBreaker"),
  autonomousExecutionClaim: new InMemoryStore("AutonomousExecutionClaim"),
  executionTrace: new InMemoryStore("ExecutionTrace"),
  learnedSignal: new InMemoryStore("LearnedSignal"),
  actionPerformance: new InMemoryStore("ActionPerformance"),
  selfHealingLog: new InMemoryStore("SelfHealingLog"),
  aeoReport: new InMemoryStore("AeoReport"),
  blog: new InMemoryStore("Blog"),
  gscDailyPerformance: new InMemoryStore("GscDailyPerformance"),
  indexingLog: new InMemoryStore("IndexingLog"),
  internalLink: new InMemoryStore("InternalLink"),
};

// Add unique indexes matching production schema
stores.mutationOperation.addUniqueIndex(["idempotencyKey"]);
stores.mutationEffect.addUniqueIndex(["idempotencyKey"]);
stores.autonomousExecutionClaim.addUniqueIndex(["opportunityId"]);
stores.experiment.addUniqueIndex(["decisionId"]);
stores.selfHealingLog.addUniqueIndex(["siteId", "fingerprint", "dedupeBucket"]);

export function resetAllStores() {
  for (const store of Object.values(stores)) {
    store.reset();
  }
}

// ── Relation Definitions ───────────────────────────────────────────────────
// Maps parent model → relation name → { store, foreignKey }

const RELATIONS: Record<string, Record<string, { storeName: keyof typeof stores; foreignKey: string }>> = {
  experiment: {
    variants: { storeName: "experimentVariant", foreignKey: "experimentId" },
    measurements: { storeName: "experimentMeasurement", foreignKey: "experimentId" },
  },
};

/**
 * Wraps a store to intercept findMany/findFirst and resolve relations
 * specified in `select` or `include`, mimicking Prisma's eager loading.
 */
function withRelations(storeName: string, store: InMemoryStore) {
  const relations = RELATIONS[storeName];
  if (!relations) return store;

  return new Proxy(store, {
    get(target, prop: string) {
      if (prop === "findMany") {
        return (args?: any) => {
          const rows = target.findMany(args);
          if (!args?.select && !args?.include) return rows;

          const relKeys = Object.keys(relations).filter(
            k => (args?.select && k in args.select) || (args?.include && k in args.include)
          );
          if (relKeys.length === 0) return rows;

          return rows.map((row: any) => {
            const enriched = { ...row };
            for (const relKey of relKeys) {
              const rel = relations[relKey];
              const relStore = (stores as any)[rel.storeName] as InMemoryStore;
              enriched[relKey] = relStore.findMany({
                where: { [rel.foreignKey]: row.id },
              });
            }
            return enriched;
          });
        };
      }
      if (prop === "findFirst") {
        return (args?: any) => {
          const row = target.findFirst(args);
          if (!row || (!args?.select && !args?.include)) return row;

          const relKeys = Object.keys(relations).filter(
            k => (args?.select && k in args.select) || (args?.include && k in args.include)
          );
          if (relKeys.length === 0) return row;

          const enriched: any = { ...row };
          for (const relKey of relKeys) {
            const rel = relations[relKey];
            const relStore = (stores as any)[rel.storeName] as InMemoryStore;
            enriched[relKey] = relStore.findMany({
              where: { [rel.foreignKey]: row.id },
            });
          }
          return enriched;
        };
      }
      return (target as any)[prop]?.bind?.(target) ?? (target as any)[prop];
    },
  });
}

// ── Mock Prisma Client ─────────────────────────────────────────────────────

export const mockPrisma = new Proxy({} as Record<string, any>, {
  get(_target, prop: string) {
    if (prop === "$transaction") {
      return async (fn: (tx: any) => Promise<any>, _opts?: any) => {
        // Execute the callback with the same mock client
        return fn(mockPrisma);
      };
    }
    if (prop === "$connect" || prop === "$disconnect") {
      return async () => {};
    }
    if (prop in stores) {
      const store = (stores as any)[prop];
      // Return relation-aware proxy for models that have defined relations
      if (prop in RELATIONS) {
        return withRelations(prop, store);
      }
      return store;
    }
    // Return a no-op store for unknown models
    return new InMemoryStore(prop);
  },
});

// ── Global Mock Setup ──────────────────────────────────────────────────────

// Mock @/lib/prisma — all dynamic imports will get our mock
vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock @/lib/logger — suppress log output during tests
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock @/lib/redis — no Redis needed for integration tests
vi.mock("@/lib/redis", () => ({
  getRedis: () => null,
}));

// Mock @/lib/notifications — no real notifications
vi.mock("@/lib/notifications", () => ({
  notifyMutationFailed: vi.fn(),
  notifyExperimentComplete: vi.fn(),
}));

// Mock @/lib/config/env-validator — provide autonomous config
vi.mock("@/lib/config/env-validator", () => ({
  getAutonomousConfig: () => ({
    globalKillSwitch: false,
    maxProposalsPerHour: 100,
  }),
}));

// Reset all stores before each test
beforeEach(() => {
  resetAllStores();
});
