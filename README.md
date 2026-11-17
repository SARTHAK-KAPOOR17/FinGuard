# FinGuard - Real-Time Financial Fraud Detection Platform

FinGuard is a high-volume financial transaction ingestion and real-time fraud detection engine built with an event-driven microservices architecture on the MERN stack.

## Architecture & Tech Stack

- **Runtime & Framework**: Node.js (v20+), Express (CommonJS)
- **Streaming & Messaging**: Apache Kafka in KRaft mode (no ZooKeeper) via `kafkajs`
- **Databases & Caching**: MongoDB 7.0 (Mongoose) for persistence, Redis 7 (`ioredis`) for sliding-window velocity checks
- **Validation & Logging**: Joi for schema validation, `pino` for structured JSON logging
- **Infrastructure**: Docker & Docker Compose with healthchecks and named volumes
- **Testing**: Jest & Supertest

## Monorepo Layout

```
finguard/
  ├── services/
  │   ├── ingestion/       # HTTP Ingestion API (POST /transactions & /batch) -> Kafka
  │   ├── rule-engine/     # Stateful fraud evaluation service & at-least-once Kafka processor
  │   ├── alert/           # Alert persistence and notifications (skeleton)
  │   ├── auth/            # Authentication & authorization service (skeleton)
  │   └── gateway/         # API Gateway & reverse proxy (skeleton)
  ├── simulator/           # High-volume traffic generator CLI with reproducible fraud patterns
  ├── shared/              # Reusable logger, Kafka wrappers, schemas, constants
  ├── infra/               # Docker Compose & infrastructure configurations
  ├── docs/                # Architectural diagrams & design specifications
  ├── scripts/             # End-to-end verification scripts
  ├── .gitignore
  ├── .env.example
  └── README.md
```

## Phase 1 Milestones

- [x] **Day 1: Setup & Architecture**
  - Monorepo folder structure and service initialization
  - Docker Compose for KRaft Kafka, MongoDB 7.0, and Redis 7
  - Kafka topics auto-creation (`transactions.raw`, `transactions.flagged`)
  - Canonical transaction schema definition in `shared/`
  - Structured Pino logger and environment templates
- [x] **Day 2: Service Skeletons & Kafka Wrapper**
  - Express service skeletons with `GET /health`, env config, and graceful shutdown
  - Clear `src/` layout (routes, controllers, services, config) across all 5 microservices
  - Reusable resilient Kafka wrapper (`createProducer`, `createConsumer`) with retry & backoff
  - Live Kafka roundtrip verification against Docker Compose cluster
  - Automated Jest & Supertest health check test suite
- [x] **Day 3: Ingestion Service & Transaction Simulator**
  - High-throughput `POST /transactions` validating schema with Joi and publishing to `transactions.raw` keyed by `userId`
  - High-performance `POST /transactions/batch` with 500-item cap, per-item error indexing, and single `producer.sendBatch` publishing
  - Comprehensive Jest & Supertest validation test suite
  - Configurable transaction simulator CLI with reproducible seedable fraud patterns
  - End-to-end load verification at 100 txns/sec for 30s (~3,000 transactions into Kafka)

## Phase 2 Milestones

- [x] **Day 4: Real-Time Rule Engine & At-Least-Once Processing**
  - Kafka stream consumer subscribing to `transactions.raw` with configurable `fromBeginning=false`
  - Resilient, poison-pill-proof message handling (malformed JSON and schema failures logged and skipped without blocking partition)
  - At-least-once delivery: manual offset commit only after confirmed publication of flagged event to `transactions.flagged`
  - Seed fraud rules matching traffic patterns:
    - `RULE_LARGE_AMOUNT`: Amount > $10,000 USD (Severity: HIGH)
    - `RULE_SUSPICIOUS_MERCHANT`: Regex matching luxury, offshore, and casino merchants (Severity: CRITICAL)
  - Live end-to-end benchmark verification: consumed 2,999 raw transactions, flagged and published 66 fraud events with full rule metadata
