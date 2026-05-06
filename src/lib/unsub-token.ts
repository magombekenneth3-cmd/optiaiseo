/**
 * src/lib/unsub-token.ts
 * Shared HMAC-signed unsubscribe token utilities.
 * Keeping this outside the API route avoids Next.js
 * "not exported from route" build warnings.
 */
import { createHmac, timingSafeEqual } from "crypto";

export function signUnsubToken(userId: string): string {
  const ts = Date.now().toString();
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET not set");
  const sig = createHmac("sha256", secret)
    .update(`${userId}:${ts}`)
    .digest("hex")
    .slice(0, 16);
  return Buffer.from(`${userId}:${ts}:${sig}`).toString("base64url");
}

export function verifyUnsubToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 3) return null;
    const [userId, ts, sig] = [parts[0], parts[1], parts.slice(2).join(":")];
    const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    if (Date.now() - Number(ts) > MAX_AGE_MS) return null;
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) return null;
    const expected = createHmac("sha256", secret)
      .update(`${userId}:${ts}`)
      .digest("hex")
      .slice(0, 16);
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")))
      return null;
    return userId;
  } catch {
    return null;
  }
}
