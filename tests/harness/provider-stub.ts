/**
 * D.8.1.1 — Provider Test Adapter (D.4 / Gemini Stub)
 *
 * Controllable LLM provider stub for D.8 failure injection tests.
 *
 * Modes:
 *   SUCCESS          — Returns a valid enhancement response
 *   NOT_FOUND        — Simulates Gemini 404 (RESOURCE_GONE classification)
 *   TIMEOUT          — Simulates request timeout (TRANSIENT classification)
 *   RATE_LIMITED     — Simulates 429 (TRANSIENT classification)
 *   MALFORMED_OUTPUT — Returns structurally invalid JSON (LLM_MALFORMED_OUTPUT)
 *   DELAYED_SUCCESS  — Waits for a configurable delay before returning SUCCESS.
 *                      Allows the test to mutate evidence while "in flight".
 *
 * Classification: UNIT / MOCKED
 */

export type ProviderMode =
  | "SUCCESS"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "MALFORMED_OUTPUT"
  | "DELAYED_SUCCESS";

export interface ProviderSuccessResponse {
  enhancedContent: string;
  rationale: string;
  confidenceScore: number;
  fallbackUsed: false;
}

export interface ProviderFallbackResponse {
  enhancedContent: string;
  rationale: string;
  confidenceScore: number;
  fallbackUsed: true;
  fallbackReason: string;
}

export type ProviderResponse = ProviderSuccessResponse | ProviderFallbackResponse;

export interface ProviderCallRecord {
  mode: ProviderMode;
  opportunityId: string;
  calledAt: Date;
  resolvedAt?: Date;
  error?: string;
}

// ── Stub Implementation ───────────────────────────────────────────────────────

export class D4ProviderStub {
  private mode: ProviderMode = "SUCCESS";
  private delayMs = 0;
  readonly calls: ProviderCallRecord[] = [];

  /** Set the mode for subsequent calls */
  setMode(mode: ProviderMode, options?: { delayMs?: number }): void {
    this.mode = mode;
    this.delayMs = options?.delayMs ?? 0;
  }

  /** Reset to clean state */
  reset(): void {
    this.mode = "SUCCESS";
    this.delayMs = 0;
    this.calls.length = 0;
  }

  /** Simulate an LLM enhancement call */
  async enhance(opportunityId: string, _context: unknown): Promise<ProviderResponse> {
    const record: ProviderCallRecord = {
      mode: this.mode,
      opportunityId,
      calledAt: new Date(),
    };
    this.calls.push(record);

    const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

    switch (this.mode) {
      case "SUCCESS": {
        record.resolvedAt = new Date();
        return {
          enhancedContent: `Enhanced content for ${opportunityId}`,
          rationale: "D8 test stub success",
          confidenceScore: 0.92,
          fallbackUsed: false,
        };
      }

      case "DELAYED_SUCCESS": {
        // Allows test to mutate state while "in flight"
        await delay(this.delayMs);
        record.resolvedAt = new Date();
        return {
          enhancedContent: `Delayed enhanced content for ${opportunityId}`,
          rationale: "D8 test stub delayed success",
          confidenceScore: 0.88,
          fallbackUsed: false,
        };
      }

      case "NOT_FOUND": {
        const err = Object.assign(new Error("Resource not found"), {
          status: 404,
          message: "404: The requested resource does not exist",
        });
        record.error = err.message;
        throw err;
      }

      case "TIMEOUT": {
        const err = Object.assign(new Error("Request timed out"), {
          message: "timeout: LLM request exceeded 30s limit",
        });
        record.error = err.message;
        throw err;
      }

      case "RATE_LIMITED": {
        const err = Object.assign(new Error("Too many requests"), {
          status: 429,
          message: "429: Rate limit exceeded. Retry after 60s",
        });
        record.error = err.message;
        throw err;
      }

      case "MALFORMED_OUTPUT": {
        const err = new Error(
          "LLM returned malformed output: missing required field 'enhancedContent'"
        );
        record.error = err.message;
        throw err;
      }

      default: {
        const err = new Error(`Unknown provider mode: ${this.mode}`);
        record.error = err.message;
        throw err;
      }
    }
  }

  callCount(): number {
    return this.calls.length;
  }

  lastCall(): ProviderCallRecord | undefined {
    return this.calls[this.calls.length - 1];
  }
}

/** Singleton for use across test suites */
export const providerStub = new D4ProviderStub();
