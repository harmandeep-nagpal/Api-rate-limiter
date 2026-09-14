const fs = require("fs");
const path = require("path");

const redisClient = require("../config/redis");

// Shared HTTP response helpers.
//
// These keep the HTTP response format consistent across
// Fixed Window, Token Bucket, and Sliding Window.
const {
    setRateLimitHeaders,
    sendRateLimitExceeded
} = require("./rateLimitResponse");

// Metrics.
//
// These functions record how many requests are
// allowed or rejected by this policy.
const {
    recordAllowed,
    recordRejected
} = require("../monitoring/metrics");


// Load the Lua script once when the application starts.
//
// We don't want to read the Lua file from disk
// on every incoming request.
const tokenBucketScript = fs.readFileSync(
    path.join(__dirname, "../algorithms/tokenBucket.lua"),
    "utf8"
);

const handleRateLimiterError =
    require("./rateLimiterError");

function tokenBucketRateLimiter(
    capacity,
    refillRate,
    policyName = "token-bucket"
) {
    return async (req, res, next) => {

        try {

            // Identify the client using its IP address.
            const identifier = req.ip;


            // Create a unique Redis key for this
            // client and rate-limit policy.
            //
            // Example:
            // rate_limit:token-bucket:ip:127.0.0.1
            const key =
                `rate_limit:${policyName}:ip:${identifier}`;


            // Current timestamp in milliseconds.
            //
            // This is passed to Lua so it can calculate
            // how many tokens should have been refilled.
            const now = Date.now();


            /*
             * Execute the Token Bucket Lua script atomically.
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


            /*
             * Lua returns two values:
             *
             * {1, remainingTokens} -> request allowed
             * {0, remainingTokens} -> request rejected
             */
            const allowed = Number(result[0]);
            const remaining = Number(result[1]);


            // Token Bucket can contain fractional tokens internally.
            //
            // For the HTTP header, we expose only the whole number
            // of tokens available to the client.
            const remainingRequests =
                Math.floor(remaining);


            // Token Bucket does not have a fixed reset time
            // because tokens continuously refill.
            //
            // Therefore, we use a calculated reset reference
            // based on when the next token becomes available.
            setRateLimitHeaders(
                res,
                capacity,
                remainingRequests,
                Math.ceil(
                    (1 - remaining) / refillRate +
                    Date.now() / 1000
                )
            );


            // Log the current Token Bucket state.
            console.log(
                `[TokenBucket] ` +
                `policy=${policyName} ` +
                `ip=${identifier} ` +
                `remaining=${remaining}`
            );


            // If there isn't at least one token available,
            // reject the request.
            if (allowed === 0) {

                /*
                 * Record this request as rejected.
                 *
                 * This increments both:
                 * - total rejected requests
                 * - rejected requests for this policy
                 */
                recordRejected(policyName);


                /*
                 * Calculate approximately how many seconds
                 * are needed for one token to become available.
                 *
                 * Example:
                 *
                 * remaining = 0.2
                 * refillRate = 2 tokens/sec
                 *
                 * tokens needed = 1 - 0.2 = 0.8
                 *
                 * wait time = 0.8 / 2 = 0.4 sec
                 *
                 * Math.ceil() gives 1 second.
                 */
                const retryAfter = Math.ceil(
                    (1 - remaining) / refillRate
                );


                // Log the rejected request.
                console.log(
                    `[TokenBucket] BLOCKED ` +
                    `policy=${policyName} ` +
                    `ip=${identifier} ` +
                    `remaining=${remaining} ` +
                    `retryAfter=${retryAfter}s`
                );


                // Send the standardized 429 response.
                //
                // This automatically adds:
                //
                // Retry-After
                //
                // and returns:
                //
                // {
                //     error: "Too many requests",
                //     message: "...",
                //     retryAfter: ...
                // }
                return sendRateLimitExceeded(
                    res,
                    retryAfter
                );
            }


            /*
             * Record this request as allowed.
             *
             * This increments both:
             * - total allowed requests
             * - allowed requests for this policy
             */
            recordAllowed(policyName);


            // Token was available.
            // Allow the request to continue to the route.
            next();


        } catch (error) {

            handleRateLimiterError(
                error,
                "token-bucket",
                next
            );
            // Fail open:
            //
            // If Redis becomes unavailable,
            // allow the request instead of taking
            // down the API.
            next();
        }
    };
}


// Export the Token Bucket middleware.
module.exports = tokenBucketRateLimiter;