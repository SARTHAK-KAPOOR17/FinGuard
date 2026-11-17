const { RuleEvaluator } = require('../src/engine/evaluator');

describe('RuleEvaluator & Seed Rules', () => {
  let evaluator;

  beforeEach(() => {
    evaluator = new RuleEvaluator();
  });

  const baseTxn = {
    txnId: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'usr_0001',
    amount: 150.00,
    currency: 'USD',
    merchant: 'Starbucks Coffee',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.0060 },
    deviceId: 'dev_test_1',
    timestamp: new Date().toISOString(),
  };

  it('should not flag a normal transaction under $10,000 at normal merchant', () => {
    const result = evaluator.evaluate(baseTxn);
    expect(result.isFlagged).toBe(false);
    expect(result.matchedRules).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it('should flag a transaction strictly greater than $10,000 USD (RULE_LARGE_AMOUNT)', () => {
    const largeTxn = { ...baseTxn, amount: 15000.00 };
    const result = evaluator.evaluate(largeTxn);

    expect(result.isFlagged).toBe(true);
    expect(result.matchedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'RULE_LARGE_AMOUNT',
          severity: 'HIGH',
        }),
      ])
    );
    expect(result.riskScore).toBeGreaterThanOrEqual(50);
  });

  it('should not flag a transaction with amount exactly $10,000.00', () => {
    const exactTxn = { ...baseTxn, amount: 10000.00 };
    const result = evaluator.evaluate(exactTxn);
    expect(result.isFlagged).toBe(false);
  });

  it('should flag transactions matching suspicious merchant patterns (RULE_SUSPICIOUS_MERCHANT)', () => {
    const suspiciousMerchants = [
      'Rolex Boutique 5th Ave',
      'Private Jet Charter Global',
      'Diamond Exchange Zurich',
      'Offshore Crypto OTC desk',
      'Luxury Motors Geneva showroom',
      'High Stakes Casino VIP lounge',
    ];

    for (const merchant of suspiciousMerchants) {
      const suspiciousTxn = { ...baseTxn, merchant };
      const result = evaluator.evaluate(suspiciousTxn);

      expect(result.isFlagged).toBe(true);
      expect(result.matchedRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'RULE_SUSPICIOUS_MERCHANT',
            severity: 'CRITICAL',
          }),
        ])
      );
    }
  });

  it('should accumulate riskScore and match multiple rules when both trigger', () => {
    const dualFraudTxn = {
      ...baseTxn,
      amount: 45000.00,
      merchant: 'Rolex Boutique Beverly Hills',
    };

    const result = evaluator.evaluate(dualFraudTxn);
    expect(result.isFlagged).toBe(true);
    expect(result.matchedRules).toHaveLength(2);
    expect(result.riskScore).toBe(85); // 50 (CRITICAL) + 35 (HIGH)
  });

  it('should skip disabled rules during evaluation', () => {
    evaluator.setRuleEnabled('RULE_LARGE_AMOUNT', false);

    const largeTxn = { ...baseTxn, amount: 25000.00 };
    const result = evaluator.evaluate(largeTxn);

    expect(result.isFlagged).toBe(false);
    expect(result.matchedRules).toHaveLength(0);
  });
});
