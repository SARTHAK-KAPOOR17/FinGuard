
# FinGuard
# FinGuard - Real-Time Financial Fraud Detection Platform

FinGuard is a high-volume financial transaction ingestion and real-time fraud detection engine built with an event-driven microservices architecture on the MERN stack.

## Architecture & Tech Stack

- **Runtime & Framework**: Node.js (v20+), Express (CommonJS)
- **Streaming & Messaging**: Apache Kafka in KRaft mode (KRaft, no ZooKeeper) via `kafkajs`
- **Databases & Caching**: MongoDB (Mongoose) for persistence, Redis (`ioredis`) for sliding-window velocity and state checks
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
- [ ] **Day 2: Service Skeletons & Kafka Wrapper**
  - Express service skeletons with `GET /health` and graceful shutdowns
  - Reusable resilient Kafka wrapper (`createProducer`, `createConsumer`)
  - End-to-end Kafka roundtrip test
- [ ] **Day 3: Ingestion Service & Transaction Simulator**
  - `POST /transactions` and `POST /transactions/batch` with Joi validation
  - Simulator CLI with configurable rate, duration, and anomaly patterns
  - Jest & Supertest validation test suite

## Quick Start (Infrastructure)

### Prerequisites
- Node.js >= 20.0.0
- Docker and Docker Compose

### 1. Start Infrastructure
```bash
# Start Kafka, MongoDB, and Redis
npm run infra:up

# Check container health status
npm run infra:status

# Stream logs
npm run infra:logs

# Tear down infrastructure
npm run infra:down
```

### 2. Verify Kafka Topics
Kafka automatically provisions the following topics:
- `transactions.raw` (3 partitions, replication factor 1)
- `transactions.flagged` (3 partitions, replication factor 1)

### 3. Environment Setup
Copy the example environment files for local execution:
```bash
cp .env.example .env
```
