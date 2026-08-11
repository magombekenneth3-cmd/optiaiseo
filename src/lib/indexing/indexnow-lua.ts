import Redis from "ioredis";

export const RESERVE_QUOTA_LUA = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[1])
local requested = tonumber(ARGV[2])

local remaining = limit - current

if remaining <= 0 then
  return 0
end

local reserved = math.min(requested, remaining)

redis.call("INCRBY", KEYS[1], reserved)
redis.call("EXPIRE", KEYS[1], 172800)

return reserved
`;

export async function reserveGoogleQuotaAtomic(
    redis: Redis,
    quotaKey: string,
    dailyLimit = 200,
    requestedCount: number
): Promise<number> {
    const result = await redis.eval(
        RESERVE_QUOTA_LUA,
        1,
        quotaKey,
        dailyLimit.toString(),
        requestedCount.toString()
    );
    return Number(result) || 0;
}
