function setRateLimitHeaders(
    res,
    limit,
    remaining,
    reset
) {
    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader(
        "X-RateLimit-Remaining",
        Math.max(0, remaining)
    );
    res.setHeader("X-RateLimit-Reset", reset);
}

function sendRateLimitExceeded(
    res,
    retryAfter
) {
    res.setHeader(
        "Retry-After",
        Math.max(1, retryAfter)
    );

    return res.status(429).json({
        error: "Too many requests",
        message: "Rate limit exceeded. Try again later.",
        retryAfter: Math.max(1, retryAfter)
    });
}

module.exports = {
    setRateLimitHeaders,
    sendRateLimitExceeded
};