const fs = require("fs");
const path = require("path");

const redisClient = require("../config/redis");

// Load the Lua script once when the application starts.
const slidingWindowScript = fs.readFileSync(
    path.join(__dirname, "../algorithms/slidingWindow.lua"),
    "utf8"
);

function slidingWindowRateLimiter(
    limit,
    windowSeconds,
    policyName = "sliding-window"
) {
    return async (req, res, next) => {
        try {
            // Identify the client using its IP address.
            const identifier = req.ip;

            // Unique Redis key for this client and policy.
            const key =
                `rate_limit:${policyName}:ip:${identifier}`;

            // Current time in milliseconds.
            const now = Date.now();

            // Convert the window from seconds to milliseconds.
            const windowMs = windowSeconds * 1000;

            // Generate a unique ID for this request.
            const requestId =
                `${now}-${Math.random().toString(36).slice(2)}`;

            /*
             * Execute the Lua script atomically.
             *
             * KEYS[1] -> Redis sorted-set key
             *
             * ARGV[1] -> current timestamp
             * ARGV[2] -> window size in milliseconds
             * ARGV[3] -> request limit
             * ARGV[4] -> unique request ID
             */
            const result = await redisClient.eval(
                slidingWindowScript,
                {
                    keys: [key],
                    arguments: [
                        String(now),
                        String(windowMs),
                        String(limit),
                        requestId
                    ]
                }
            );

            // Lua returns:
            //
            // {1, count} -> allowed
            // {0, count} -> rejected
            const allowed = Number(result[0]);
            const currentCount = Number(result[1]);

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

            console.log(
                `[SlidingWindow] ` +
                `policy=${policyName} ` +
                `ip=${identifier} ` +
                `count=${currentCount} ` +
                `remaining=${remaining}`
            );

            // Reject if the sliding window is full.
            if (allowed === 0) {
                res.setHeader(
                    "Retry-After",
                    windowSeconds
                );

                console.log(
                    `[SlidingWindow] BLOCKED ` +
                    `policy=${policyName} ` +
                    `ip=${identifier} ` +
                    `count=${currentCount}`
                );

                return res.status(429).json({
                    error: "Too many requests",
                    message:
                        "Rate limit exceeded. Try again later.",
                    retryAfter: windowSeconds
                });
            }

            // Request is allowed.
            next();

        } catch (error) {
            console.error(
                "Sliding Window rate limiter error:",
                error
            );

            // Fail open:
            // If Redis fails, allow the request.
            next();
        }
    };
}

module.exports = slidingWindowRateLimiter;