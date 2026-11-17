const constants = require('./constants');
const { createLogger } = require('./logger');
const {
  transactionSchema,
  batchTransactionSchema,
  validateTransaction,
  validateBatchTransactions,
} = require('./schemas/transaction.schema');
const {
  createKafkaClient,
  createProducer,
  createConsumer,
} = require('./kafka');

module.exports = {
  ...constants,
  createLogger,
  transactionSchema,
  batchTransactionSchema,
  validateTransaction,
  validateBatchTransactions,
  createKafkaClient,
  createProducer,
  createConsumer,
};
