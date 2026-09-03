// Reads a positive integer from an environment variable.
//
// Example:
// GENERAL_RATE_LIMIT=10
//
// becomes:
// 10
//
// If the value is invalid, the application stops with
// a clear configuration error.

function getPositiveInteger(name) {
    const value = Number(process.env[name]);

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
            `${name} must be a positive integer`
        );
    }

    return value;
}


// General API rate-limit configuration
const general = {
    limit: getPositiveInteger("GENERAL_RATE_LIMIT"),
    window: getPositiveInteger("GENERAL_RATE_WINDOW")
};


// Strict API rate-limit configuration
const strict = {
    limit: getPositiveInteger("STRICT_RATE_LIMIT"),
    window: getPositiveInteger("STRICT_RATE_WINDOW")
};


// Token Bucket rate-limit configuration
const tokenBucket = {
    capacity: getPositiveInteger("TOKEN_BUCKET_CAPACITY"),
    refillRate: getPositiveInteger("TOKEN_BUCKET_REFILL_RATE")
};

const slidingWindow = {
    limit: getPositiveInteger("SLIDING_WINDOW_LIMIT"),
    window: getPositiveInteger("SLIDING_WINDOW_WINDOW")
};
module.exports = {
    general,
    strict,
    tokenBucket,
    slidingWindow
};