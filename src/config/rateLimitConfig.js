// ============================================================
// RATE LIMIT CONFIGURATION
// ============================================================
//
// This file is responsible for reading and validating all
// rate-limiter configuration from environment variables.
//
// The application should NEVER start with invalid rate-limit
// configuration.
// ============================================================


// ------------------------------------------------------------
// Read and validate a positive integer
// ------------------------------------------------------------

function getPositiveInteger(name) {

    const value = Number(process.env[name]);

    // Reject:
    // - undefined
    // - empty values
    // - NaN
    // - decimals
    // - zero
    // - negative numbers
    if (
        process.env[name] === undefined ||
        process.env[name].trim() === "" ||
        !Number.isInteger(value) ||
        value <= 0
    ) {
        throw new Error(
            `Invalid configuration: ${name} ` +
            `must be a positive integer`
        );
    }

    return value;
}


// ------------------------------------------------------------
// General API rate-limit configuration
// ------------------------------------------------------------

const general = {
    algorithm: "fixed-window",

    limit:
        getPositiveInteger("GENERAL_RATE_LIMIT"),

    window:
        getPositiveInteger("GENERAL_RATE_WINDOW")
};


// ------------------------------------------------------------
// Strict API rate-limit configuration
// ------------------------------------------------------------

const strict = {
    algorithm: "fixed-window",

    limit:
        getPositiveInteger("STRICT_RATE_LIMIT"),

    window:
        getPositiveInteger("STRICT_RATE_WINDOW")
};


// ------------------------------------------------------------
// Token Bucket configuration
// ------------------------------------------------------------

const tokenBucket = {
    algorithm: "token-bucket",

    capacity:
        getPositiveInteger("TOKEN_BUCKET_CAPACITY"),

    refillRate:
        getPositiveInteger("TOKEN_BUCKET_REFILL_RATE")
};


// ------------------------------------------------------------
// Sliding Window configuration
// ------------------------------------------------------------

const slidingWindow = {
    algorithm: "sliding-window",

    limit:
        getPositiveInteger("SLIDING_WINDOW_LIMIT"),

    window:
        getPositiveInteger("SLIDING_WINDOW_WINDOW")
};


// ------------------------------------------------------------
// Export configurations
// ------------------------------------------------------------

module.exports = {
    general,
    strict,
    tokenBucket,
    slidingWindow
};