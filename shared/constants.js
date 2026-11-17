/**
 * FinGuard Constants
 */
const TOPICS = Object.freeze({
  TRANSACTIONS_RAW: 'transactions.raw',
  TRANSACTIONS_FLAGGED: 'transactions.flagged',
});

const SERVICES = Object.freeze({
  INGESTION: 'ingestion-service',
  RULE_ENGINE: 'rule-engine-service',
  ALERT: 'alert-service',
  AUTH: 'auth-service',
  GATEWAY: 'gateway-service',
  SIMULATOR: 'transaction-simulator',
});

const DEFAULT_PORTS = Object.freeze({
  GATEWAY: 3000,
  INGESTION: 3001,
  RULE_ENGINE: 3002,
  ALERT: 3003,
  AUTH: 3004,
});

const CURRENCIES = Object.freeze([
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SGD'
]);

module.exports = {
  TOPICS,
  SERVICES,
  DEFAULT_PORTS,
  CURRENCIES,
};
