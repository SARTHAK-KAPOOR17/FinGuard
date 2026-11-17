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
  │   ├── ingestion/       # HTTP ingestion endpoint (POST /transactions) & validation
  │   ├── rule-engine/     # Stateful fraud evaluation service (skeleton)
  │   ├── alert/           # Alert persistence and notifications (skeleton)
  │   ├── auth/            # Authentication & authorization service (skeleton)
  │   └── gateway/         # API Gateway & reverse proxy (skeleton)
  ├── simulator/           # High-volume traffic generator CLI
  ├── shared/              # Reusable logger, Kafka wrappers, schemas, constants
  ├── infra/               # Docker Compose & infrastructure configurations
  ├── docs/                # Architectural diagrams & design specifications
  ├── scripts/             # End-to-end verification scripts (e.g., Kafka roundtrip)
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
- [ ] **Day 3: Ingestion Service & Transaction Simulator**
  - `POST /transactions` and `POST /transactions/batch` with Joi validation
  - Simulator CLI with configurable rate, duration, and anomaly patterns
  - Jest & Supertest validation test suite

## Quick Start (Infrastructure & Services)

### 1. Prerequisites
- Node.js >= 20.0.0
- Docker & Docker Compose

### 2. Start Infrastructure
```bash
# Start KRaft Kafka, MongoDB, and Redis
npm run infra:up

# Check container health status
npm run infra:status
```

### 3. Run Live Kafka Roundtrip Test
Tests end-to-end event streaming from producer through live Kafka broker to consumer:
```bash
npm run test:kafka
```

### 4. Run Service Health Test Suite
Executes Jest & Supertest across all service skeletons:
```bash
npm test
```
