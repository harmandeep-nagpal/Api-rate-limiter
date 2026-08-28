const redisClient = require("../config/redis");

function fixedWindowRateLimiter(limit, windowSeconds, policyName = "global") {
    return async (req, res, next) => {
        try {
            // We're identifying the client using its IP.
            const identifier = req.ip;
            // creates a number representing the current fixed window.
            const windowId = Math.floor(
                Date.now() / (windowSeconds * 1000)
            );
            // Reddis Key
            const key = `rate_limit:${policyName}:ip:${identifier}:${windowId}`;

            const currentCount = await redisClient.incr(key);
            const windowEnd = (windowId + 1) * windowSeconds * 1000;
            if (currentCount === 1) {
                const ttlSeconds = Math.ceil(   
                    (windowEnd - Date.now()) / 1000
                );

                await redisClient.expire(key, ttlSeconds);
            }

            const remaining = Math.max(0, limit - currentCount);

            res.setHeader("X-RateLimit-Limit", limit);
            res.setHeader("X-RateLimit-Remaining", remaining);
            res.setHeader(
                "X-RateLimit-Reset",
                Math.ceil(windowEnd / 1000)
            );

            if (currentCount > limit) {
                const retryAfter = await redisClient.ttl(key);

                res.setHeader("Retry-After", retryAfter);

                return res.status(429).json({
                error: "Too many requests",
                retryAfter
            });
            }

            next();
        } catch (error) {
            console.error("Rate limiter error:", error);
            next();
        }
    };
}

module.exports = fixedWindowRateLimiter;