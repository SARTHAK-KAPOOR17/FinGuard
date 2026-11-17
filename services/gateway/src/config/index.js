const dotenv = require('dotenv');
const path = require('path');
const { SERVICES, DEFAULT_PORTS } = require('@finguard/shared');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = Object.freeze({
  serviceName: SERVICES.GATEWAY,
  port: parseInt(process.env.PORT || String(DEFAULT_PORTS.GATEWAY), 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  services: {
    ingestionUrl: process.env.INGESTION_SERVICE_URL || 'http://localhost:3001',
    ruleEngineUrl: process.env.RULE_ENGINE_SERVICE_URL || 'http://localhost:3002',
    alertUrl: process.env.ALERT_SERVICE_URL || 'http://localhost:3003',
    authUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3004',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
});

module.exports = config;
