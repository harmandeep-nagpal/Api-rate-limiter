# 🚦 API Rate Limiter

A production-oriented **API rate limiting service** built with **Node.js**, **Express**, **Redis**, and **Lua**. It implements **three distributed rate-limiting algorithms** — Fixed Window, Token Bucket, and Sliding Window — behind a common factory interface, using atomic Lua scripts to update counters and expirations safely under concurrent load. The entire stack is containerized with **Docker Compose**, includes health/readiness checks, per-policy metrics, and a benchmarked concurrency test suite.

[![Node.js](https://img.shields.io/badge/Node.js-Backend-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-Framework-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Redis](https://img.shields.io/badge/Redis-Datastore-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Jest](https://img.shields.io/badge/Tested_with-Jest-C21325?logo=jest&logoColor=white)](https://jestjs.io/)

---

## Table of Contents

- [Features](#-features)
- [Architecture](#️-architecture)
- [Rate-Limiting Algorithms](#-rate-limiting-algorithms)
- [Algorithm Comparison](#-algorithm-comparison)
- [Redis Key Structure](#-redis-key-structure)
- [Atomic Rate Limiting with Lua](#-atomic-rate-limiting-with-lua)
- [Rate-Limit Policies](#-rate-limit-policies)
- [API Endpoints](#-api-endpoints)
- [Rate-Limit Headers](#-rate-limit-headers)
- [Metrics & Observability](#-metrics--observability)
- [Rate Limit Exceeded](#-rate-limit-exceeded)
- [Error Handling](#️-error-handling)
- [Health & Readiness](#-health--readiness)
- [Docker Setup](#-docker-setup)
- [Running the Project](#-running-the-project-with-docker)
- [Testing the API](#-testing-the-api)
- [Automated Testing](#-automated-testing)
- [Benchmark Results](#-benchmark-results)
- [Project Structure](#-project-structure)
- [Configuration](#️-configuration)
- [Design Decisions & Trade-offs](#-design-decisions--trade-offs)
- [Technologies Used](#-technologies-used)
- [Future Improvements](#-future-improvements)
- [Learning Objectives](#-learning-objectives)
- [Author](#-author)

---

## ✨ Features

- 🚦 Three interchangeable rate-limiting algorithms: Fixed Window, Token Bucket, Sliding Window
- 🏭 Factory pattern for selecting and instantiating a policy's algorithm
- ⚡ Redis-backed distributed counters
- 🔐 Atomic Redis operations using Lua scripts
- 🌐 IP-based client identification, with reverse-proxy support (`TRUST_PROXY`)
- 🎯 Multiple independently configurable rate-limit policies
- 📊 Standard rate-limit response headers
- ⏱️ `Retry-After` support for blocked requests
- 🔄 Automatic rate-limit window expiration
- 📈 Built-in `/metrics` endpoint with per-policy counters
- 🩺 `/health` and `/ready` endpoints for liveness/readiness
- 🧪 Automated tests using Jest and Supertest, including concurrency testing
- 🐳 Fully dockerized API and Redis, with Redis health checks and graceful shutdown
- ⚙️ Environment-based configuration for every algorithm
- 🛡️ Fail-open behavior on Redis errors, backed by centralized error handling

---

## 🏗️ Architecture

```text
                                Client
                                  │
                                  │ HTTP Request
                                  ▼
                         ┌────────────────┐
                         │  Express API   │
                         └───────┬────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Rate Limit      │
                        │  Factory         │
                        └────────┬─────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       Fixed Window        Token Bucket       Sliding Window
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 ▼
                          ┌─────────────┐
                          │ Redis + Lua │
                          │  (atomic)   │
                          └──────┬──────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Allow / Reject  │
                        │   200 / 429      │
                        └────────┬─────────┘
                                 │
                                 ▼
                             Metrics
```

The rate-limit factory selects the configured algorithm per policy at request time, and each algorithm implementation shares the same Redis + Lua execution path, so adding a new algorithm doesn't touch the middleware or routing layer.

---

## 🧠 Rate-Limiting Algorithms

The service supports three algorithms, selectable per policy:

### Fixed Window
Counts requests within fixed, non-overlapping time windows (e.g. 0–60s, 60–120s). Simple and cheap, but can allow bursts at window boundaries.

### Token Bucket
Each client has a bucket that refills continuously at a fixed rate. Requests consume tokens; if the bucket is empty, the request is rejected. Naturally allows short bursts while enforcing a long-term average rate.

### Sliding Window
Tracks requests over a rolling time window rather than a fixed boundary, giving smoother, more accurate limiting than Fixed Window without the burst-tolerance of Token Bucket.

All three algorithms are implemented as atomic Redis Lua scripts to guarantee correctness under concurrent access.

---

## ⚖️ Algorithm Comparison

| Algorithm       | Best for             | Behavior                                     |
|-----------------|-----------------------|-----------------------------------------------|
| Fixed Window    | Simple quotas         | Counts requests in fixed time boundaries       |
| Token Bucket    | Burst traffic         | Allows bursts, refills continuously over time  |
| Sliding Window  | Smooth, accurate limiting | Tracks requests over a rolling window       |

---

## 🔑 Redis Key Structure

Each rate-limit counter is stored using a key composed of:

- Rate-limit policy
- Algorithm
- Client IP address
- Current window / bucket identifier

**Structure:**
```text
rate_limit:<policy>:<algorithm>:ip:<ip>:<windowId>
```

**Example:**
```text
rate_limit:strict:sliding-window:ip:10.0.0.1:29384723
```

This allows different users, policies, and algorithms to maintain fully independent counters.

---

## ⚡ Atomic Rate Limiting with Lua

Each algorithm's counter update and expiration logic runs **atomically** inside a Redis Lua script, so it executes as a single, uninterruptible operation on the Redis server — critical once multiple algorithms and concurrent clients are involved.

Conceptually, for Fixed Window:

```lua
local currentCount = redis.call("INCR", KEYS[1])

if currentCount == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
end

return currentCount
```

Token Bucket and Sliding Window use their own Lua scripts to manage refill rate and rolling timestamps respectively, but follow the same principle: read, update, and expire in one atomic round-trip.

### Why Lua?

Without atomic execution, counter updates and expirations would run as separate operations. A failure between them could leak keys without an expiration, or let two concurrent requests read a stale count. Running the logic inside a single Lua script guarantees correctness under concurrent load.

---

## 🎯 Rate-Limit Policies

The application supports multiple policies, each independently configurable, and each can be assigned any of the three algorithms.

| Policy  | Algorithm (example) | Limit / Rate  | Window / Refill |
|---------|----------------------|----------------|-------------------|
| General | Configurable          | Configurable   | Configurable      |
| Strict  | Configurable          | Configurable   | Configurable      |

**Example:**
```env
GENERAL_RATE_LIMIT=10
GENERAL_RATE_WINDOW=60

STRICT_RATE_LIMIT=3
STRICT_RATE_WINDOW=60

TOKEN_BUCKET_CAPACITY=10
TOKEN_BUCKET_REFILL_RATE=1

SLIDING_WINDOW_LIMIT=5
SLIDING_WINDOW_SIZE=60
```

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

### Readiness Check
```http
GET /ready
```
Confirms the service and its Redis connection are ready to accept traffic.

**Response**
```json
{
  "status": "ready",
  "redis": "connected"
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

### Token Bucket API
```http
GET /api/token-bucket
```
Protected by the token-bucket rate limiter, allowing short bursts within the configured capacity.

### Sliding Window API
```http
GET /api/sliding-window
```
Protected by the sliding-window rate limiter for smoother, rolling-window enforcement.

### Metrics
```http
GET /metrics
```
Returns aggregate and per-policy request counters (see [Metrics & Observability](#-metrics--observability)).

---

## 📊 Rate-Limit Headers

Every request that passes through the rate limiter receives the following headers:

| Header                  | Description                                              | Example                     |
|--------------------------|-----------------------------------------------------------|------------------------------|
| `X-RateLimit-Limit`      | Maximum number of requests allowed in the current window/bucket | `X-RateLimit-Limit: 10`     |
| `X-RateLimit-Remaining`  | Number of requests remaining                              | `X-RateLimit-Remaining: 7`  |
| `X-RateLimit-Reset`      | Unix timestamp when the current window/bucket resets      | `X-RateLimit-Reset: 1788115860` |
| `Retry-After`            | Seconds to wait before retrying (only on 429 responses)  | `Retry-After: 48`           |

---

## 📈 Metrics & Observability

The `/metrics` endpoint exposes aggregate and per-policy counters so rate-limiting behavior can be inspected at runtime:

```json
{
  "allowedRequests": 22,
  "rejectedRequests": 95,
  "totalRequests": 117,
  "allowedByPolicy": {
    "token-bucket": 17,
    "sliding-window": 5
  },
  "rejectedByPolicy": {
    "sliding-window": 95
  }
}
```

This makes it straightforward to see, per algorithm, how much traffic is being allowed versus rejected — useful both for debugging and for demonstrating algorithm behavior under load.

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

## 🛡️ Error Handling

The rate limiter is designed to **fail open** if Redis encounters an unexpected error, backed by centralized error-handling middleware:

```text
Redis Error
    ↓
Rate limiter catches error
    ↓
Centralized error handler logs/normalizes it
    ↓
Request continues
    ↓
API remains available
```

This prevents a Redis outage from taking down the entire API. For production systems, this strategy can be adjusted depending on the security and availability requirements of the application (e.g., failing closed for highly sensitive routes).

---

## 🩺 Health & Readiness

- `GET /health` — liveness probe; confirms the process is running.
- `GET /ready` — readiness probe; confirms the Redis connection is established, so the service can be safely added to load-balancer rotation only once it's actually able to serve rate-limited traffic.

---

## 🐳 Docker Setup

The project uses Docker Compose to run both the API and Redis, including a Redis health check and graceful shutdown handling:

```text
Docker Compose
│
├── API Container
│   ├── Node.js
│   ├── Express.js
│   └── Graceful shutdown
│
└── Redis Container
    ├── Redis 7
    └── Health check
```

The API communicates with Redis using the Docker Compose service name:

```text
redis://redis:6379
```

This allows both containers to communicate over the internal Docker network, and the API waits on Redis's health check before accepting traffic.

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
TRUST_PROXY=true

GENERAL_RATE_LIMIT=10
GENERAL_RATE_WINDOW=60

STRICT_RATE_LIMIT=3
STRICT_RATE_WINDOW=60

TOKEN_BUCKET_CAPACITY=10
TOKEN_BUCKET_REFILL_RATE=1

SLIDING_WINDOW_LIMIT=5
SLIDING_WINDOW_SIZE=60
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

### Readiness Check

```bash
curl http://localhost:3000/ready
```

**Expected response:**
```json
{
  "status": "ready",
  "redis": "connected"
}
```

### Test a Rate Limiter

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

### Check Metrics

```bash
curl http://localhost:3000/metrics
```

---

## 🧪 Automated Testing

The project uses **Jest** for testing and **Supertest** for HTTP endpoint testing, across two suites covering unit and concurrency behavior.

Run the test suite with:

```bash
npm test
```

The current test suite verifies:

- ✅ Remaining request count
- ✅ Requests being blocked after the limit, per algorithm
- ✅ Independent rate-limit policies and algorithms
- ✅ Rate-limit window/bucket expiration and refill
- ✅ Rate-limit response headers
- ✅ Independent IP-based counters
- ✅ Concurrent request handling under load
- ✅ `/health`, `/ready`, and `/metrics` responses

**Current test status:**
```text
Test Suites: 2 passed, 2 total
Tests:       21 passed, 21 total
```

---

## 🏎️ Benchmark Results

Local load tests sending 100 concurrent requests against each algorithm:

**Sliding Window**
```text
Successful:     5
Rate limited:   95
Unexpected:     0
Throughput:     ~490 req/sec
```

**Token Bucket**
```text
Successful:     5
Rate limited:   95
Unexpected:     0
Throughput:     ~401 req/sec
```

> These are local benchmark results from a single-machine test run, meant to demonstrate correctness under concurrency — not universal or absolute performance claims about either algorithm.

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
│   ├── algorithms/
│   │   ├── fixedWindow.js
│   │   ├── tokenBucket.js
│   │   ├── slidingWindow.js
│   │   └── rateLimiterFactory.js
│   │
│   ├── middleware/
│   │   ├── rateLimiter.js
│   │   └── errorHandler.js
│   │
│   ├── monitoring/
│   │   └── metrics.js
│   │
│   ├── app.js
│   └── server.js
│
├── tests/
│   ├── rateLimiter.test.js
│   └── concurrency.test.js
│
├── benchmark/
│   └── loadTest.js
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

| Variable                    | Description                                    |
|------------------------------|-------------------------------------------------|
| `PORT`                       | Port on which the API runs                     |
| `REDIS_URL`                  | Redis connection URL                           |
| `TRUST_PROXY`                | Whether to trust `X-Forwarded-For` when the API sits behind a reverse proxy/load balancer |
| `GENERAL_RATE_LIMIT`         | Maximum requests for general routes            |
| `GENERAL_RATE_WINDOW`        | General rate-limit window (seconds)            |
| `STRICT_RATE_LIMIT`          | Maximum requests for strict routes              |
| `STRICT_RATE_WINDOW`         | Strict rate-limit window (seconds)             |
| `TOKEN_BUCKET_CAPACITY`      | Maximum tokens in the bucket                    |
| `TOKEN_BUCKET_REFILL_RATE`   | Tokens refilled per second                      |
| `SLIDING_WINDOW_LIMIT`       | Maximum requests within the rolling window      |
| `SLIDING_WINDOW_SIZE`        | Rolling window size (seconds)                  |

---

## 💡 Design Decisions & Trade-offs

**Why Redis?**
Rate-limit state needs to be shared across API instances, so an in-memory counter per process isn't enough once the service is horizontally scaled. Redis provides a fast, shared store for that state.

**Why Lua?**
To make multi-step Redis operations (read, update, expire) execute atomically, preventing race conditions under concurrent requests.

**Why fail open?**
To prioritize API availability over strict enforcement when Redis is unavailable — a rate-limiter outage shouldn't become a full API outage. This is configurable per route for cases that need to fail closed instead.

**Why multiple algorithms?**
To demonstrate the trade-offs between simple fixed quotas, burst-tolerant token buckets, and smoother rolling-window accuracy, and to let different routes pick the behavior that fits their traffic pattern.

**Why `TRUST_PROXY`?**
Because the API may run behind a reverse proxy or load balancer, and the rate limiter identifies clients using `req.ip` — which only reflects the real client IP when Express is told to trust the proxy's forwarded headers.

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

- [ ] Prometheus / OpenTelemetry metrics export
- [ ] Grafana monitoring dashboard
- [ ] API-key based rate limiting
- [ ] User/account-based rate limiting
- [ ] Distributed deployment across multiple API instances
- [ ] CI/CD using GitHub Actions
- [ ] Production cloud deployment
- [ ] Persistent metrics storage
- [ ] Request logging

---

## 🎓 Learning Objectives

This project was built to explore practical backend and system-design concepts, including:

- API rate limiting strategies (Fixed Window, Token Bucket, Sliding Window)
- Factory-pattern design for interchangeable algorithms
- Redis as a distributed data store
- TTL-based expiration and rolling-window tracking
- Atomic operations via Redis Lua scripting
- HTTP response headers and 429 semantics
- Observability via a metrics endpoint
- Health vs. readiness probes
- Middleware and centralized error-handling architecture
- Automated and concurrency-based API testing
- Load testing and throughput benchmarking
- Docker containerization & networking
- Environment-based configuration
- Git/GitHub workflow

---

## 👨‍💻 Author

**Harmandeep Nagpal**

---

## ⭐ Project Highlights

A Redis-backed, Lua-powered API rate limiter supporting Fixed Window, Token Bucket, and Sliding Window algorithms behind a factory interface — with per-policy metrics, health/readiness checks, centralized error handling, benchmarked concurrency tests, and Docker Compose-based deployment.