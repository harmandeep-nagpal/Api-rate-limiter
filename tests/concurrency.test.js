const request = require("supertest");

const express = require("express");

const redisClient = require("../src/config/redis");

const tokenBucketRateLimiter =
    require("../src/middleware/tokenBucketLimiter");


// Create a separate test application
// so concurrency tests don't interfere
// with the main application's limits.
const app = express();


// Token Bucket:
// capacity = 10
// refill rate = 1 token/second
app.get(
    "/test",
    tokenBucketRateLimiter(
        10,
        1,
        "concurrency-test"
    ),
    (req, res) => {
        res.status(200).json({
            message: "allowed"
        });
    }
);


describe("Rate Limiter Concurrency", () => {

    // Connect to Redis before tests.
    beforeAll(async () => {

        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    });


    // Remove test data after every test.
    beforeEach(async () => {

        await redisClient.del(
            "rate_limit:concurrency-test:ip:::ffff:127.0.0.1"
        );
    });


    // Close Redis connection after tests.
    afterAll(async () => {

        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    });


    test(
        "allows only capacity number of concurrent requests",
        async () => {

            // Send 20 requests at almost exactly
            // the same time.
            const requests = Array.from(
                { length: 20 },
                () => request(app).get("/test")
            );


            // Wait for all requests to finish.
            const responses =
                await Promise.all(requests);


            // Count successful requests.
            const successful =
                responses.filter(
                    response =>
                        response.status === 200
                );


            // Count rejected requests.
            const rejected =
                responses.filter(
                    response =>
                        response.status === 429
                );


            console.log(
                `Successful requests: ${successful.length}`
            );

            console.log(
                `Rejected requests: ${rejected.length}`
            );


            // Capacity is 10.
            //
            // Therefore, from 20 simultaneous requests,
            // exactly 10 should initially succeed.
            expect(successful.length).toBe(10);

            expect(rejected.length).toBe(10);
        }
    );
});