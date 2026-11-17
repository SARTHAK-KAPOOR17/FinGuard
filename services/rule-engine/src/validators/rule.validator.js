const Joi = require('joi');
const safeRegex = require('safe-regex2');

const RULE_TYPES = [
  'amount_threshold',
  'merchant_regex',
  'velocity',
  'geo_jump',
  'THRESHOLD',
  'REGEX',
  'VELOCITY',
  'GEO_DISTANCE',
];

const SEVERITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// Helper to validate and verify safety of regex patterns
const safeRegexExtension = (value, helpers) => {
  try {
    new RegExp(value);
  } catch (err) {
    return helpers.error('regex.invalid', { message: `Pattern compilation failed: ${err.message}` });
  }

  if (!safeRegex(value)) {
    return helpers.error('regex.catastrophic', {
      message: 'Regex pattern is prone to catastrophic backtracking (ReDoS)',
    });
  }

  return value;
};

// Type-specific config schemas (strictly structured, no code strings, no eval)
const amountThresholdConfigSchema = Joi.object({
  threshold: Joi.number().positive().required().messages({
    'number.positive': 'Threshold must be a strictly positive number',
    'any.required': 'Threshold is required for amount_threshold rules',
  }),
  currency: Joi.string().uppercase().length(3).default('USD'),
  operator: Joi.string().valid('>', '>=').default('>'),
}).unknown(false);

const merchantRegexConfigSchema = Joi.object({
  pattern: Joi.string()
    .min(1)
    .max(500)
    .required()
    .custom(safeRegexExtension)
    .messages({
      'any.required': 'Regex pattern is required for merchant_regex rules',
      'string.max': 'Regex pattern must not exceed 500 characters',
      'regex.invalid': '{{#message}}',
      'regex.catastrophic': 'Regex pattern is prone to catastrophic backtracking (ReDoS)',
    }),
}).unknown(false);

const velocityConfigSchema = Joi.object({
  windowSeconds: Joi.number().integer().min(1).max(86400).required().messages({
    'any.required': 'windowSeconds is required for velocity rules',
    'number.min': 'windowSeconds must be at least 1 second',
    'number.max': 'windowSeconds must not exceed 86400 seconds (24h)',
  }),
  maxAllowed: Joi.number().integer().min(1).max(100000).required().messages({
    'any.required': 'maxAllowed is required for velocity rules',
    'number.min': 'maxAllowed must be at least 1 transaction',
  }),
}).unknown(false);

const geoJumpConfigSchema = Joi.object({
  maxSpeedKmh: Joi.number().positive().min(1).max(50000).default(900),
  minDistanceKm: Joi.number().min(0).max(40000).default(100),
  countryChangeMinSeconds: Joi.number().integer().min(0).max(86400).default(300),
}).unknown(false);

/**
 * Validates payload for POST /rules (Creation)
 */
function validateCreateRule(payload) {
  const baseSchema = Joi.object({
    ruleId: Joi.string()
      .pattern(/^[A-Za-z0-9_-]{3,64}$/)
      .required()
      .messages({
        'string.pattern.base': 'ruleId must be 3-64 alphanumeric characters, underscores, or hyphens',
        'any.required': 'ruleId is required',
      }),
    name: Joi.string().trim().min(3).max(100).required(),
    description: Joi.string().trim().max(500).allow('').optional(),
    type: Joi.string()
      .valid(...RULE_TYPES)
      .required()
      .messages({
        'any.only': `type must be one of: ${RULE_TYPES.join(', ')}`,
        'any.required': 'type is required',
      }),
    severity: Joi.string()
      .valid(...SEVERITY_LEVELS)
      .default('HIGH'),
    enabled: Joi.boolean().default(true),
    config: Joi.object().required().messages({
      'any.required': 'config object is required',
    }),
  });

  const { error: baseError, value: baseVal } = baseSchema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (baseError) {
    return { error: baseError.details.map((d) => d.message) };
  }

  // Type-specific config validation
  const normalizedType = baseVal.type.toUpperCase();
  let configSchema;

  if (normalizedType === 'AMOUNT_THRESHOLD' || normalizedType === 'THRESHOLD') {
    configSchema = amountThresholdConfigSchema;
  } else if (normalizedType === 'MERCHANT_REGEX' || normalizedType === 'REGEX') {
    configSchema = merchantRegexConfigSchema;
  } else if (normalizedType === 'VELOCITY') {
    configSchema = velocityConfigSchema;
  } else if (normalizedType === 'GEO_JUMP' || normalizedType === 'GEO_DISTANCE') {
    configSchema = geoJumpConfigSchema;
  }

  if (configSchema) {
    const { error: cfgErr, value: validatedConfig } = configSchema.validate(baseVal.config, {
      abortEarly: false,
    });
    if (cfgErr) {
      return { error: cfgErr.details.map((d) => d.message) };
    }
    baseVal.config = validatedConfig;
  }

  return { value: baseVal, error: null };
}

/**
 * Validates payload for PUT /rules/:id (Update)
 */
function validateUpdateRule(payload, ruleType = null) {
  const updateSchema = Joi.object({
    name: Joi.string().trim().min(3).max(100).optional(),
    description: Joi.string().trim().max(500).allow('').optional(),
    type: Joi.string().valid(...RULE_TYPES).optional(),
    severity: Joi.string().valid(...SEVERITY_LEVELS).optional(),
    enabled: Joi.boolean().optional(),
    config: Joi.object().optional(),
    threshold: Joi.number().positive().optional(), // Convenience for quick threshold update
  });

  const { error: baseError, value: validatedVal } = updateSchema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (baseError) {
    return { error: baseError.details.map((d) => d.message) };
  }

  const effectiveType = (validatedVal.type || ruleType || '').toUpperCase();

  if (validatedVal.config && typeof validatedVal.config === 'object') {
    let configSchema;
    if (effectiveType === 'AMOUNT_THRESHOLD' || effectiveType === 'THRESHOLD') {
      configSchema = amountThresholdConfigSchema;
    } else if (effectiveType === 'MERCHANT_REGEX' || effectiveType === 'REGEX') {
      configSchema = merchantRegexConfigSchema;
    } else if (effectiveType === 'VELOCITY') {
      configSchema = velocityConfigSchema;
    } else if (effectiveType === 'GEO_JUMP' || effectiveType === 'GEO_DISTANCE') {
      configSchema = geoJumpConfigSchema;
    }

    if (configSchema) {
      const { error: cfgErr, value: validatedConfig } = configSchema.validate(validatedVal.config, {
        abortEarly: false,
      });
      if (cfgErr) {
        return { error: cfgErr.details.map((d) => d.message) };
      }
      validatedVal.config = validatedConfig;
    }
  }

  return { value: validatedVal, error: null };
}

module.exports = {
  validateCreateRule,
  validateUpdateRule,
  RULE_TYPES,
  SEVERITY_LEVELS,
};
