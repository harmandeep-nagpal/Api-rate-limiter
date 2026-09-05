const fixedWindowRateLimiter = require("./rateLimiter");
const tokenBucketRateLimiter = require("./tokenBucketLimiter");
const slidingWindowRateLimiter = require("./slidingWindowLimiter");

function createRateLimiter(config) {

    const {
        algorithm,
        limit,
        window,
        capacity,
        refillRate,
        policyName
    } = config;

    switch (algorithm) {

        case "fixed-window":
            return fixedWindowRateLimiter(
                limit,
                window,
                policyName
            );

        case "token-bucket":
            return tokenBucketRateLimiter(
                capacity,
                refillRate,
                policyName
            );

        case "sliding-window":
            return slidingWindowRateLimiter(
                limit,
                window,
                policyName
            );

        default:
            throw new Error(
                `Unsupported rate limiting algorithm: ${algorithm}`
            );
    }
}

module.exports = createRateLimiter;