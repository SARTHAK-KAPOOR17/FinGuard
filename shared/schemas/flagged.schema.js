const Joi = require('joi');
const { locationSchema } = require('./transaction.schema');

/**
 * Matched rule detail schema
 */
const matchedRuleSchema = Joi.object({
  ruleId: Joi.string().required(),
  ruleName: Joi.string().required(),
  severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').required(),
  reason: Joi.string().required(),
  metadata: Joi.object().unknown(true).optional(),
});

/**
 * Flagged transaction event schema published to `transactions.flagged`
 */
const flaggedEventSchema = Joi.object({
  flaggedId: Joi.string().uuid({ version: ['uuidv4', 'uuidv1', 'uuidv5'] }).required(),
  txnId: Joi.string().uuid({ version: ['uuidv4', 'uuidv1', 'uuidv5'] }).required(),
  userId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  currency: Joi.string().length(3).uppercase().required(),
  merchant: Joi.string().required(),
  location: locationSchema,
  deviceId: Joi.string().required(),
  timestamp: Joi.string().isoDate().required(),
  flaggedAt: Joi.string().isoDate().required(),
  matchedRules: Joi.array().items(matchedRuleSchema).min(1).required(),
  riskScore: Joi.number().min(0).max(100).required(),
  status: Joi.string().valid('FLAGGED').default('FLAGGED'),
});

function validateFlaggedEvent(data) {
  const { error, value } = flaggedEventSchema.validate(data, {
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
  matchedRuleSchema,
  flaggedEventSchema,
  validateFlaggedEvent,
};
