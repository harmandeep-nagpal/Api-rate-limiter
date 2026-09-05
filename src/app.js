require("dotenv").config();
const express = require("express");

const createRateLimiter =
    require("./middleware/rateLimiterFactory");

const rateLimitConfig =
    require("./config/rateLimitConfig");

const redisClient =
    require("./config/redis");

const app = express();

app.set("trust proxy", 1);

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

app.get("/health", (req, res) => {
    res.json({
        status: "ok"
    });
});

app.get("/ready", async (req, res) => {
    try {
        if (!redisClient.isReady) {
            return res.status(503).json({
                status: "not ready",
                redis: "disconnected"
            });
        }

        await redisClient.ping();

        res.json({
            status: "ready",
            redis: "connected"
        });

    } catch (error) {
        console.error("Readiness check failed:", error);

        res.status(503).json({
            status: "not ready",
            redis: "unavailable"
        });
    }
});

app.get(
    "/api/test",
    generalLimiter,
    (req, res) => {
        res.json({
            message: "API test route working"
        });
    }
);

app.get(
    "/api/strict",
    strictLimiter,
    (req, res) => {
        res.json({
            message: "Strict API route working"
        });
    }
);
app.get(
    "/api/token-bucket",
    tokenBucketLimiter,
    (req, res) => {
        res.json({
            message: "Token Bucket route working"
        });
    }
);

app.get(
    "/api/sliding-window",
    slidingWindowLimiter,
    (req, res) => {
        res.json({
            message: "Sliding Window route working"
        });
    }
);
module.exports = app;