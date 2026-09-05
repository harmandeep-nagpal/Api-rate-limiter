const request = require("supertest");
const app = require("../src/app");
const redisClient = require("../src/config/redis");
const fixedWindowRateLimiter = require("../src/middleware/rateLimiter");
const tokenBucketRateLimiter = require("../src/middleware/tokenBucketLimiter");
const slidingWindowRateLimiter = require("../src/middleware/slidingWindowLimiter");
const createRateLimiter = require("../src/middleware/rateLimiterFactory");
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
// Create a separate Express app for testing
// Token Bucket behavior.
//
// Configuration:
// 2 tokens maximum
// 1 token regenerated per second
// --------------------------------------------------

const tokenBucketTestApp = express();

const testTokenBucketLimiter = tokenBucketRateLimiter(
    2,
    1,
    "test-token-bucket"
);

tokenBucketTestApp.get(
    "/test-token-bucket",
    testTokenBucketLimiter,
    (req, res) => {
        res.json({
            message: "Token Bucket request allowed"
        });
    }
);

// --------------------------------------------------
// Create a separate Express app for testing
// Sliding Window behavior.
//
// Configuration:
// 5 requests allowed every 60 seconds
// --------------------------------------------------

const slidingWindowTestApp = express();

const slidingWindowLimiter = slidingWindowRateLimiter(
    5,
    60,
    "test-sliding-window"
);

