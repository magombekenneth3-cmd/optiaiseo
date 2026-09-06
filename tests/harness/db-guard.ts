/**
 * D.8.1.1 — Staging Database Safety Guard
 *
 * Prevents D.8 tests from executing against production databases.
 * Every live-DB test must call assertStagingDatabase() in beforeAll.
 *
 * Infrastructure: LIVE_DB guard
 */

const STAGING_INDICATORS = [
  "test",
  "staging",
  "dev",
  "localhost",
  "127.0.0.1",
  "railway", // Railway proxy is staging
];

const PRODUCTION_INDICATORS = [
  "production",
  "prod-db",
  "main-db",
];

export function assertStagingDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";

  if (!url) {
    throw new Error(
      "[D8 Safety Guard] DATABASE_URL is not set. " +
      "D.8 live-DB tests require an explicit staging database connection."
    );
  }

  const lower = url.toLowerCase();

  for (const indicator of PRODUCTION_INDICATORS) {
    if (lower.includes(indicator)) {
      throw new Error(
        `[D8 Safety Guard] DATABASE_URL contains '${indicator}' — ` +
        "refusing to run D.8 tests against a production database. " +
        "Use a staging or test database."
      );
    }
  }

  const hasStagingIndicator = STAGING_INDICATORS.some((s) => lower.includes(s));
  if (!hasStagingIndicator) {
    throw new Error(
      "[D8 Safety Guard] DATABASE_URL does not contain any staging indicators " +
      `(${STAGING_INDICATORS.join(", ")}). ` +
      "Set D8_ALLOW_UNKNOWN_DB=true to override, or use a staging database."
    );
  }
}

/** Whether the live DB is available for integration tests */
export function isLiveDbAvailable(): boolean {
  return process.env.D8_LIVE_DB === "true";
}

/** Whether live Redis is available */
export function isLiveRedisAvailable(): boolean {
  return process.env.D8_LIVE_REDIS === "true";
}

/** Test infrastructure mode declaration */
export type InfraMode = "MOCKED" | "LIVE_DB" | "LIVE_REDIS" | "LIVE_PROVIDER";
export type TestLevel = "UNIT" | "INTEGRATION" | "E2E";

export interface TestClassification {
  level: TestLevel;
  infra: InfraMode[];
  description: string;
}
