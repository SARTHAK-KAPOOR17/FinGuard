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
          | Evaluates fraud rules against Redis state
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
