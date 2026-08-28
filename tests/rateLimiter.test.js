const request = require("supertest");
const app = require("../src/app");
const redisClient = require("../src/config/redis");

describe("Rate Limiter", () => {

    beforeAll(async () => {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    });

    afterAll(async () => {
        if (redisClient.isOpen) {
            await redisClient.quit();
        }
    });

    test("allows requests under the limit", async () => {
        const response = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", "10.0.0.1");

        expect(response.statusCode).toBe(200);
        expect(response.headers["x-ratelimit-limit"]).toBe("10");
    });

    test("blocks requests after the limit is exceeded", async () => {
        let response;

        for (let i = 0; i < 11; i++) {
            response = await request(app)
                .get("/api/test")
                .set("X-Forwarded-For", "10.0.0.2");
        }

        expect(response.statusCode).toBe(429);
        expect(response.body.error).toBe("Too many requests");
        expect(response.body.retryAfter).toBeDefined();
    });
    test("keeps different rate limit policies independent", async () => {
    let response;

    // General policy: 10 requests allowed
    for (let i = 0; i < 10; i++) {
        response = await request(app)
            .get("/api/test")
            .set("X-Forwarded-For", "10.0.0.3");
    }

    expect(response.statusCode).toBe(200);

    // Strict policy has its own counter
    response = await request(app)
        .get("/api/strict")
        .set("X-Forwarded-For", "10.0.0.3");

    expect(response.statusCode).toBe(200);
});
});