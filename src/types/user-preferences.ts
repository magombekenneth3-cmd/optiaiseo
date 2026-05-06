/**
 * Typed representation of the `preferences` JSON column on the User model.
 * Add new fields here as you introduce them — never cast with `as any`.
 */
export interface UserPreferences {
  /** Bumped by Stripe webhooks so the JWT callback knows to skip the short-circuit cache. */
  sessionVersion?: number;
  /** Unix timestamp (ms) of the last weekly SEO digest email. */
  lastDigestSentAt?: number;
}

/**
 * Safely parses raw JSON from `user.preferences` into a typed `UserPreferences`.
 * Handles null, undefined, non-object values, and arrays without throwing.
 */
export function parseUserPreferences(raw: unknown): UserPreferences {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as UserPreferences;
}
