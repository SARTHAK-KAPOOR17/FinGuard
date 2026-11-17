const Joi = require('joi');
const { CURRENCIES } = require('../constants');

/**
 * Transaction location schema
 */
const locationSchema = Joi.object({
  city: Joi.string().trim().min(1).max(100).required().messages({
    'string.base': 'Location city must be a string',
    'string.empty': 'Location city is required',
    'any.required': 'Location city is required',
  }),
  country: Joi.string().trim().min(2).max(100).required().messages({
    'string.base': 'Location country must be a string',
    'string.empty': 'Location country is required',
    'any.required': 'Location country is required',
  }),
  lat: Joi.number().min(-90).max(90).required().messages({
    'number.base': 'Location latitude must be a valid number',
    'number.min': 'Location latitude must be between -90 and 90',
    'number.max': 'Location latitude must be between -90 and 90',
    'any.required': 'Location latitude is required',
  }),
  lng: Joi.number().min(-180).max(180).required().messages({
    'number.base': 'Location longitude must be a valid number',
    'number.min': 'Location longitude must be between -180 and 180',
    'number.max': 'Location longitude must be between -180 and 180',
    'any.required': 'Location longitude is required',
  }),
}).required().messages({
  'any.required': 'Location object is required',
  'object.base': 'Location must be an object containing city, country, lat, and lng',
});

/**
 * Single financial transaction schema
 */
const transactionSchema = Joi.object({
  txnId: Joi.string().uuid({ version: ['uuidv4', 'uuidv1', 'uuidv5'] }).required().messages({
    'string.base': 'txnId must be a string',
    'string.guid': 'txnId must be a valid UUID',
    'any.required': 'txnId is required',
  }),
  userId: Joi.string().trim().min(1).max(128).required().messages({
    'string.base': 'userId must be a string',
    'string.empty': 'userId cannot be empty',
    'any.required': 'userId is required',
  }),
  amount: Joi.number().positive().precision(2).required().messages({
    'number.base': 'amount must be a valid number',
    'number.positive': 'amount must be greater than zero',
    'any.required': 'amount is required',
  }),
  currency: Joi.string().trim().length(3).uppercase().required().messages({
    'string.base': 'currency must be a string',
    'string.length': 'currency must be a 3-letter ISO code (e.g., USD, EUR)',
    'any.required': 'currency is required',
  }),
  merchant: Joi.string().trim().min(1).max(255).required().messages({
    'string.base': 'merchant must be a string',
    'string.empty': 'merchant cannot be empty',
    'any.required': 'merchant is required',
  }),
  location: locationSchema,
  deviceId: Joi.string().trim().min(1).max(128).required().messages({
    'string.base': 'deviceId must be a string',
    'string.empty': 'deviceId cannot be empty',
    'any.required': 'deviceId is required',
  }),
  timestamp: Joi.string().isoDate().required().messages({
    'string.base': 'timestamp must be a string',
    'string.isoDate': 'timestamp must be a valid ISO-8601 date string',
    'any.required': 'timestamp is required',
  }),
});

/**
 * Batch transaction schema (1 to 500 transactions)
 */
const batchTransactionSchema = Joi.object({
  transactions: Joi.array().items(transactionSchema).min(1).max(500).required().messages({
    'array.base': 'transactions must be an array',
    'array.min': 'transactions array must contain at least 1 transaction',
    'array.max': 'transactions array cannot exceed 500 transactions per batch',
    'any.required': 'transactions array is required',
  }),
});

/**
 * Validates a single transaction payload.
 *
 * @param {object} data
 * @returns {{ error: Array<{field: string, message: string}> | null, value: object }}
 */
function validateTransaction(data) {
  const { error, value } = transactionSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (!error) {
    return { error: null, value };
  }

  const formattedErrors = error.details.map((detail) => ({
    field: detail.path.join('.'),
    message: detail.message,
  }));

  return { error: formattedErrors, value };
}

/**
 * Validates a batch transaction payload.
 *
 * @param {object} data
 * @returns {{ error: Array<{field: string, message: string}> | null, value: object }}
 */
function validateBatchTransactions(data) {
  const { error, value } = batchTransactionSchema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (!error) {
    return { error: null, value };
  }

  const formattedErrors = error.details.map((detail) => ({
    field: detail.path.join('.'),
    message: detail.message,
  }));

  return { error: formattedErrors, value };
}

module.exports = {
  transactionSchema,
  batchTransactionSchema,
  validateTransaction,
  validateBatchTransactions,
};
