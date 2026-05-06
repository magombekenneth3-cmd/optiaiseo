/**
 * Auth error string constants shared between the credentials provider (throw site)
 * and the login page (catch/match site).
 *
 * Using constants prevents typo-induced silent failures — a misspelled string
 * would just never match, making the wrong error message appear with no warning.
 */
export const AUTH_ERRORS = {
  /** User has an OAuth account — no password set. Prompt them to sign in with Google/GitHub. */
  OAUTH_ACCOUNT: "OAuthAccount",
  /** DB lookup failed during JWT hydration — token carries stale data. */
  DB_LOOKUP_FAILED: "DbLookupFailed",
  /** Account is locked after too many failed attempts. */
  ACCOUNT_LOCKED: "AccountLocked",
} as const;

export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS];

/**
 * Operational alert email — used only for sending system alerts (e.g. Stripe
 * webhook failures). NOT used for access control — admin access is determined
 * exclusively by the SUPER_ADMIN database role in admin-guard.ts.
 * Set ALERT_EMAIL in your environment variables to change without a code deploy.
 */
export const ALERT_EMAIL =
    process.env.ALERT_EMAIL ?? process.env.ADMIN_EMAIL ?? "kennethdavid256@gmail.com";
