# FinGuard Architecture Overview

FinGuard is a real-time financial fraud detection platform designed for high-throughput stream processing and modular microservices.

## High-Level Data Flow

```
[ Transaction Simulator ]
          |
          | HTTP (POST /transactions or /batch)
          v
[ Ingestion Service ]
          |
          | Validates Schema (Joi)
          | Publishes with partition key (userId)
          v
[ Kafka Topic: transactions.raw ]
          |
          | Consumes raw transactions
          v
[ Rule Engine Service ]
          |
          | Evaluates fraud rules against Redis state & rule sets
          | If fraud pattern detected -> publishes flagged event
          v
[ Kafka Topic: transactions.flagged ]
          |
          | Consumes flagged alerts
          v
[ Alert Service ] ---> [ MongoDB: alerts collection ]
                  ---> [ WebSocket / SSE / Live Dashboard ]
```

## Core Infrastructure

- **Kafka in KRaft Mode**: No ZooKeeper required. Manages high-throughput message streaming with partitions for raw and flagged events.
- **MongoDB**: Persistent storage for audit logs, users, rules, and fraud alerts.
- **Redis**: Low-latency in-memory state store for sliding-window velocity checks, recent locations, and user transaction counters.
- **Microservices**:
  - `gateway`: Unified entry point and reverse proxy.
  - `auth`: User authentication and role management (JWT).
  - `ingestion`: High-throughput ingestion API and validation.
  - `rule-engine`: Stateful rule evaluation (velocity, thresholds, geo-distance).
  - `alert`: Notification dispatch and fraud history storage.
- **Simulator**: Configurable realistic traffic generator with normal and anomaly injection.

---

## Stream Processing & Offset Commit Semantics (Rule Engine)

### 1. Consumer Lifecycle & Partition Safety
- The Rule Engine subscribes to `transactions.raw` using an independent consumer group (`rule-engine-group`).
- **Initial Offset Strategy**: In order to avoid reprocessing millions of legacy benchmark transactions when spun up in an existing environment, the consumer starts with `fromBeginning=false` (configurable via `KAFKA_FROM_BEGINNING`).
- **Malformed & Invalid Message Handling**:
  - If an incoming payload contains malformed JSON or fails Joi schema validation, it is logged with detailed error metadata (`topic`, `partition`, `offset`, `err`).
  - The offset is explicitly committed, and processing moves to the next message.
  - Malformed messages never crash the consumer worker and never block the partition pipeline (poison-pill prevention).

### 2. At-Least-Once Delivery & Commit Ordering
- The Rule Engine operates with `autoCommit: false` to enforce strict at-least-once delivery semantics.
- For legitimate transactions that match fraud rules:
  1. The flagged event payload is constructed with matched rule metadata, risk scores, and a unique `flaggedId`.
  2. The event is published to `transactions.flagged` using the shared Kafka producer.
  3. **Only after** the Kafka broker confirms write acknowledgment (`acks: -1`) of the flagged event is the incoming offset committed on `transactions.raw`.
- For clean transactions (no fraud detected), the offset is committed immediately following rule evaluation.

### 3. Duplicate-Flag Risk & Mitigation Strategy
- **Risk Scenario**: If the Rule Engine crashes, gets terminated by OOM, or suffers a network partition *after* successfully publishing an alert to `transactions.flagged` but *before* committing the offset on `transactions.raw`, the Kafka broker will re-deliver the raw transaction to another worker upon consumer group rebalance.
- **Resulting Behavior**: The re-delivered transaction will be re-evaluated and a duplicate flagged event will be published to `transactions.flagged`.
- **Mitigation (Idempotent Consumer)**:
  - Downstream services (e.g. `alert-service`) must treat `transactions.flagged` as an at-least-once stream.
  - Alerts stored in MongoDB must use a unique index on `txnId` or perform an idempotent upsert (`findOneAndUpdate` with `upsert: true` on `txnId`).
  - Live notification dispatchers (e.g. WebSocket or Push) must verify an in-memory or Redis de-duplication cache (`SETNX alert:dedup:<txnId> 86400`) before triggering notifications to human operators.
