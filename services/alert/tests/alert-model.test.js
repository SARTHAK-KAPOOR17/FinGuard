const {
  Alert,
  getHighestSeverity,
  SEVERITY_ENUM,
  STATUS_ENUM,
} = require('../src/models/alert.model');

describe('Alert Model & Severity Resolution', () => {
  describe('getHighestSeverity()', () => {
    it('should return LOW for empty or invalid rules array', () => {
      expect(getHighestSeverity([])).toBe('LOW');
      expect(getHighestSeverity(null)).toBe('LOW');
      expect(getHighestSeverity(undefined)).toBe('LOW');
    });

    it('should return correct severity for single rule', () => {
      expect(getHighestSeverity([{ severity: 'LOW' }])).toBe('LOW');
      expect(getHighestSeverity([{ severity: 'MEDIUM' }])).toBe('MEDIUM');
      expect(getHighestSeverity([{ severity: 'HIGH' }])).toBe('HIGH');
      expect(getHighestSeverity([{ severity: 'CRITICAL' }])).toBe('CRITICAL');
    });

    it('should resolve highest severity according to priority CRITICAL > HIGH > MEDIUM > LOW', () => {
      // LOW and MEDIUM -> MEDIUM
      expect(
        getHighestSeverity([
          { severity: 'LOW' },
          { severity: 'MEDIUM' },
        ])
      ).toBe('MEDIUM');

      // LOW and HIGH -> HIGH
      expect(
        getHighestSeverity([
          { severity: 'LOW' },
          { severity: 'HIGH' },
        ])
      ).toBe('HIGH');

      // MEDIUM and CRITICAL -> CRITICAL
      expect(
        getHighestSeverity([
          { severity: 'MEDIUM' },
          { severity: 'CRITICAL' },
          { severity: 'HIGH' },
        ])
      ).toBe('CRITICAL');

      // Case insensitivity
      expect(
        getHighestSeverity([
          { severity: 'medium' },
          { severity: 'critical' },
        ])
      ).toBe('CRITICAL');
    });
  });

  describe('Alert Mongoose Model Validation', () => {
    it('should instantiate a valid alert document with defaults', () => {
      const doc = new Alert({
        txnId: '802da9fa-0722-4114-88f5-fa521f37e401',
        flaggedId: 'e86b3e70-22c5-4d04-bfda-99da433f0e00',
        userId: 'usr_test_123',
        amount: 15000,
        currency: 'USD',
        merchant: 'Rolex Boutique',
        deviceId: 'dev_test_456',
        timestamp: new Date(),
        matchedRules: [
          {
            ruleId: 'RULE_LARGE_AMOUNT',
            ruleName: 'High Transaction Amount',
            severity: 'HIGH',
            reason: 'Amount exceeds threshold',
          },
        ],
        riskScore: 75,
        severity: 'HIGH',
      });

      const err = doc.validateSync();
      expect(err).toBeUndefined();
      expect(doc.status).toBe('OPEN');
      expect(doc.alertId).toBeDefined();
      expect(doc.notes).toEqual([]);
    });

    it('should reject invalid severity enum', () => {
      const doc = new Alert({
        txnId: 'txn-invalid-sev',
        flaggedId: 'flag-1',
        userId: 'usr-1',
        amount: 100,
        currency: 'USD',
        merchant: 'Test',
        deviceId: 'dev-1',
        timestamp: new Date(),
        matchedRules: [{ ruleId: 'R1', ruleName: 'N1', severity: 'LOW', reason: 'r' }],
        riskScore: 25,
        severity: 'ULTRA_HIGH', // Invalid
      });

      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors['severity']).toBeDefined();
    });

    it('should reject invalid status enum', () => {
      const doc = new Alert({
        txnId: 'txn-invalid-status',
        flaggedId: 'flag-1',
        userId: 'usr-1',
        amount: 100,
        currency: 'USD',
        merchant: 'Test',
        deviceId: 'dev-1',
        timestamp: new Date(),
        matchedRules: [{ ruleId: 'R1', ruleName: 'N1', severity: 'LOW', reason: 'r' }],
        riskScore: 25,
        severity: 'LOW',
        status: 'UNKNOWN_STATUS', // Invalid
      });

      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors['status']).toBeDefined();
    });

    it('should reject empty matchedRules array', () => {
      const doc = new Alert({
        txnId: 'txn-empty-rules',
        flaggedId: 'flag-1',
        userId: 'usr-1',
        amount: 100,
        currency: 'USD',
        merchant: 'Test',
        deviceId: 'dev-1',
        timestamp: new Date(),
        matchedRules: [], // Empty
        riskScore: 25,
        severity: 'LOW',
      });

      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors['matchedRules']).toBeDefined();
    });
  });
});
