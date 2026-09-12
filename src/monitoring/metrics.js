// ============================================================
// RATE LIMITER METRICS
// ============================================================
//
// This module keeps simple in-memory counters for observing
// how the rate limiter is behaving.
//
// These metrics are intended for development/demo purposes.
// In a production distributed system, metrics would normally
// be stored/exported using a monitoring system such as
// Prometheus, OpenTelemetry, etc.
// ============================================================


// Total requests that were allowed.
let allowedRequests = 0;


// Total requests that were rejected with HTTP 429.
let rejectedRequests = 0;


// Track allowed requests by policy.
const allowedByPolicy = {};


// Track rejected requests by policy.
const rejectedByPolicy = {};


// Record an allowed request.
function recordAllowed(policyName) {

    // Increase global counter.
    allowedRequests++;


    // Create the policy counter if it doesn't exist.
    if (!allowedByPolicy[policyName]) {
        allowedByPolicy[policyName] = 0;
    }


    // Increase policy-specific counter.
    allowedByPolicy[policyName]++;
}


// Record a rejected request.
function recordRejected(policyName) {

    // Increase global counter.
    rejectedRequests++;


    // Create the policy counter if it doesn't exist.
    if (!rejectedByPolicy[policyName]) {
        rejectedByPolicy[policyName] = 0;
    }


    // Increase policy-specific counter.
    rejectedByPolicy[policyName]++;
}


// Return the current metrics.
function getMetrics() {

    return {
        allowedRequests,
        rejectedRequests,

        totalRequests:
            allowedRequests + rejectedRequests,

        allowedByPolicy: {
            ...allowedByPolicy
        },

        rejectedByPolicy: {
            ...rejectedByPolicy
        }
    };
}


// Reset metrics.
//
// This is mainly useful for tests.
function resetMetrics() {

    allowedRequests = 0;
    rejectedRequests = 0;

    // Remove all policy-specific counters.
    Object.keys(allowedByPolicy).forEach(
        key => delete allowedByPolicy[key]
    );

    Object.keys(rejectedByPolicy).forEach(
        key => delete rejectedByPolicy[key]
    );
}


// Export the metrics API.
module.exports = {
    recordAllowed,
    recordRejected,
    getMetrics,
    resetMetrics
};