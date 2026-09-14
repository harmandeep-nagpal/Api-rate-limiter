// ============================================================
// RATE LIMITER ERROR HANDLING
// ============================================================
//
// Centralized error handling for Redis/rate-limiter failures.
//
// Our current strategy is FAIL OPEN:
// if Redis is unavailable, the request continues instead
// of the entire API becoming unavailable.
//
// This helper keeps the behavior and logging consistent
// across all rate-limiting algorithms.
// ============================================================

function handleRateLimiterError(error, algorithm, next) {

    console.error(
        `[RateLimiter] Redis/rate limiter error ` +
        `algorithm=${algorithm}`
    );

    console.error(error);

    console.warn(
        `[RateLimiter] Redis unavailable. ` +
        `Failing open for algorithm=${algorithm}`
    );

    // Fail open.
    //
    // Allow the request to continue to the API
    // even though rate limiting could not be performed.
    next();
}

module.exports = handleRateLimiterError;