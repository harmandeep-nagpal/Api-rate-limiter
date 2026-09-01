require("dotenv").config();

const app = require("./app");
const redisClient = require("./config/redis");

const PORT = process.env.PORT || 3000;

let server;

async function startServer() {
    try {
        await redisClient.connect();

        console.log("Connected to Redis");

        server = app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}


// --------------------------------------------------
// Graceful shutdown
//
// Docker sends SIGTERM when stopping the container.
// We close the HTTP server first and then Redis.
// --------------------------------------------------

async function shutdown(signal) {

    console.log(`${signal} received. Starting graceful shutdown...`);

    if (server) {
        server.close(() => {
            console.log("HTTP server closed");
        });
    }

    if (redisClient.isOpen) {
        await redisClient.quit();
        console.log("Redis connection closed");
    }

    process.exit(0);
}


// Handle Docker / operating-system shutdown signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));


startServer();