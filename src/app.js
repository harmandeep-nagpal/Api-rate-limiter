const express = require("express");

const fixedWindowRateLimiter = require("./middleware/rateLimiter");

const app = express();

app.set("trust proxy", 1);

const generalLimiter = fixedWindowRateLimiter(10, 60, "general");
const strictLimiter = fixedWindowRateLimiter(3, 60, "strict");

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