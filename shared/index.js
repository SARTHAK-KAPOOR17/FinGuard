const constants = require('./constants');
const { createLogger } = require('./logger');
const {
  MAX_BATCH_SIZE,
  locationSchema,
  transactionSchema,
  validateTransaction,
  validateBatchItems,
} = require('./schemas/transaction.schema');
const {
  matchedRuleSchema,
  flaggedEventSchema,
  validateFlaggedEvent,
} = require('./schemas/flagged.schema');
const {
  createKafkaClient,
  createProducer,
  createConsumer,
} = require('./kafka');

module.exports = {
  ...constants,
  MAX_BATCH_SIZE,
  createLogger,
  locationSchema,
  transactionSchema,
  validateTransaction,
  validateBatchItems,
  matchedRuleSchema,
  flaggedEventSchema,
  validateFlaggedEvent,
  createKafkaClient,
  createProducer,
  createConsumer,
};
