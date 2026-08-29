require("dotenv").config();
const express = require("express");

const fixedWindowRateLimiter = require("./middleware/rateLimiter");
const rateLimitConfig = require("./config/rateLimitConfig");

const app = express();

app.set("trust proxy", 1);

const generalLimiter = fixedWindowRateLimiter(
    rateLimitConfig.general.limit,
    rateLimitConfig.general.window,
    "general"
);

const strictLimiter = fixedWindowRateLimiter(
    rateLimitConfig.strict.limit,
    rateLimitConfig.strict.window,
    "strict"
);

app.get("/health", (req, res) => {
    res.json({
        status: "ok"
    });
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

module.exports = app;