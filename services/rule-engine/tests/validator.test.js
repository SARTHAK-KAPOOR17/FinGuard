const {
  validateCreateRule,
  validateUpdateRule,
} = require('../src/validators/rule.validator');

describe('Rule Joi Validation & Regex Safety Checks', () => {
  describe('amount_threshold validation', () => {
    it('should accept valid amount_threshold rule', () => {
      const payload = {
        ruleId: 'RULE_AMT_TEST',
        name: 'Amount Threshold Test',
        type: 'amount_threshold',
        severity: 'HIGH',
        config: {
          threshold: 5000,
          currency: 'USD',
          operator: '>',
        },
      };
      const { error, value } = validateCreateRule(payload);
      expect(error).toBeNull();
      expect(value.config.threshold).toBe(5000);
      expect(value.config.currency).toBe('USD');
    });

    it('should reject non-positive threshold', () => {
      const payload = {
        ruleId: 'RULE_AMT_TEST',
        name: 'Amount Threshold Test',
        type: 'amount_threshold',
        config: { threshold: -50 },
      };
      const { error } = validateCreateRule(payload);
      expect(error).not.toBeNull();
      expect(error.some((msg) => msg.includes('positive'))).toBe(true);
    });

    it('should reject arbitrary injected fields in config (no code strings)', () => {
      const payload = {
        ruleId: 'RULE_INJECT_TEST',
        name: 'Code Injection Attempt',
        type: 'amount_threshold',
        config: {
          threshold: 1000,
          evalCode: 'process.exit(1)', // Disallowed unknown key
        },
      };
      const { error } = validateCreateRule(payload);
      expect(error).not.toBeNull();
      expect(error.some((msg) => msg.includes('not allowed'))).toBe(true);
    });
  });

  describe('merchant_regex validation & ReDoS protection', () => {
    it('should accept safe compiled regex pattern', () => {
      const payload = {
        ruleId: 'RULE_REGEX_SAFE',
        name: 'Safe Merchant Regex',
        type: 'merchant_regex',
        severity: 'CRITICAL',
        config: {
          pattern: '(Rolex|Gucci|Diamond Exchange)',
        },
      };
      const { error, value } = validateCreateRule(payload);
      expect(error).toBeNull();
      expect(value.config.pattern).toBe('(Rolex|Gucci|Diamond Exchange)');
    });

    it('should reject uncompilable regex pattern', () => {
      const payload = {
        ruleId: 'RULE_REGEX_INVALID',
        name: 'Invalid Regex',
        type: 'merchant_regex',
        config: {
          pattern: '[unclosed-bracket',
        },
      };
      const { error } = validateCreateRule(payload);
      expect(error).not.toBeNull();
      expect(error.some((msg) => msg.includes('compilation failed'))).toBe(true);
    });

    it('should reject catastrophic backtracking / ReDoS vulnerable regex', () => {
      const payload = {
        ruleId: 'RULE_REGEX_REDOS',
        name: 'Dangerous ReDoS Regex',
        type: 'merchant_regex',
        config: {
          pattern: '(a+)+$', // Classic exponential ReDoS pattern
        },
      };
      const { error } = validateCreateRule(payload);
      expect(error).not.toBeNull();
      expect(error.some((msg) => msg.includes('catastrophic backtracking'))).toBe(true);
    });
  });

  describe('velocity validation', () => {
    it('should accept valid velocity config', () => {
      const payload = {
        ruleId: 'RULE_VEL_VALID',
        name: 'Velocity Valid',
        type: 'velocity',
        config: {
          windowSeconds: 15,
          maxAllowed: 10,
        },
      };
      const { error, value } = validateCreateRule(payload);
      expect(error).toBeNull();
      expect(value.config.windowSeconds).toBe(15);
      expect(value.config.maxAllowed).toBe(10);
    });

    it('should reject invalid windowSeconds (<= 0)', () => {
      const payload = {
        ruleId: 'RULE_VEL_INVALID',
        name: 'Velocity Invalid',
        type: 'velocity',
        config: {
          windowSeconds: 0,
          maxAllowed: 5,
        },
      };
      const { error } = validateCreateRule(payload);
      expect(error).not.toBeNull();
    });
  });

  describe('geo_jump validation', () => {
    it('should accept valid geo_jump config with defaults', () => {
      const payload = {
        ruleId: 'RULE_GEO_VALID',
        name: 'Geo Jump Valid',
        type: 'geo_jump',
        config: {
          maxSpeedKmh: 1200,
        },
      };
      const { error, value } = validateCreateRule(payload);
      expect(error).toBeNull();
      expect(value.config.maxSpeedKmh).toBe(1200);
      expect(value.config.minDistanceKm).toBe(100);
    });
  });

  describe('Severity enum validation', () => {
    it('should only accept LOW, MEDIUM, HIGH, CRITICAL', () => {
      const payload = {
        ruleId: 'RULE_SEV_TEST',
        name: 'Severity Test',
        type: 'amount_threshold',
        severity: 'SUPER_URGENT', // Invalid enum
        config: { threshold: 100 },
      };
      const { error } = validateCreateRule(payload);
      expect(error).not.toBeNull();
    });
  });
});
