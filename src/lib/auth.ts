import { logger } from "@/lib/logger";
import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Account } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { AUTH_ERRORS } from "@/lib/constants/auth";
import { checkLockout, recordFailedAttempt, clearLockout } from "@/lib/auth/lockout";
import { parseUserPreferences } from "@/types/user-preferences";
import { redis } from "@/lib/redis";

const extractTokenFields = (account: Account) => ({
    access_token: account.access_token ?? null,
    refresh_token: account.refresh_token ?? null,
    expires_at: account.expires_at ?? null,
    token_type: account.token_type ?? null,
    scope: account.scope ?? null,
    id_token: account.id_token ?? null,
});

/**
 * Shared helper — fetches user + account data from the DB and hydrates the JWT token.
 * Single round-trip: user row + relevant OAuth accounts fetched together via nested select.
 * Called from both the `signIn` and `update` jwt callback triggers.
 *
 * Redis read-through cache (5 min TTL, keyed by email):
 * - On signIn/update the cache is intentionally written with fresh data.
 * - On tier change the cache is busted by bumpSessionVersion + redis.del in stripe/webhook.ts.
 */
const JWT_CACHE_TTL_S = 300;

export function jwtCacheKey(email: string): string {
    return `jwt:${email.toLowerCase().trim()}`;
}

async function hydrateTokenFromDb(token: JWT, email: string): Promise<JWT> {
    email = email.toLowerCase().trim();

    const cacheKey = jwtCacheKey(email);
    try {
        const hit = await redis.get<string>(cacheKey);
        if (hit) {
            return { ...token, ...JSON.parse(hit) };
        }
    } catch {
        // Redis unavailable — fall through to DB
    }

    const dbUser = await prisma.user.findUnique({
        where: { email },
        select: {
            id: true,
            role: true,
            subscriptionTier: true,
            gscConnected: true,
            preferences: true,
            accounts: {
                where: {
                    provider: { in: ["google-gsc", "google"] },
                    refresh_token: { not: null },
                },
                select: { provider: true, refresh_token: true },
                orderBy: { provider: "asc" },
            },
        },
    });

    if (!dbUser) return token;

    token.id = dbUser.id;
    token.role = dbUser.role;
    token.subscriptionTier = dbUser.subscriptionTier;
    token.gscConnected = dbUser.gscConnected;

    // Typed access — no more `as any` casts on the preferences column
    token.sessionVersion = parseUserPreferences(dbUser.preferences).sessionVersion ?? 0;

    // Prefer google-gsc token (has webmasters scope) over basic google token
    const gscAccount = dbUser.accounts.find((a) => a.provider === "google-gsc");
    const googleAccount = dbUser.accounts.find((a) => a.provider === "google");
    const refreshToken = gscAccount?.refresh_token ?? googleAccount?.refresh_token;
    if (refreshToken) {
        token.googleRefreshToken = refreshToken;
    }

    const hydrated = {
        id: token.id,
        role: token.role,
        subscriptionTier: token.subscriptionTier,
        gscConnected: token.gscConnected,
        sessionVersion: token.sessionVersion,
        // NOTE: googleRefreshToken intentionally NOT cached — it must not
        // persist in Redis where it could outlive the OAuth token's validity.
    };
    try {
        await redis.set(cacheKey, JSON.stringify(hydrated), { ex: JWT_CACHE_TTL_S });
    } catch {
        // Non-fatal — token proceeds without caching
    }

    return token;
}