- [x] **Day 5: Stateful Velocity & Geo-Distance Rules + Atomic Runtime Reload**
  - **MongoDB Rule Persistence**: Fraud rules stored in MongoDB collection `rules` with automatic fallback seeding if collection is empty.
  - **Standardized Severity**: Standardized across schema, model, evaluator, and alerts as `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
  - **Redis Sliding-Window Velocity (`RULE_VELOCITY`)**: Tracks per-user frequency using Redis Sorted Sets (`ZADD`, `ZREMRANGEBYSCORE`, `ZCARD`) within a sliding window (default: > 5 txns in 10s) with TTL auto-expiration.
  - **Geo-Distance & Impossible Travel (`RULE_LOCATION_JUMP`)**: Haversine distance and implied speed calculation (> 900 km/h) with rapid country change detection. Gracefully handles user's first transaction without false positives.
  - **Atomic Runtime Reload**: Rebuilds `RuleEvaluator` instance atomically so no transaction evaluates against partial state. Triggers immediately via Redis Pub/Sub channel `rules:updated` or HTTP `PATCH /rules/:id`, plus a 60-second fallback poll.

---

## Transaction Ingestion API

The Ingestion Service exposes two endpoints on port `3001`:

### 1. Single Transaction Ingestion
- **Endpoint**: `POST /transactions`
- **Headers**: `Content-Type: application/json`
- **Responses**:
  - `202 Accepted`: Payload validated and queued to Kafka topic `transactions.raw` partitioned by `userId`.
  - `400 Bad Request`: Validation failure with structured field errors.

### 2. Bulk Transaction Ingestion
- **Endpoint**: `POST /transactions/batch`
- **Batch Size Limit**: Max 500 transactions per batch.
- **Responses**:
  - `202 Accepted`: All items valid and published in a single Kafka `sendBatch` call.
  - `202 Accepted` (`status: partially_accepted`): Valid items published via `sendBatch`, with per-item validation errors specifying each bad item's index.
  - `400 Bad Request`: If empty, over 500 items, or all items invalid.

---

## Rule Engine Service

The Rule Engine runs on port `3002` and consumes `transactions.raw` in real-time:

### Endpoints
- `GET /health`: Service health and live processor metrics (total consumed, flagged, clean, malformed).
- `GET /rules`: List of active fraud rules and configurations.
- `PATCH /rules/:id`: Enable or disable specific fraud rules dynamically.

### Active Seed Rules
| Rule ID | Type | Severity | Description | Default Threshold / Window |
|---|---|---|---|---|
| `RULE_LARGE_AMOUNT` | `THRESHOLD` | `HIGH` | Flags transactions with amount > threshold in USD | Amount > $10,000 USD |
| `RULE_SUSPICIOUS_MERCHANT` | `REGEX` | `CRITICAL` | Flags transactions at luxury, offshore crypto, or casino merchants | Regex pattern match |
| `RULE_VELOCITY` | `VELOCITY` | `HIGH` | Flags rapid bursts of transactions from a single user | > 5 txns within 10 seconds |
| `RULE_LOCATION_JUMP` | `GEO_DISTANCE` | `CRITICAL` | Flags impossible travel between distant locations/countries | > 900 km/h or cross-country < 300s |

---

## Transaction Simulator CLI

```bash
node simulator/src/index.js [options]
# or using npm
npm run simulate -- [options]
```

| Flag | Description | Default |
|---|---|---|
| `-r, --rate <number>` | Target transactions per second (txns/sec) | `10` |
| `-d, --duration <number>` | Simulation duration in seconds | `10` |
| `-s, --seed <string>` | Seed for reproducible random numbers & fraud patterns | *random* |
| `-u, --url <string>` | Target Ingestion endpoint URL | `http://localhost:3001/transactions` |
| `-b, --batch <number>` | Batch size for bulk ingestion | `1` (single POSTs) |
| `--fraud-ratio <number>` | Trigger probability per generator step | `0.05` (5%) |

> **Note on Fraud Ratio vs. Effective Share:**
> The `--fraud-ratio` parameter (default `0.05` or 5%) configures the *trigger probability per generation step*. However, when a `rapid_velocity` anomaly triggers, it generates a multi-transaction burst of 5 to 7 transactions for that user, and a `location_jump` anomaly emits 2 sequential geographically distant transactions. As a result, the **effective fraud-like transaction share** across all generated transactions is approximately **12% to 14%** (around ~13% on average).

---

## Testing & Verification

```bash
# Run test suites across all workspaces
npm test

# Run Kafka end-to-end roundtrip test
npm run test:kafka
```
