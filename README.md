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
  │   ├── rule-engine/     # Stateful fraud evaluation service (skeleton)
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

---

## Transaction Ingestion API

The Ingestion Service exposes two endpoints on port `3001`:

### 1. Single Transaction Ingestion
- **Endpoint**: `POST /transactions`
- **Headers**: `Content-Type: application/json`
- **Payload Schema**:
  ```json
  {
    "txnId": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "usr_0042",
    "amount": 149.99,
    "currency": "USD",
    "merchant": "Apple Store",
    "location": {
      "city": "New York",
      "country": "USA",
      "lat": 40.7128,
      "lng": -74.0060
    },
    "deviceId": "dev_9876543210ab",
    "timestamp": "2026-11-17T05:25:00.000Z"
  }
  ```
- **Responses**:
  - `202 Accepted`: Payload validated and queued to Kafka topic `transactions.raw` partitioned by `userId`.
  - `400 Bad Request`: Validation failure with structured field errors.

### 2. Bulk Transaction Ingestion
- **Endpoint**: `POST /transactions/batch`
- **Batch Size Limit**: Max 500 transactions per batch.
- **Payload**: Array of transaction objects or `{ "transactions": [...] }`.
- **Responses**:
  - `202 Accepted`: All items valid and published in a single Kafka `sendBatch` call.
  - `202 Accepted` (`status: partially_accepted`): Valid items published via `sendBatch`, with per-item validation errors specifying each bad item's index.
  - `400 Bad Request`: If empty, over 500 items, or all items invalid.

---

## Transaction Simulator CLI

The simulator generates synthetic realistic transactions mixed with ~5% configurable fraud-like anomaly patterns.

### Fraud Patterns Injected
1. **Large Amount**: High-value transactions ($10,000 - $85,000+) at luxury merchants (Rolex Boutique, Private Jet Charter, Casino VIP).
2. **Rapid Velocity**: High-frequency transaction bursts (5-7 transactions in < 1 second) from the same user and device.
3. **Location Jump**: Impossible travel (e.g. New York followed by Tokyo within 1.5 seconds) for the same user.

### CLI Usage & Options

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
| `--fraud-ratio <number>` | Fraction of transactions exhibiting fraud patterns | `0.05` (5%) |

### Examples

**Standard run (10 txns/sec for 10 seconds):**
```bash
npm run simulate -- --rate 10 --duration 10
```

**Reproducible seeded run (100 txns/sec for 30 seconds):**
```bash
npm run simulate -- --rate 100 --duration 30 --seed finguard-benchmark-2026
```

**Batch mode (sending 20 transactions per request):**
```bash
npm run simulate -- --rate 100 --duration 10 --batch 20
```

---

## Testing & Verification

```bash
# Run unit & integration test suites across all workspaces
npm test

# Run Kafka end-to-end roundtrip test
npm run test:kafka
```
