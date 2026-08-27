require("dotenv").config();

const app = require("./app");
const redisClient = require("./config/redis");

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await redisClient.connect();

        console.log("Connected to Redis");

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

startServer();