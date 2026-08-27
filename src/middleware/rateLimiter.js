const redisClient = require("../config/redis");

function fixedWindowRateLimiter(limit, windowSeconds) {
    return async (req, res, next) => {
        try {
            // We're identifying the client using its IP.
            const identifier = req.ip;
            // creates a number representing the current fixed window.
            const windowId = Math.floor(
                Date.now() / (windowSeconds * 1000)
            );

            const key = `rate_limit:ip:${identifier}:${windowId}`;

            const currentCount = await redisClient.incr(key);

            if (currentCount === 1) {
                const windowEnd = (windowId + 1) * windowSeconds * 1000;
                const ttlSeconds = Math.ceil(
                    (windowEnd - Date.now()) / 1000
                );

                await redisClient.expire(key, ttlSeconds);
            }

            const remaining = Math.max(0, limit - currentCount);

            res.setHeader("X-RateLimit-Limit", limit);
            res.setHeader("X-RateLimit-Remaining", remaining);

            if (currentCount > limit) {
                const retryAfter = await redisClient.ttl(key);

                res.setHeader("Retry-After", retryAfter);

                return res.status(429).json({
                    error: "Too many requests"
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