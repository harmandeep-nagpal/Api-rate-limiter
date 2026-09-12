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
// for every incoming request.
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


            // Create a unique Redis key for this
            // client and rate-limit policy.
            //
            // Example:
            // rate_limit:sliding-window:ip:127.0.0.1
            const key =
                `rate_limit:${policyName}:ip:${identifier}`;


            // Current timestamp in milliseconds.
            const now = Date.now();


            // Convert the configured window from
            // seconds to milliseconds because our
            // Lua algorithm works with milliseconds.
            const windowMs =
                windowSeconds * 1000;


            // Generate a unique ID for this request.
            //
            // The timestamp alone isn't enough because
            // multiple requests can arrive during the same
            // millisecond.
            const requestId =
                `${now}-${Math.random().toString(36).slice(2)}`;


            /*
             * Execute the Sliding Window Lua script atomically.
             *
             * KEYS[1] -> Redis sorted-set key
             *
             * ARGV[1] -> current timestamp
             * ARGV[2] -> window size in milliseconds
             * ARGV[3] -> request limit
             * ARGV[4] -> unique request ID
             *
             * The Lua script:
             * 1. Removes expired requests
             * 2. Counts requests in the window
             * 3. Rejects if the limit is reached
             * 4. Adds the request if allowed
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


            /*
             * Lua returns:
             *
             * {1, count} -> request allowed
             * {0, count} -> request rejected
             */
            const allowed =
                Number(result[0]);

            const currentCount =
                Number(result[1]);


            // Calculate how many requests remain.
            const remaining = Math.max(
                0,
                limit - currentCount
            );


            /*
             * Sliding Window doesn't have a single fixed
             * reset time like Fixed Window.
             *
             * Requests leave the window individually as
             * they become older than windowSeconds.
             *
             * For now, we expose the end of the current
             * observation window as the reset reference.
             */
            const resetTime =
                Math.ceil(
                    (now + windowMs) / 1000
                );


            // Add standardized rate-limit headers.
            //
            // X-RateLimit-Limit
            //     Maximum requests allowed.
            //
            // X-RateLimit-Remaining
            //     Requests still available.
            //
            // X-RateLimit-Reset
            //     Reset reference timestamp.
            setRateLimitHeaders(
                res,
                limit,
                remaining,
                resetTime
            );


            // Log the current Sliding Window state.
            console.log(
                `[SlidingWindow] ` +
                `policy=${policyName} ` +
                `ip=${identifier} ` +
                `count=${currentCount} ` +
                `remaining=${remaining}`
            );


            // If the sliding window is full,
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
                 * At this stage, the exact time until the
                 * oldest request expires is not returned by
                 * our current Lua script.
                 *
                 * Therefore we use the configured window
                 * as the retry interval for now.
                 */
                const retryAfter =
                    windowSeconds;


                // Log the rejected request.
                console.log(
                    `[SlidingWindow] BLOCKED ` +
                    `policy=${policyName} ` +
                    `ip=${identifier} ` +
                    `count=${currentCount} ` +
                    `retryAfter=${retryAfter}s`
                );


                // Send the standardized 429 response.
                //
                // This also adds:
                //
                // Retry-After
                //
                // and returns a consistent JSON structure.
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


            // Request is allowed.
            // Continue to the Express route.
            next();


        } catch (error) {

            // Log Redis or rate-limiter errors.
            console.error(
                "Sliding Window rate limiter error:",
                error
            );


            // Fail open:
            //
            // If Redis becomes unavailable,
            // allow the request rather than blocking
            // the entire API.
            next();
        }
    };
}


// Export the Sliding Window middleware.
module.exports = slidingWindowRateLimiter;