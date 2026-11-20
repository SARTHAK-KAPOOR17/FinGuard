const dotenv = require('dotenv');
const path = require('path');
const { SERVICES, DEFAULT_PORTS, TOPICS } = require('@finguard/shared');

// Load .env if present
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = Object.freeze({
  serviceName: SERVICES.INGESTION,
  port: parseInt(process.env.PORT || String(DEFAULT_PORTS.INGESTION), 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  kafka: {
    brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
    clientId: process.env.KAFKA_CLIENT_ID || 'finguard-ingestion-service',
    rawTopic: process.env.KAFKA_RAW_TOPIC || TOPICS.TRANSACTIONS_RAW,
  },
});

module.exports = config;
