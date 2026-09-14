require("dotenv").config();

const express = require("express");

const { getMetrics } =
    require("./monitoring/metrics");

const createRateLimiter =
    require("./middleware/rateLimiterFactory");

const rateLimitConfig =
    require("./config/rateLimitConfig");

const redisClient =
    require("./config/redis");

const app = express();


// --------------------------------------------------
// Proxy configuration
//
// If the API is behind a reverse proxy or load
// balancer, Express needs to know how many proxy
// hops it should trust.
//
// Example:
//
// Client
//   ↓
// Reverse Proxy / Load Balancer
//   ↓
// Express
//
// TRUST_PROXY=1 means we trust one proxy hop.
//
// This is important because our rate limiter uses:
//
//     req.ip
//
// Express uses the proxy configuration to determine
// the correct client IP.
// --------------------------------------------------

const trustProxy =
    Number(process.env.TRUST_PROXY || 1);

app.set("trust proxy", trustProxy);


// --------------------------------------------------
// Rate limiter configuration
// --------------------------------------------------

const generalLimiter = createRateLimiter({
    ...rateLimitConfig.general,
    policyName: "general"
});


const strictLimiter = createRateLimiter({
    ...rateLimitConfig.strict,
    policyName: "strict"
});


const tokenBucketLimiter = createRateLimiter({
    ...rateLimitConfig.tokenBucket,
    policyName: "token-bucket"
});


const slidingWindowLimiter = createRateLimiter({
    ...rateLimitConfig.slidingWindow,
    policyName: "sliding-window"
});


// --------------------------------------------------
// Health check
//
// This endpoint only tells us that the application
// process itself is running.
//
// It does NOT depend on Redis.
// --------------------------------------------------

app.get("/health", (req, res) => {

    res.json({
        status: "ok"
    });
});


// --------------------------------------------------
// Readiness check
//
// This endpoint tells us whether the application
// is actually ready to serve traffic.
//
// Since our rate limiter depends on Redis,
// Redis must be available for the application
// to be considered ready.
// --------------------------------------------------

app.get("/ready", async (req, res) => {

    try {

        // First check whether the Redis client
        // considers its connection ready.
        if (!redisClient.isReady) {

            return res.status(503).json({
                status: "not ready",
                redis: "disconnected"
            });
        }


        // Perform an actual Redis health check.
        //
        // This verifies that Redis is responding,
        // rather than relying only on the client's
        // connection state.
        await redisClient.ping();


        // Redis is available.
        res.json({
            status: "ready",
            redis: "connected"
        });


    } catch (error) {

        console.error(
            "Readiness check failed:",
            error
        );


        // 503 = Service Unavailable
        //
        // This tells a load balancer/orchestrator
        // that the application should not receive
        // traffic right now.
        res.status(503).json({
            status: "not ready",
            redis: "unavailable"
        });
    }
});


// --------------------------------------------------
// General rate-limited route
// --------------------------------------------------

app.get(
    "/api/test",
    generalLimiter,
    (req, res) => {

        res.json({
            message: "API test route working"
        });
    }
);


// --------------------------------------------------
// Strict rate-limited route
// --------------------------------------------------

app.get(
    "/api/strict",
    strictLimiter,
    (req, res) => {

        res.json({
            message: "Strict API route working"
        });
    }
);


// --------------------------------------------------
// Token Bucket route
// --------------------------------------------------

app.get(
    "/api/token-bucket",
    tokenBucketLimiter,
    (req, res) => {

        res.json({
            message: "Token Bucket route working"
        });
    }
);


// --------------------------------------------------
// Sliding Window route
// --------------------------------------------------

app.get(
    "/api/sliding-window",
    slidingWindowLimiter,
    (req, res) => {

        res.json({
            message: "Sliding Window route working"
        });
    }
);


// --------------------------------------------------
// Metrics endpoint
//
// Returns the current in-memory rate limiter
// statistics.
// --------------------------------------------------

app.get("/metrics", (req, res) => {

    res.json(
        getMetrics()
    );
});


// --------------------------------------------------
// Export Express application
// --------------------------------------------------

module.exports = app;