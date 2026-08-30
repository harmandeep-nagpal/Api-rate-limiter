# Use Node.js 22 with a lightweight Alpine Linux base image
FROM node:22-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first
# This allows Docker to cache npm install when source code changes
COPY package*.json ./

# Install production dependencies
RUN npm ci

# Copy the application source code
COPY src ./src

# The API listens on port 3000
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]