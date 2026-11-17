const dotenv = require('dotenv');
const path = require('path');
const { SERVICES, DEFAULT_PORTS, TOPICS } = require('@finguard/shared');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = Object.freeze({
  serviceName: SERVICES.ALERT,
  port: parseInt(process.env.PORT || String(DEFAULT_PORTS.ALERT), 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  adminApiKey: process.env.ADMIN_API_KEY,
  dashboardOrigin: process.env.DASHBOARD_ORIGIN || 'http://localhost:3000',
  kafka: {
    brokers: process.env.KAFKA_BROKERS || 'localhost:9092',
    clientId: process.env.KAFKA_CLIENT_ID || 'finguard-alert-service',
    consumerGroupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'alert-service-group',
    flaggedTopic: process.env.KAFKA_FLAGGED_TOPIC || TOPICS.TRANSACTIONS_FLAGGED,
    fromBeginning: process.env.KAFKA_FROM_BEGINNING === 'true',
  },
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://root:example@localhost:27017/finguard?authSource=admin',
  },
});

module.exports = config;
