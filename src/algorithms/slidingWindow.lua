local key = KEYS[1]

local now = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local request_id = ARGV[4]

-- Start of the current sliding window
local window_start = now - window_ms

-- Remove requests that are outside the window
redis.call(
    "ZREMRANGEBYSCORE",
    key,
    0,
    window_start
)

-- Count requests currently inside the window
local current_count = redis.call(
    "ZCARD",
    key
)

-- Reject if the limit has already been reached
if current_count >= limit then
    return {0, current_count}
end

-- Add the current request
redis.call(
    "ZADD",
    key,
    now,
    request_id
)

-- Keep the Redis key alive
redis.call(
    "PEXPIRE",
    key,
    window_ms
)

return {1, current_count + 1}