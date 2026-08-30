const redisClient = require("../config/redis");

// Lua script to atomically increment the request counter
// and set the expiration time for a new rate-limit window.
const rateLimitScript = `
    local currentCount = redis.call("INCR", KEYS[1])

    if currentCount == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
    end

    return currentCount
`;


function fixedWindowRateLimiter(limit, windowSeconds, policyName = "global") {
    return async (req, res, next) => {
        try {
            // Identify the client using its IP address.
            const identifier = req.ip;

            // Create a number representing the current fixed window.
            const windowId = Math.floor(
                Date.now() / (windowSeconds * 1000)
            );

            // Create a unique Redis key for this:
            // policy + IP + time window
            const key = `rate_limit:${policyName}:ip:${identifier}:${windowId}`;

            // Calculate when the current window ends.
            const windowEnd =
                (windowId + 1) * windowSeconds * 1000;

            // Calculate how many seconds remain in the window.
            const ttlSeconds = Math.max(
                1,
                Math.ceil(
                    (windowEnd - Date.now()) / 1000
                )
            );

            // Execute the Lua script atomically.
            //
            // KEYS[1]  -> Redis rate-limit key
            // ARGV[1]  -> TTL in seconds
            const currentCount = await redisClient.eval(
                rateLimitScript,
                {
                    keys: [key],
                    arguments: [String(ttlSeconds)]
                }
            );

            // Calculate remaining requests.
            const remaining = Math.max(
                0,
                limit - currentCount
            );

            // Send rate-limit information to the client.
            res.setHeader(
                "X-RateLimit-Limit",
                limit
            );

            res.setHeader(
                "X-RateLimit-Remaining",
                remaining
            );

            res.setHeader(
                "X-RateLimit-Reset",
                Math.ceil(windowEnd / 1000)
            );

            // Reject requests after the limit is exceeded.
            if (currentCount > limit) {
                const retryAfter =
                    await redisClient.ttl(key);

                res.setHeader(
                    "Retry-After",
                    retryAfter
                );

                return res.status(429).json({
                    error: "Too many requests",
                    retryAfter
                });
            }

            // Request is within the limit.
            next();

        } catch (error) {
            console.error(
                "Rate limiter error:",
                error
            );

            // Fail open:
            // If Redis has a problem, allow the request
            // instead of taking down the API.
            next();
        }
    };
}

module.exports = fixedWindowRateLimiter;