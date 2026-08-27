const express = require("express");
const fixedWindowRateLimiter = require("./middleware/rateLimiter");
const app = express();

app.get(
    "/health",
    fixedWindowRateLimiter(5, 60), // 5 req in 60 sec.
    (req, res) => {
        res.json({
            status: "ok"
        });
    }
);

module.exports = app;