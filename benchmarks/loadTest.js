const http = require("http");


// ============================================================
// CONFIGURATION
// ============================================================

// API endpoint we want to benchmark.
const URL = "http://localhost:3000/api/token-bucket";

// Number of requests to send.
const TOTAL_REQUESTS = 100;


// ============================================================
// SEND ONE REQUEST
// ============================================================

function sendRequest() {
    return new Promise((resolve, reject) => {

        // Send an HTTP GET request to our API.
        const request = http.get(URL, (response) => {

            // We don't need the response body for benchmarking.
            response.resume();

            // Resolve with the HTTP status code.
            response.on("end", () => {
                resolve(response.statusCode);
            });
        });


        // Handle connection/network errors.
        request.on("error", (error) => {
            reject(error);
        });
    });
}


// ============================================================
// LOAD TEST
// ============================================================

async function runLoadTest() {

    console.log("========================================");
    console.log("       API RATE LIMITER LOAD TEST");
    console.log("========================================");

    console.log(`Target: ${URL}`);
    console.log(`Requests: ${TOTAL_REQUESTS}`);
    console.log("----------------------------------------");


    // Start the timer.
    const startTime = process.hrtime.bigint();


    /*
     * Create 100 requests immediately.
     *
     * Promise.all() starts them concurrently rather than
     * waiting for one request to finish before sending
     * the next one.
     */
    const requests = Array.from(
        { length: TOTAL_REQUESTS },
        () => sendRequest()
    );


    // Wait until all requests have completed.
    const results = await Promise.all(requests);


    // Stop the timer.
    const endTime = process.hrtime.bigint();


    // Convert nanoseconds to milliseconds.
    const totalTimeMs =
        Number(endTime - startTime) / 1_000_000;


    // ========================================================
    // ANALYZE RESULTS
    // ========================================================

    // Count successful requests.
    const successful =
        results.filter(
            status => status === 200
        ).length;


    // Count rate-limited requests.
    const rejected =
        results.filter(
            status => status === 429
        ).length;


    // Count any unexpected responses.
    const other =
        results.filter(
            status =>
                status !== 200 &&
                status !== 429
        ).length;


    // Calculate requests per second.
    const requestsPerSecond =
        TOTAL_REQUESTS /
        (totalTimeMs / 1000);


    // ========================================================
    // DISPLAY RESULTS
    // ========================================================

    console.log("");
    console.log("============== RESULTS ================");
    console.log(`Total requests:     ${TOTAL_REQUESTS}`);
    console.log(`Successful (200):   ${successful}`);
    console.log(`Rate limited (429): ${rejected}`);
    console.log(`Other responses:    ${other}`);
    console.log(`Total time:         ${totalTimeMs.toFixed(2)} ms`);
    console.log(
        `Throughput:         ${requestsPerSecond.toFixed(2)} req/sec`
    );
    console.log("========================================");
}


// ============================================================
// START BENCHMARK
// ============================================================

runLoadTest().catch((error) => {

    console.error(
        "Load test failed:",
        error.message
    );

    process.exit(1);
});