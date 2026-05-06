import { redis } from "@/lib/redis";

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function lockoutKey(email: string): string {
  return `lockout:${email.toLowerCase().trim()}`;
}

/**
 * Returns true if the account is currently locked out (≥ MAX_ATTEMPTS failures within the window).
 */
export async function checkLockout(email: string): Promise<boolean> {
  const attempts = await redis.get<string>(lockoutKey(email));
  return Number(attempts) >= MAX_ATTEMPTS;
}

/**
 * Increments the failed-attempt counter for the given email.
 * Sets a TTL on the first increment so the key auto-expires after LOCKOUT_SECONDS.
 * Always records the attempt even for non-existent users to prevent account enumeration.
 */
export async function recordFailedAttempt(email: string): Promise<void> {
  const key = lockoutKey(email);
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, LOCKOUT_SECONDS);
  }
}

/**
 * Clears the lockout counter on successful login.
 */
export async function clearLockout(email: string): Promise<void> {
  await redis.del(lockoutKey(email));
}
