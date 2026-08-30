# 🚦 API Rate Limiter

A production-oriented **API rate limiting service** built with **Node.js**, **Express**, **Redis**, and **Lua**. It implements the **fixed-window algorithm** for distributed request counting, using an atomic Lua script to update counters and expirations safely under concurrent load. The entire stack is containerized with **Docker Compose** for one-command startup.

[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-Framework-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Redis](https://img.shields.io/badge/Redis-Datastore-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Jest](https://img.shields.io/badge/Tested_with-Jest-C21325?logo=jest&logoColor=white)](https://jestjs.io/)

---

## Table of Contents

- [Features](#-features)
- [Architecture](#️-architecture)
- [How Rate Limiting Works](#-how-rate-limiting-works)
- [Redis Key Structure](#-redis-key-structure)
- [Atomic Rate Limiting with Lua](#-atomic-rate-limiting-with-lua)
- [Rate-Limit Policies](#-rate-limit-policies)
- [API Endpoints](#-api-endpoints)
- [Rate-Limit Headers](#-rate-limit-headers)
- [Rate Limit Exceeded](#-rate-limit-exceeded)
- [Docker Setup](#-docker-setup)
- [Running the Project](#-running-the-project-with-docker)
- [Testing the API](#-testing-the-api)
- [Automated Testing](#-automated-testing)
- [Project Structure](#-project-structure)
- [Configuration](#️-configuration)
- [Error Handling](#️-error-handling)
- [Technologies Used](#-technologies-used)
- [Future Improvements](#-future-improvements)
- [Learning Objectives](#-learning-objectives)
- [Author](#-author)

---

## ✨ Features

- 🚦 Fixed-window API rate limiting
- ⚡ Redis-backed request counters
- 🔐 Atomic Redis operations using Lua scripts
- 🌐 IP-based client identification
- 🎯 Multiple configurable rate-limit policies
- 📊 Standard rate-limit response headers
- ⏱️ `Retry-After` support for blocked requests
- 🔄 Automatic rate-limit window expiration
- 🧪 Automated tests using Jest and Supertest
- 🐳 Fully dockerized API and Redis
- ⚙️ Environment-based configuration
- 🛡️ Fail-open behavior on Redis errors

---

## 🏗️ Architecture

```text
                        ┌──────────────────────┐
                        │        Client        │
                        │ Browser / API Client  │
                        └──────────┬───────────┘
                                   │
                                   │ HTTP Request
                                   ▼
                        ┌──────────────────────┐
                        │    Express API       │
                        │      Node.js         │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │   Rate Limit         │
                        │   Middleware         │
                        └──────────┬───────────┘
                                   │
                                   │ Lua Script
                                   ▼
                        ┌──────────────────────┐
                        │        Redis         │
                        │                      │
                        │  INCR + EXPIRE       │
                        │  Atomic Operation    │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │   Allow / Reject     │
                        │                      │
                        │   200 OK / 429       │
                        └──────────────────────┘
```

---

## 🧠 How Rate Limiting Works

This project uses the **fixed-window** rate limiting algorithm.

Example: `Limit = 10 requests`, `Window = 60 seconds`

A client can make up to 10 requests during the current 60-second window.

| Request | Response | Remaining |
|---------|----------|-----------|
| 1       | 200 OK   | 9         |
| 2       | 200 OK   | 8         |
| 3       | 200 OK   | 7         |
| ...     | ...      | ...       |
| 10      | 200 OK   | 0         |
| 11      | 429      | Too Many Requests |

When the window expires, Redis automatically removes the counter and a new window begins.

---

## 🔑 Redis Key Structure

Each rate-limit counter is stored using a key composed of:

- Rate-limit policy
- Client IP address
- Current window ID

**Structure:**
```text
rate_limit:<policy>:ip:<ip>:<windowId>
```

**Example:**
```text
rate_limit:general:ip:10.0.0.1:29384723
```

This allows different users and different rate-limit policies to maintain fully independent counters.

---

## ⚡ Atomic Rate Limiting with Lua

The rate limiter uses a Redis Lua script to perform the counter update and expiration logic **atomically**.

The script:

```text
INCR
  ↓
Check if this is the first request
  ↓
EXPIRE if necessary
  ↓
Return current request count
```

Conceptually:

```lua
local currentCount = redis.call("INCR", KEYS[1])

if currentCount == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end

return currentCount
```

### Why Lua?

Without atomic execution, `INCR` and `EXPIRE` would run as two separate operations. If a failure occurred between them, a counter could be created without ever receiving an expiration — leaking keys and breaking the rate-limit window. Executing both commands inside a single Lua script guarantees they run as one atomic unit on the Redis server.

---

## 🎯 Rate-Limit Policies

The application currently supports two policies, each independently configurable via environment variables.

| Policy  | Limit         | Window        |
|---------|---------------|---------------|
| General | Configurable  | Configurable  |
| Strict  | Configurable  | Configurable  |

**Example:**
```env
GENERAL_RATE_LIMIT=10
GENERAL_RATE_WINDOW=60

STRICT_RATE_LIMIT=3
STRICT_RATE_WINDOW=60
```

This allows different API routes to carry different levels of protection.

---

## 🌐 API Endpoints

### Health Check
```http
GET /health
```
**Response**
```json
{
  "status": "ok"
}
```

### General API
```http
GET /api/test
```
Protected by the general rate limiter.

**Successful response**
```json
{
  "message": "API test route working"
}
```

### Strict API
```http
GET /api/strict
```
Protected by the strict rate limiter.

**Successful response**
```json
{
  "message": "Strict API route working"
}
```

---

## 📊 Rate-Limit Headers

Every request that passes through the rate limiter receives the following headers:

| Header                  | Description                                              | Example                     |
|--------------------------|-----------------------------------------------------------|------------------------------|
| `X-RateLimit-Limit`      | Maximum number of requests allowed in the current window | `X-RateLimit-Limit: 10`     |
| `X-RateLimit-Remaining`  | Number of requests remaining in the current window       | `X-RateLimit-Remaining: 7`  |
| `X-RateLimit-Reset`      | Unix timestamp when the current window resets            | `X-RateLimit-Reset: 1788115860` |
| `Retry-After`            | Seconds to wait before retrying (only on 429 responses)  | `Retry-After: 48`           |

---

## 🚫 Rate Limit Exceeded

When a client exceeds the configured limit, the API responds with:

```http
HTTP/1.1 429 Too Many Requests
```

```json
{
  "error": "Too many requests",
  "retryAfter": 48
}
```

The response also includes:
```text
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1788115860
Retry-After: 48
```

---

## 🐳 Docker Setup

The project uses Docker Compose to run both the API and Redis:

```text
Docker Compose
│
├── API Container
│   ├── Node.js
│   └── Express.js
│
└── Redis Container
    └── Redis 7
```

The API communicates with Redis using the Docker Compose service name:

```text
redis://redis:6379
```

This allows both containers to communicate over the internal Docker network.

---

## 🚀 Running the Project with Docker

### Prerequisites

Make sure you have installed:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Git](https://git-scm.com/)

### 1. Clone the repository

```bash
git clone https://github.com/harmandeep-nagpal/Api-rate-limiter.git
cd Api-rate-limiter
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=3000

REDIS_URL=redis://redis:6379

GENERAL_RATE_LIMIT=10
GENERAL_RATE_WINDOW=60

STRICT_RATE_LIMIT=3
STRICT_RATE_WINDOW=60
```

> ⚠️ Do not commit your `.env` file to GitHub — it is already excluded via `.gitignore`.

### 3. Start the application

```bash
docker compose up --build
```

Docker Compose will start both the **API** and **Redis** containers. The API will be available at:

```text
http://localhost:3000
```

---

## 🧪 Testing the API

### Health Check

```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "ok"
}
```

### Test the Rate Limiter

```bash
curl -i http://localhost:3000/api/test
```

**Example response:**
```http
HTTP/1.1 200 OK

X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1788115860
```

### Trigger a Rate Limit

After exceeding the configured request limit:

```http
HTTP/1.1 429 Too Many Requests
```

```json
{
  "error": "Too many requests",
  "retryAfter": 48
}
```

---

## 🧪 Automated Testing

The project uses **Jest** for testing and **Supertest** for HTTP endpoint testing.

Run the test suite with:

```bash
npm test
```

The current test suite verifies:

- ✅ Remaining request count
- ✅ Requests being blocked after the limit
- ✅ Independent rate-limit policies
- ✅ Rate-limit window expiration
- ✅ Rate-limit response headers
- ✅ Independent IP-based counters

**Current test status:**
```text
Test Suites: 1 passed
Tests:       6 passed
```

---

## 📁 Project Structure

```text
Api-rate-limiter/
│
├── src/
│   ├── config/
│   │   ├── rateLimitConfig.js
│   │   └── redis.js
│   │
│   ├── middleware/
│   │   └── rateLimiter.js
│   │
│   ├── app.js
│   └── server.js
│
├── tests/
│   └── rateLimiter.test.js
│
├── Dockerfile
├── docker-compose.yml
├── .env
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

---

## ⚙️ Configuration

The application is configured entirely through environment variables:

| Variable              | Description                              |
|------------------------|-------------------------------------------|
| `PORT`                 | Port on which the API runs               |
| `REDIS_URL`            | Redis connection URL                     |
| `GENERAL_RATE_LIMIT`   | Maximum requests for general routes      |
| `GENERAL_RATE_WINDOW`  | General rate-limit window (seconds)      |
| `STRICT_RATE_LIMIT`    | Maximum requests for strict routes       |
| `STRICT_RATE_WINDOW`   | Strict rate-limit window (seconds)       |

**Example:**
```env
PORT=3000
REDIS_URL=redis://redis:6379

GENERAL_RATE_LIMIT=10
GENERAL_RATE_WINDOW=60

STRICT_RATE_LIMIT=3
STRICT_RATE_WINDOW=60
```

---

## 🛡️ Error Handling

The rate limiter is designed to **fail open** if Redis encounters an unexpected error:

```text
Redis Error
    ↓
Rate limiter catches error
    ↓
Request continues
    ↓
API remains available
```

This behavior prevents a Redis outage from taking down the entire API. For production systems, this strategy can be adjusted depending on the security and availability requirements of the application (e.g., failing closed for highly sensitive routes).

---

## 🔍 Technologies Used

| Technology       | Purpose                                    |
|-------------------|---------------------------------------------|
| Node.js          | Backend runtime                            |
| Express.js       | HTTP server and API framework              |
| Redis            | Distributed request counter and TTL storage|
| Lua              | Atomic Redis rate-limit operations         |
| Jest             | Automated testing                          |
| Supertest        | HTTP API testing                           |
| Docker           | Containerization                           |
| Docker Compose   | Multi-container orchestration              |
| Git & GitHub     | Version control                            |

---

## 📈 Future Improvements

- [ ] API-key based rate limiting
- [ ] User/account-based rate limiting
- [ ] Token Bucket algorithm
- [ ] Sliding Window algorithm
- [ ] Distributed rate limiting across multiple API instances
- [ ] Redis connection health checks
- [ ] Prometheus metrics
- [ ] Grafana monitoring dashboard
- [ ] Request logging
- [ ] Docker health checks
- [ ] CI/CD using GitHub Actions
- [ ] Production deployment
- [ ] Rate-limit monitoring dashboard

---

## 🎓 Learning Objectives

This project was built to explore practical backend and system-design concepts, including:

- API rate limiting strategies
- Redis as a distributed data store
- Fixed-window algorithms
- TTL-based expiration
- Atomic operations
- Redis Lua scripting
- HTTP response headers
- HTTP 429 Too Many Requests semantics
- Middleware architecture
- Automated API testing
- Docker containerization & networking
- Environment-based configuration
- Git/GitHub workflow

---

## 👨‍💻 Author

**Harmandeep Nagpal**

---

## ⭐ Project Highlights

A Redis-backed, Lua-powered API rate limiter with configurable policies, automated testing, standard HTTP rate-limit headers, and Docker Compose-based deployment.