const dotenv = require('dotenv');
const path = require('path');
const { SERVICES, DEFAULT_PORTS, TOPICS } = require('@finguard/shared');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = Object.freeze({
  serviceName: SERVICES.RULE_ENGINE,
  port: parseInt(process.env.PORT || String(DEFAULT_PORTS.RULE_ENGINE), 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  kafka: {
    brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
    clientId: process.env.KAFKA_CLIENT_ID || 'finguard-rule-engine-service',
    consumerGroupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'rule-engine-group',
    rawTopic: process.env.KAFKA_RAW_TOPIC || TOPICS.TRANSACTIONS_RAW,
    flaggedTopic: process.env.KAFKA_FLAGGED_TOPIC || TOPICS.TRANSACTIONS_FLAGGED,
    fromBeginning: process.env.KAFKA_FROM_BEGINNING === 'true',
  },
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://root:example@localhost:27017/finguard?authSource=admin',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    channels: {
      rulesUpdated: 'rules:updated',
    },
    keyPrefixes: {
      velocity: 'velocity:',
      location: 'location:',
    },
  },
});

module.exports = config;
