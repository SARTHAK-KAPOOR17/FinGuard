const Joi = require('joi');
const mongoose = require('mongoose');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * State Transition Matrix for Alert Lifecycle
 *
 * Rationales:
 * - OPEN -> INVESTIGATING, DISMISSED
 * - INVESTIGATING -> RESOLVED, DISMISSED, OPEN (unclaim/re-queue), INVESTIGATING (append notes)
 * - RESOLVED -> INVESTIGATING (reopened on dispute/chargeback; cannot jump to unassigned OPEN)
 * - DISMISSED -> INVESTIGATING (reopened on audit escalation; cannot jump to unassigned OPEN)
 */
const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  OPEN: ['INVESTIGATING', 'DISMISSED'],
  INVESTIGATING: ['RESOLVED', 'DISMISSED', 'OPEN', 'INVESTIGATING'],
  RESOLVED: ['INVESTIGATING'],
  DISMISSED: ['INVESTIGATING'],
});

function isAllowedStatusTransition(currentStatus, targetStatus) {
  if (currentStatus === targetStatus) return true;
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  return Array.isArray(allowed) && allowed.includes(targetStatus);
}

/**
 * Joi query schema for GET /alerts
 * Rejects unknown query parameters and non-scalar structures (NoSQL injection prevention)
 */
const getAlertsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string()
    .valid('createdAt', '-createdAt', 'riskScore', '-riskScore')
    .default('-createdAt'),
  severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
  status: Joi.string().valid('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'),
  userId: Joi.string().trim().max(100),
  ruleId: Joi.string().trim().max(100),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso(),
})
  .unknown(false)
  .custom((value, helpers) => {
    if (value.startDate && value.endDate && new Date(value.startDate) > new Date(value.endDate)) {
      return helpers.message('startDate must be less than or equal to endDate');
    }
    return value;
  });

/**
 * Validates ID param (must be UUID v4 string or 24-char Mongo ObjectId)
 */
function validateAlertId(id) {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  const isUUID = UUID_REGEX.test(trimmed);
  const isMongoId = mongoose.Types.ObjectId.isValid(trimmed) && trimmed.length === 24;
  return isUUID || isMongoId;
}

/**
 * Joi schema for PATCH /alerts/:id/status
 */
const updateStatusBodySchema = Joi.object({
  status: Joi.string().valid('OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED').required(),
  analyst: Joi.string().trim().min(2).max(100).required(),
  note: Joi.string().trim().max(2000).optional(),
}).unknown(false);

function validateGetAlertsQuery(query) {
  const { error, value } = getAlertsQuerySchema.validate(query, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (!error) return { error: null, value };

  const details = error.details.map((d) => d.message);
  return { error: details, value: null };
}

function validateUpdateStatusBody(body) {
  const { error, value } = updateStatusBodySchema.validate(body, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (!error) return { error: null, value };

  const details = error.details.map((d) => d.message);
  return { error: details, value: null };
}

module.exports = {
  ALLOWED_STATUS_TRANSITIONS,
  isAllowedStatusTransition,
  validateAlertId,
  validateGetAlertsQuery,
  validateUpdateStatusBody,
};
