const request = require("supertest");
const app = require("../src/app");
const redisClient = require("../src/config/redis");
const fixedWindowRateLimiter = require("../src/middleware/rateLimiter");
const express = require("express");

// --------------------------------------------------
// Create a separate Express app for testing
// the fixed-window expiration behavior.
//
// We use a very short window here so that our
// automated tests don't have to wait 60 seconds.
// --------------------------------------------------

const testApp = express();

// Test configuration:
// 2 requests allowed every 1 second
const shortWindowLimiter = fixedWindowRateLimiter(
    2,
    1,
    "test-window"
);

// Create a test route using the short-window limiter
testApp.get(
    "/test-window",
    shortWindowLimiter,
    (req, res) => {
        res.json({
            message: "Request allowed"
        });
    }
);


// --------------------------------------------------
// Rate Limiter Test Suite
// --------------------------------------------------

describe("Rate Limiter", () => {

    // --------------------------------------------------
    // Connect to Redis before all tests start
    // --------------------------------------------------

    beforeAll(async () => {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    });


    // --------------------------------------------------
    // Clean all rate-limit keys before EVERY test.
    //
    // This prevents one test from affecting another.
    // --------------------------------------------------

    beforeEach(async () => {
        const keys = await redisClient.keys("rate_limit:*");

        if (keys.length > 0) {
            await redisClient.del(keys);
        }
    });


    // --------------------------------------------------
    // Close the Redis connection after all tests finish.
    // --------------------------------------------------

    afterAll(async () => {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    });


    // --------------------------------------------------
    // TEST 1
    //
    // Verify that the remaining-request counter
    // decreases correctly.
    //
    // Limit = 10 requests
    //
    // Request 1  → Remaining 9
    // Request 2  → Remaining 8
    // ...
    // Request 10 → Remaining 0
    // Request 11 → 429
    // --------------------------------------------------

    test("tracks remaining requests correctly", async () => {

        for (let i = 1; i <= 10; i++) {

            const response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.1");

            // Requests within the limit should succeed
            expect(response.statusCode).toBe(200);

            // Maximum limit should be 10
            expect(response.headers["x-ratelimit-limit"])
                .toBe("10");

            // Remaining requests should decrease
            expect(response.headers["x-ratelimit-remaining"])
                .toBe(String(10 - i));
        }


        // The 11th request exceeds the limit
        const blockedResponse = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", "10.0.0.1");

        // Request should be rejected
        expect(blockedResponse.statusCode).toBe(429);

        // Remaining should never become negative
        expect(blockedResponse.headers["x-ratelimit-remaining"])
            .toBe("0");
    });


    // --------------------------------------------------
    // TEST 2
    //
    // Verify that requests are blocked after
    // the configured limit is exceeded.
    // --------------------------------------------------

    test("blocks requests after the limit is exceeded", async () => {

        let response;

        // Send 11 requests.
        // The first 10 should be allowed.
        // The 11th should be blocked.
        for (let i = 0; i < 11; i++) {

            response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.2");
        }


        // The final request should receive HTTP 429
        expect(response.statusCode).toBe(429);

        // Verify our error message
        expect(response.body.error)
            .toBe("Too many requests");

        // Verify that Retry-After exists
        expect(response.body.retryAfter)
            .toBeDefined();
    });


    // --------------------------------------------------
    // TEST 3
    //
    // Verify that different rate-limit policies
    // maintain separate Redis counters.
    //
    // /api/test
    //     → general policy
    //     → limit = 10
    //
    // /api/strict
    //     → strict policy
    //     → limit = 3
    //
    // Both use the same IP, but their counters
    // should remain independent.
    // --------------------------------------------------

    test("keeps different rate limit policies independent", async () => {

        let response;


        // ----------------------------------------------
        // General policy
        // ----------------------------------------------

        // Send 10 requests to the general endpoint.
        for (let i = 0; i < 10; i++) {

            response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.3");
        }

        // 10th request should still be allowed
        expect(response.statusCode).toBe(200);


        // ----------------------------------------------
        // Strict policy
        // ----------------------------------------------

        // The strict policy has its own Redis key,
        // so it should NOT be affected by the
        // 10 requests sent to the general policy.

        response = await request(app)
            .get("/api/strict")
            .set("X-Forwarded-For", "10.0.0.3");

        // First strict request should succeed
        expect(response.statusCode).toBe(200);
    });


    // --------------------------------------------------
    // TEST 4
    //
    // Verify that the rate limit resets after the
    // fixed window expires.
    //
    // For this test we use:
    //
    // Limit  = 2 requests
    // Window = 1 second
    //
    // Expected:
    //
    // Request 1 → 200
    // Request 2 → 200
    // Request 3 → 429
    //
    // Wait for window to expire
    //
    // Request 4 → 200
    // --------------------------------------------------

    test("resets the limit after the window expires", async () => {

        const ip = "10.0.0.4";


        // ----------------------------------------------
        // First two requests should be allowed
        // ----------------------------------------------

        for (let i = 0; i < 2; i++) {

            const response = await request(testApp)
                .get("/test-window")
                .set("X-Forwarded-For", ip);

            expect(response.statusCode).toBe(200);
        }


        // ----------------------------------------------
        // Third request should be blocked
        // ----------------------------------------------

        let response = await request(testApp)
            .get("/test-window")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(429);


        // ----------------------------------------------
        // Wait for the 1-second fixed window to expire
        //
        // We wait 1.2 seconds instead of exactly 1 second
        // to give Redis enough time to expire the key.
        // ----------------------------------------------

        await new Promise(resolve => setTimeout(resolve, 1200));


        // ----------------------------------------------
        // The window has expired.
        //
        // Redis should have removed the old counter,
        // so this request belongs to a fresh window.
        // ----------------------------------------------

        response = await request(testApp)
            .get("/test-window")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(200);
    });

});