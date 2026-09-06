const redisClient = require("../config/redis");

// Import shared HTTP response helpers.
// These handle rate-limit headers and 429 responses.
const {
    setRateLimitHeaders,
    sendRateLimitExceeded
} = require("./rateLimitResponse");


// Lua script for Fixed Window Rate Limiting.
//
// Redis executes this script atomically.
//
// KEYS[1] -> Redis key for the current window
// ARGV[1] -> TTL of the current window in seconds
const rateLimitScript = `
    -- Increment the request counter
    local currentCount = redis.call("INCR", KEYS[1])

    -- Set expiration only for the first request.
    -- This prevents later requests from extending the window.
    if currentCount == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
    end

    -- Return the current request count
    return currentCount
`;


/*
 * Fixed Window Rate Limiter
 *
 * limit         -> maximum requests allowed
 * windowSeconds -> length of the fixed window
 * policyName    -> identifies the rate-limit policy
 *
 * Example:
 * fixedWindowRateLimiter(10, 60, "general")
 *
 * means:
 * 10 requests are allowed every 60 seconds.
 */
function fixedWindowRateLimiter(
    limit,
    windowSeconds,
    policyName = "global"
) {

    // Return an Express middleware function
    return async (req, res, next) => {

        try {

            // Identify the client using its IP address.
            const identifier = req.ip;


            // Determine which fixed window this request belongs to.
            //
            // For a 60-second window, requests within the same
            // 60-second period will have the same windowId.
            const windowId = Math.floor(
                Date.now() / (windowSeconds * 1000)
            );


            // Redis key contains:
            // policy + client IP + window ID
            //
            // Example:
            // rate_limit:general:ip:10.0.0.1:123456
            const key =
                `rate_limit:${policyName}:ip:${identifier}:${windowId}`;


            // Calculate the exact end of the current window.
            const windowEnd =
                (windowId + 1) * windowSeconds * 1000;


            // Calculate how many seconds remain
            // before the current window expires.
            const ttlSeconds = Math.max(
                1,
                Math.ceil(
                    (windowEnd - Date.now()) / 1000
                )
            );


            // Execute the Lua script atomically in Redis.
            //
            // The script increments the counter and
            // sets the expiration when necessary.
            const currentCount = await redisClient.eval(
                rateLimitScript,
                {
                    keys: [key],
                    arguments: [String(ttlSeconds)]
                }
            );


            // Calculate how many requests remain.
            const remaining = Math.max(
                0,
                limit - currentCount
            );


            // Convert the reset time from milliseconds
            // into Unix timestamp seconds.
            const resetTime =
                Math.ceil(windowEnd / 1000);


            // Add standardized rate-limit headers.
            setRateLimitHeaders(
                res,
                limit,
                remaining,
                resetTime
            );


            // Log useful information about this request.
            console.log(
                `[RateLimiter] policy=${policyName} ` +
                `ip=${identifier} ` +
                `count=${currentCount} ` +
                `remaining=${remaining}`
            );


            // If the request exceeds the configured limit,
            // reject it with HTTP 429.
            if (currentCount > limit) {

                // Find out how many seconds remain
                // before the current window expires.
                const retryAfter =
                    await redisClient.ttl(key);


                // Log the blocked request.
                console.log(
                    `[RateLimiter] BLOCKED ` +
                    `policy=${policyName} ` +
                    `ip=${identifier} ` +
                    `count=${currentCount} ` +
                    `retryAfter=${retryAfter}s`
                );


                // Send the standardized 429 response.
                return sendRateLimitExceeded(
                    res,
                    retryAfter
                );
            }


            // Request is allowed.
            // Continue to the next middleware/route.
            next();


        } catch (error) {

            // Log Redis or rate-limiter errors.
            console.error(
                "Rate limiter error:",
                error
            );


            // Fail open:
            // if the limiter itself fails, allow the request
            // to continue instead of blocking the entire API.
            next();
        }
    };
}


// Export the middleware.
module.exports = fixedWindowRateLimiter;