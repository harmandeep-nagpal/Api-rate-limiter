local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local tokens = tonumber(redis.call("HGET", key, "tokens"))
local last_refill = tonumber(redis.call("HGET", key, "last_refill"))

-- First request
if tokens == nil then
    tokens = capacity
    last_refill = now
end

-- Calculate refill
local elapsed = now - last_refill
local elapsed_seconds = elapsed / 1000

local refill = elapsed_seconds * refill_rate

tokens = math.min(capacity, tokens + refill)

-- Try to consume one token
if tokens >= 1 then
    tokens = tokens - 1

    redis.call("HSET", key,
        "tokens", tokens,
        "last_refill", now
    )

    return {1, tokens}
else
    redis.call("HSET", key,
        "tokens", tokens,
        "last_refill", now
    )

    return {0, tokens}
end