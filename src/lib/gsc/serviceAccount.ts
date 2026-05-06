import { Redis } from "@upstash/redis";

export type Logger = {
    info: (data: Record<string, unknown>, msg: string) => void;
    error: (data: Record<string, unknown>, msg: string) => void;
    warn: (data: Record<string, unknown>, msg: string) => void;
};

const defaultLogger: Logger = {
    info: (data, msg) => console.log(JSON.stringify({ level: "info", msg, ...data })),
    error: (data, msg) => console.error(JSON.stringify({ level: "error", msg, ...data })),
    warn: (data, msg) => console.warn(JSON.stringify({ level: "warn", msg, ...data })),
};

let _logger: Logger = defaultLogger;

export function setLogger(l: Logger): void {
    _logger = l;
}

type CachedEntry = {
    token: string;
    expiresAt: number;
};

const SCOPES = [
    "https://www.googleapis.com/auth/webmasters.readonly",
    "https://www.googleapis.com/auth/indexing",
] as const;

const TOKEN_TTL_SECONDS = 55 * 60;
const TOKEN_BUFFER_MS = 5 * 60 * 1000;
const REDIS_TOKEN_KEY = "gsa:access_token";
const REDIS_LOCK_KEY = "gsa:token_lock";
const REDIS_LOCK_TTL_MS = 10_000;
const MAX_RETRIES = 3;

let _redis: Redis | null = null;
let _auth: Awaited<ReturnType<typeof buildAuth>> | null = null;
let _tokenPromise: Promise<string> | null = null;

function getRedis(): Redis {
    if (_redis) return _redis;

    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;

    if (!url || !token) {
        throw new Error("Missing UPSTASH_REDIS_URL or UPSTASH_REDIS_TOKEN.");
    }

    _redis = new Redis({ url, token });
    return _redis;
}

function getCredentials(): { client_email: string; private_key: string } {
    const client_email = process.env.GOOGLE_CLIENT_EMAIL;
    const raw = process.env.GOOGLE_PRIVATE_KEY;

    if (!client_email || !raw) {
        throw new Error("Missing GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY.");
    }

    const private_key = raw.replace(/\\n/g, "\n");
    const credentials = { client_email, private_key };
    Object.defineProperty(credentials, "private_key", { enumerable: false });
    return credentials;
}

function isValidToken(value: unknown): value is string {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.split(".").length === 3
    );
}

async function buildAuth() {
    const { google } = await import("googleapis");
    const credentials = getCredentials();
    return new google.auth.GoogleAuth({ credentials, scopes: [...SCOPES] });
}

async function getAuth() {
    if (_auth) return _auth;
    _auth = await buildAuth();
    return _auth;
}

async function fetchTokenFromGoogle(): Promise<string> {
    const auth = await getAuth();
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    if (!isValidToken(token)) {
        throw new Error("Google returned an invalid or empty access token.");
    }

    return token;
}

async function fetchTokenWithRetry(): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const token = await fetchTokenFromGoogle();
            const entry: CachedEntry = {
                token,
                expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
            };
            await getRedis().set(REDIS_TOKEN_KEY, JSON.stringify(entry), {
                ex: TOKEN_TTL_SECONDS,
            });
            return token;
        } catch (err) {
            lastError = err;
            _logger.error({ err, attempt, maxRetries: MAX_RETRIES }, "Token fetch attempt failed");
            if (attempt < MAX_RETRIES) {
                await new Promise((res) => setTimeout(res, 2 ** attempt * 100));
            }
        }
    }

    throw lastError;
}

async function acquireRedisLock(): Promise<boolean> {
    const result = await getRedis().set(REDIS_LOCK_KEY, "1", {
        nx: true,
        px: REDIS_LOCK_TTL_MS,
    });
    return result === "OK";
}

async function releaseRedisLock(): Promise<void> {
    await getRedis().del(REDIS_LOCK_KEY);
}

async function getCachedToken(): Promise<string | null> {
    try {
        const raw = await getRedis().get<string>(REDIS_TOKEN_KEY);
        if (!raw) return null;

        const entry: CachedEntry = JSON.parse(raw);

        if (!isValidToken(entry.token)) {
            _logger.warn({}, "Cached token failed validation, discarding");
            return null;
        }

        if (Date.now() > entry.expiresAt - TOKEN_BUFFER_MS) {
            return null;
        }

        return entry.token;
    } catch (err) {
        _logger.error({ err }, "Redis cache read failed, falling through to Google");
        return null;
    }
}

async function refreshToken(): Promise<string> {
    const locked = await acquireRedisLock();

    if (!locked) {
        await new Promise((res) => setTimeout(res, 500));
        const token = await getCachedToken();
        if (token) return token;
        throw new Error("Could not acquire token refresh lock and cache is empty.");
    }

    try {
        const start = Date.now();
        const token = await fetchTokenWithRetry();
        _logger.info({ durationMs: Date.now() - start }, "Service account token refreshed");
        return token;
    } finally {
        await releaseRedisLock();
    }
}

export async function getServiceAccountToken(): Promise<string> {
    const cached = await getCachedToken();
    if (cached) return cached;

    if (!_tokenPromise) {
        _tokenPromise = refreshToken()
            .catch((err) => {
                _logger.error({ err }, "Service account token refresh failed");
                throw err;
            })
            .finally(() => {
                _tokenPromise = null;
            });
    }

    return _tokenPromise;
}