export const authOptions: NextAuthOptions = {
    providers: [
        GithubProvider({
            clientId: process.env.GITHUB_ID || "",
            clientSecret: process.env.GITHUB_SECRET || "",
            authorization: {
                params: {
                    scope: "read:user user:email public_repo",
                },
            },
        }),

        GoogleProvider({
            id: "google",
            name: "Google",
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            authorization: {
                params: {
                    scope: "openid email profile",
                    prompt: "select_account",
                },
            },
        }),

        GoogleProvider({
            id: "google-gsc",
            name: "Google Search Console",
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            authorization: {
                params: {
                    scope: "openid email profile https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/indexing",
                    prompt: "consent",
                    access_type: "offline",
                },
            },
        }),

        CredentialsProvider({
            name: "Email & Password",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;
                const email = credentials.email.toLowerCase().trim();

                // Check lockout before any DB lookup — prevents brute-force
                if (await checkLockout(email)) {
                    throw new Error(AUTH_ERRORS.ACCOUNT_LOCKED);
                }

                const user = await prisma.user.findUnique({ where: { email } });

                if (!user) {
                    // Record attempt even for non-existent users to prevent account enumeration
                    await recordFailedAttempt(email);
                    return null;
                }

                // Throw OAuthAccount ONLY when the user row exists but has no password set.
                // Returning null for a missing user gives the correct "invalid credentials" error.
                if (!user.password) {
                    throw new Error(AUTH_ERRORS.OAUTH_ACCOUNT);
                }

                const passwordMatch = await bcrypt.compare(credentials.password, user.password);
                if (!passwordMatch) {
                    await recordFailedAttempt(email);
                    return null;
                }

                // Successful login — clear the lockout counter
                await clearLockout(email);
                return {
                    id: user.id,
                    email: user.email!,
                    name: user.name ?? email.split("@")[0],
                    image: user.image,
                };
            },
        }),
    ],

    session: {
        strategy: "jwt",
    },

    callbacks: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async signIn(...args: any[]) {
            const [{ user, account, req }] = args;
            if (account?.provider !== "credentials" && user.email) {
                let dbUser = await prisma.user.findUnique({ where: { email: user.email } });
                const isNewUser = !dbUser;
                if (!dbUser) {
                    const trialEndsAt = new Date();
                    trialEndsAt.setDate(trialEndsAt.getDate() + 7);
                    dbUser = await prisma.user.create({
                        data: {
                            email: user.email,
                            name: user.name ?? user.email.split("@")[0],
                            image: user.image,
                            trialEndsAt,
                        },
                    });

                    try {
                        const code = `REF-${crypto.randomUUID().replace(/-/g, "").substring(0, 8).toUpperCase()}`;
                        await prisma.referral.create({
                            data: { ownerId: dbUser.id, code },
                        });
                    } catch {
                        // Non-fatal — user is still created
                    }

                    try {
                        const { inngest } = await import("@/lib/inngest/client");
                        await inngest.send({
                            name: "user.registered",
                            data: {
                                userId: dbUser.id,
                                email: dbUser.email!,
                                name: dbUser.name ?? dbUser.email!.split("@")[0],
                            },
                        });
                    } catch (err) {
                        logger.warn("[Auth] inngest user.registered failed for OAuth user", {
                            error: (err as Error)?.message,
                        });
                    }
                } else if (!dbUser.name && user.name) {
                    dbUser = await prisma.user.update({
                        where: { email: user.email },
                        data: { name: user.name, image: user.image },
                    });
                }

                // NextAuth forwards the request as req — cookie is set by middleware
                const refCode = typeof req?.cookies?.get === "function"
                    ? req.cookies.get("aiseo_ref")?.value
                    : (req?.cookies as Record<string, string> | undefined)?.["aiseo_ref"];
                if (isNewUser && refCode && dbUser && typeof refCode === "string") {
                    try {
                        const referral = await prisma.referral.findUnique({ where: { code: refCode } });
                        if (referral && referral.ownerId !== dbUser.id) {
                            await prisma.referral.update({
                                where: { id: referral.id },
                                data: { signups: { increment: 1 } },
                            });
                            await prisma.user.update({
                                where: { id: dbUser.id },
                                data: { referralId: referral.id },
                            });
                        }
                    } catch {
                        // Non-fatal
                    }
                }


                if (dbUser && account?.providerAccountId) {
                    try {
                        // Call extractTokenFields once — not once per field
                        const tokenFields = extractTokenFields(account);
                        await prisma.account.upsert({
                            where: {
                                provider_providerAccountId: {
                                    provider: account.provider,
                                    providerAccountId: account.providerAccountId,
                                },
                            },
                            create: {
                                userId: dbUser.id,
                                type: account.type,
                                provider: account.provider,
                                providerAccountId: account.providerAccountId,
                                ...tokenFields,
                            },
                            update: {
                                access_token: tokenFields.access_token,
                                refresh_token: tokenFields.refresh_token,
                                expires_at: tokenFields.expires_at,
                                scope: tokenFields.scope,
                            },
                        });

                        if (
                            account.provider === "google-gsc" &&
                            (account.scope?.includes("indexing") || account.scope?.includes("webmasters"))
                        ) {
                            await prisma.user.update({
                                where: { id: dbUser.id },
                                data: { gscConnected: true },
                            });
                        }
                    } catch (err: unknown) {
                        logger.error("[Auth] Failed to persist Account tokens:", {
                            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
                        });
                    }
                }
            }
            return true;
        },

        async jwt({ token, user, trigger }) {
            // Short-circuit: routine session refresh (<60 s old) with cached tier.
            // Gap 5.1: version check now reads from Redis cache (where hydrateTokenFromDb
            // stores sessionVersion) instead of issuing a DB query on every request.
            // At 1000 active users × 60 req/min this saves ~60K DB queries/min.
            if (
                !trigger &&
                token.subscriptionTier &&
                token.iat &&
                (Date.now() / 1000 - (token.iat as number)) < 60
            ) {
                if (token.email) {
                    try {
                        const cacheKey = jwtCacheKey(token.email as string);
                        const cached = await redis.get<string>(cacheKey);
                        if (cached) {
                            const { sessionVersion: cachedVersion } = JSON.parse(cached);
                            const tokenVersion = (token.sessionVersion as number) ?? 0;
                            if (cachedVersion === tokenVersion) {
                                return token; // versions match — no webhook update, safe to return cached
                            }
                            // Version mismatch — tier changed via Stripe webhook, fall through to full hydration
                        } else {
                            // Cache miss (expired or evicted) — fall through to full hydration
                        }
                    } catch {
                        return token; // Redis unavailable — return cached token to avoid blocking
                    }
                } else {
                    return token;
                }
            }


            if (process.env.NODE_ENV === "development" && (trigger === "signIn" || trigger === "update")) {
                logger.debug(`[NextAuth JWT] Triggered. trigger=${trigger}, email=${token.email}`);
            }

            if (user) {
                if (!user.email) return token;
                try {
                    token = await hydrateTokenFromDb(token, user.email);
                } catch (err: unknown) {
                    logger.error("[NextAuth JWT] DB lookup failed during signIn:", {
                        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
                    });
                    token.error = AUTH_ERRORS.DB_LOOKUP_FAILED;
                    return token;
                }

                // Safety net: if DB lookup returned no id (new user race condition),
                // fall back to the NextAuth-assigned user id so session.user.id is never undefined
                if (!token.id && user.id) {
                    token.id = user.id;
                    logger.warn("[NextAuth JWT] DB lookup returned no user id — using fallback from user object.");
                }

                if (process.env.NODE_ENV === "development") {
                    logger.debug(`[NextAuth JWT] User Login. Fetched DB Tier: ${token.subscriptionTier}`);
                }
            }

            if (trigger === "update") {
                if (process.env.NODE_ENV === "development") {
                    logger.debug(`[NextAuth JWT] update trigger hit. Fetching fresh DB data...`);
                }
                if (token.email) {
                    try {
                        token = await hydrateTokenFromDb(token, token.email as string);
                        if (process.env.NODE_ENV === "development") {
                            logger.debug(`[NextAuth JWT] Successfully updated token to Tier: ${token.subscriptionTier}`);
                        }
                    } catch (err: unknown) {
                        logger.error("[NextAuth JWT] DB lookup failed during update trigger:", {
                            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
                        });
                        token.error = AUTH_ERRORS.DB_LOOKUP_FAILED;
                    }
                } else {
                    if (process.env.NODE_ENV === "development") {
                        logger.debug(`[NextAuth JWT] No email on token to look up DB.`);
                    }
                }
            }

            return token;
        },

        async session({ session, token }: { session: any; token: any }) {
            if (session?.user) {
                session.user.id = token.id;
                session.user.subscriptionTier = token.subscriptionTier;
                session.user.gscConnected = token.gscConnected;
                session.user.role = token.role;
                // SECURITY: googleRefreshToken is intentionally NOT propagated to session.user.
                // The refresh token must never leave the server — access it directly from
                // prisma.account server-side when needed (e.g. in server actions / API routes).
            }
            if (token?.error) {
                session.error = token.error as string;
            }
            return session;
        },

        // Explicit redirect allowlist — prevents open-redirect abuse via ?callbackUrl=
        async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
            if (url.startsWith("/")) return `${baseUrl}${url}`;
            try {
                const target = new URL(url);
                const base = new URL(baseUrl);
                if (target.origin === base.origin) return url;
            } catch {
                // malformed URL — fall through to safe default
            }
            return baseUrl;
        },
    },

    pages: {
        signIn: "/login",
        error: "/login",
    },
    secret: process.env.NEXTAUTH_SECRET,
};