slidingWindowTestApp.get(
    "/test",
    slidingWindowLimiter,
    (req, res) => {
        res.json({
            message: "Sliding Window test working"
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
    // --------------------------------------------------

    test("tracks remaining requests correctly", async () => {

        for (let i = 1; i <= 10; i++) {

            const response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.1");

            expect(response.statusCode).toBe(200);

            expect(response.headers["x-ratelimit-limit"])
                .toBe("10");

            expect(response.headers["x-ratelimit-remaining"])
                .toBe(String(10 - i));
        }

        const blockedResponse = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", "10.0.0.1");

        expect(blockedResponse.statusCode).toBe(429);

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

        for (let i = 0; i < 11; i++) {

            response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.2");
        }

        expect(response.statusCode).toBe(429);

        expect(response.body.error)
            .toBe("Too many requests");

        expect(response.body.retryAfter)
            .toBeDefined();
    });

    // --------------------------------------------------
    // TEST 3
    //
    // Verify that different rate-limit policies
    // maintain separate Redis counters.
    // --------------------------------------------------

    test("keeps different rate limit policies independent", async () => {

        let response;

        for (let i = 0; i < 10; i++) {

            response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.3");
        }

        expect(response.statusCode).toBe(200);

        response = await request(app)
            .get("/api/strict")
            .set("X-Forwarded-For", "10.0.0.3");

        expect(response.statusCode).toBe(200);
    });

    // --------------------------------------------------
    // TEST 4
    //
    // Verify that the rate limit resets after the
    // fixed window expires.
    // --------------------------------------------------

    test("resets the limit after the window expires", async () => {

        const ip = "10.0.0.4";

        for (let i = 0; i < 2; i++) {

            const response = await request(testApp)
                .get("/test-window")
                .set("X-Forwarded-For", ip);

            expect(response.statusCode).toBe(200);
        }

        let response = await request(testApp)
            .get("/test-window")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(429);

        await new Promise(resolve =>
            setTimeout(resolve, 1200)
        );

        response = await request(testApp)
            .get("/test-window")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(200);
    });

    // --------------------------------------------------
    // TEST 5
    //
    // Verify that rate-limit headers are correctly
    // returned when a request is allowed and when
    // the limit is exceeded.
    // --------------------------------------------------

    test("returns correct rate limit headers", async () => {

        const ip = "10.0.0.5";

        const response = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(200);

        expect(response.headers["x-ratelimit-limit"])
            .toBe("10");

        expect(response.headers["x-ratelimit-remaining"])
            .toBe("9");

        expect(response.headers["x-ratelimit-reset"])
            .toBeDefined();

        for (let i = 0; i < 9; i++) {
            await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", ip);
        }

        const blockedResponse = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", ip);

        expect(blockedResponse.statusCode)
            .toBe(429);

        expect(blockedResponse.headers["x-ratelimit-remaining"])
            .toBe("0");

        expect(blockedResponse.headers["retry-after"])
            .toBeDefined();

        expect(Number(blockedResponse.headers["retry-after"]))
            .toBeGreaterThan(0);
    });

    // --------------------------------------------------
    // TEST 6
    //
    // Verify that different IP addresses have
    // independent rate-limit counters.
    // --------------------------------------------------

    test("keeps different IP addresses independent", async () => {

        for (let i = 0; i < 10; i++) {

            const response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.10");

            expect(response.statusCode).toBe(200);
        }

        const userABlocked = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", "10.0.0.10");

        expect(userABlocked.statusCode).toBe(429);

        const userBResponse = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", "10.0.0.11");

        expect(userBResponse.statusCode).toBe(200);

        expect(userBResponse.headers["x-ratelimit-remaining"])
            .toBe("9");
    });

    // --------------------------------------------------
    // TEST 7
    //
    // Verify that the API health endpoint responds
    // successfully when the application is running.
    // --------------------------------------------------

    test("health endpoint returns OK", async () => {

        const response = await request(app)
            .get("/health");

        expect(response.statusCode)
            .toBe(200);

        expect(response.body)
            .toEqual({
                status: "ok"
            });
    });

    // --------------------------------------------------
    // TEST 8
    //
    // Verify that the readiness endpoint confirms
    // that Redis is connected and available.
    // --------------------------------------------------

    test("readiness endpoint confirms Redis connection", async () => {

        const response = await request(app)
            .get("/ready");

        expect(response.statusCode)
            .toBe(200);

        expect(response.body)
            .toEqual({
                status: "ready",
                redis: "connected"
            });
    });

    // --------------------------------------------------
    // TEST 9
    //
    // Token Bucket allows requests when tokens exist.
    // --------------------------------------------------

    test("Token Bucket allows requests when tokens are available", async () => {

        const response1 = await request(tokenBucketTestApp)
            .get("/test-token-bucket")
            .set("X-Forwarded-For", "10.0.0.20");

        expect(response1.statusCode).toBe(200);

        const response2 = await request(tokenBucketTestApp)
            .get("/test-token-bucket")
            .set("X-Forwarded-For", "10.0.0.20");

        expect(response2.statusCode).toBe(200);
    });

    // --------------------------------------------------
    // TEST 10
    //
    // Token Bucket blocks when bucket is empty.
    // --------------------------------------------------

    test("Token Bucket blocks requests when bucket is empty", async () => {

        const ip = "10.0.0.21";

        let response = await request(tokenBucketTestApp)
            .get("/test-token-bucket")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(200);

        response = await request(tokenBucketTestApp)
            .get("/test-token-bucket")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(200);

        response = await request(tokenBucketTestApp)
            .get("/test-token-bucket")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(429);

        expect(response.body.error)
            .toBe("Too many requests");

        expect(response.body.retryAfter)
            .toBeDefined();
    });

    // --------------------------------------------------
    // TEST 11
    //
    // Token Bucket returns correct rate-limit headers.
    // --------------------------------------------------

    test("Token Bucket returns correct rate limit headers", async () => {

        const ip = "10.0.0.22";

        const response = await request(tokenBucketTestApp)
            .get("/test-token-bucket")
            .set("X-Forwarded-For", ip);

        expect(response.statusCode).toBe(200);

        expect(response.headers["x-ratelimit-limit"])
            .toBe("2");

        expect(response.headers["x-ratelimit-remaining"])
            .toBe("1");
    });

    // --------------------------------------------------
    // TEST 12
    //
    // Token Bucket refills tokens over time.
    // --------------------------------------------------

    test("Token Bucket refills tokens over time", async () => {

        const ip = "10.0.0.23";

        const realDateNow = Date.now;

        try {

            Date.now = () => 1000000;

            let response = await request(tokenBucketTestApp)
                .get("/test-token-bucket")
                .set("X-Forwarded-For", ip);

            expect(response.statusCode).toBe(200);

            response = await request(tokenBucketTestApp)
                .get("/test-token-bucket")
                .set("X-Forwarded-For", ip);

            expect(response.statusCode).toBe(200);

            response = await request(tokenBucketTestApp)
                .get("/test-token-bucket")
                .set("X-Forwarded-For", ip);

            expect(response.statusCode).toBe(429);

            Date.now = () => 1001000;

            response = await request(tokenBucketTestApp)
                .get("/test-token-bucket")
                .set("X-Forwarded-For", ip);

            expect(response.statusCode).toBe(200);

        } finally {

            Date.now = realDateNow;
        }
    });

    // --------------------------------------------------
    // Sliding Window tests
    // --------------------------------------------------

    describe("Sliding Window", () => {

        test("allows requests while under the limit", async () => {

            for (let i = 0; i < 5; i++) {

                const response = await request(
                    slidingWindowTestApp
                ).get("/test");

                expect(response.status).toBe(200);
            }
        });

        test("blocks requests when the window is full", async () => {

            for (let i = 0; i < 5; i++) {

                await request(
                    slidingWindowTestApp
                ).get("/test");
            }

            const response = await request(
                slidingWindowTestApp
            ).get("/test");

            expect(response.status).toBe(429);

            expect(response.body.error).toBe(
                "Too many requests"
            );
        });

        test("returns correct rate limit headers", async () => {

            const response = await request(
                slidingWindowTestApp
            ).get("/test");

            expect(response.status).toBe(200);

            expect(
                response.headers["x-ratelimit-limit"]
            ).toBe("5");

            expect(
                response.headers["x-ratelimit-remaining"]
            ).toBe("4");
        });

        test("removes requests after the sliding window expires", async () => {

            const originalDateNow = Date.now;

            try {

                let currentTime = 1000000000000;

                jest.spyOn(Date, "now")
                    .mockImplementation(() => currentTime);

                for (let i = 0; i < 5; i++) {

                    const response = await request(
                        slidingWindowTestApp
                    ).get("/test");

                    expect(response.status).toBe(200);
                }

                let response = await request(
                    slidingWindowTestApp
                ).get("/test");

                expect(response.status).toBe(429);

                currentTime += 61000;

                response = await request(
                    slidingWindowTestApp
                ).get("/test");

                expect(response.status).toBe(200);

            } finally {

                Date.now = originalDateNow;
            }
        });

    });

});

// ==================================================
// RATE LIMITER FACTORY TESTS
// ==================================================

describe("Rate Limiter Factory", () => {

    // --------------------------------------------------
    // TEST 13
    //
    // Verify that the factory creates a
    // Fixed Window middleware.
    // --------------------------------------------------

    test("creates a Fixed Window limiter", () => {

        const limiter = createRateLimiter({
            algorithm: "fixed-window",
            limit: 5,
            window: 60,
            policyName: "test"
        });

        expect(typeof limiter).toBe("function");
    });

    // --------------------------------------------------
    // TEST 14
    //
    // Verify that the factory creates a
    // Token Bucket middleware.
    // --------------------------------------------------

    test("creates a Token Bucket limiter", () => {

        const limiter = createRateLimiter({
            algorithm: "token-bucket",
            capacity: 5,
            refillRate: 2,
            policyName: "test"
        });

        expect(typeof limiter).toBe("function");
    });

    // --------------------------------------------------
    // TEST 15
    //
    // Verify that the factory creates a
    // Sliding Window middleware.
    // --------------------------------------------------

    test("creates a Sliding Window limiter", () => {

        const limiter = createRateLimiter({
            algorithm: "sliding-window",
            limit: 5,
            window: 60,
            policyName: "test"
        });

        expect(typeof limiter).toBe("function");
    });

    // --------------------------------------------------
    // TEST 16
    //
    // Verify that the factory rejects an
    // unsupported algorithm.
    // --------------------------------------------------

    test("rejects an unsupported algorithm", () => {

        expect(() => {
            createRateLimiter({
                algorithm: "invalid-algorithm",
                policyName: "test"
            });
        }).toThrow(
            "Unsupported rate limiting algorithm: invalid-algorithm"
        );
    });

});