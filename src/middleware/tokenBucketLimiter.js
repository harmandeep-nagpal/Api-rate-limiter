const fs = require("fs");
const path = require("path");

const redisClient = require("../config/redis");

// Load the Lua script once when the application starts.
// We don't want to read the file from disk on every request.
const tokenBucketScript = fs.readFileSync(
    path.join(__dirname, "../algorithms/tokenBucket.lua"),
    "utf8"
);

function tokenBucketRateLimiter(
    capacity,
    refillRate,
    policyName = "token-bucket"
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

            /*
             * Execute the Lua script atomically.
             *
             * KEYS[1] -> Redis key
             *
             * ARGV[1] -> bucket capacity
             * ARGV[2] -> refill rate (tokens/second)
             * ARGV[3] -> current timestamp (milliseconds)
             */
            const result = await redisClient.eval(
                tokenBucketScript,
                {
                    keys: [key],
                    arguments: [
                        String(capacity),
                        String(refillRate),
                        String(now)
                    ]
                }
            );

            // Lua returns:
            //
            // {1, remainingTokens} -> allowed
            // {0, remainingTokens} -> rejected
            const allowed = Number(result[0]);
            const remaining = Number(result[1]);

            // Send rate-limit information to the client.
            res.setHeader(
                "X-RateLimit-Limit",
                capacity
            );

            res.setHeader(
                "X-RateLimit-Remaining",
                Math.floor(remaining)
            );

            console.log(
                `[TokenBucket] ` +
                `policy=${policyName} ` +
                `ip=${identifier} ` +
                `remaining=${remaining}`
            );

            // Reject if there isn't enough capacity.
            if (allowed === 0) {
                // Calculate approximately how long until
                // one token becomes available.
                const retryAfter = Math.ceil(
                    (1 - remaining) / refillRate
                );

                res.setHeader(
                    "Retry-After",
                    Math.max(1, retryAfter)
                );

                console.log(
                    `[TokenBucket] BLOCKED ` +
                    `policy=${policyName} ` +
                    `ip=${identifier} ` +
                    `remaining=${remaining} ` +
                    `retryAfter=${retryAfter}s`
                );

                return res.status(429).json({
                    error: "Too many requests",
                    message:
                        "Rate limit exceeded. Try again later.",
                    retryAfter: Math.max(1, retryAfter)
                });
            }

            // Request is allowed.
            next();

        } catch (error) {
            console.error(
                "Token Bucket rate limiter error:",
                error
            );

            // Fail open:
            // If Redis fails, allow the request.
            next();
        }
    };
}

module.exports = tokenBucketRateLimiter;