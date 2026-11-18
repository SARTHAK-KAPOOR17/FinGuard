const { RuleEvaluator } = require('../src/engine/evaluator');
const { SEED_RULES } = require('../src/rules/seed-rules');

describe('RuleEvaluator & Stateful Rules', () => {
  let evaluator;
  let mockRedis;

  beforeEach(() => {
    evaluator = new RuleEvaluator(SEED_RULES);
    mockRedis = {
      pipeline: jest.fn().mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 1],
          [null, 1], // default count = 1
          [null, 1],
        ]),
      }),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
  });

  const baseTxn = {
    txnId: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'usr_0001',
    amount: 150.0,
    currency: 'USD',
    merchant: 'Starbucks Coffee',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.006 },
    deviceId: 'dev_test_1',
    timestamp: new Date().toISOString(),
  };

  it('should not flag a normal transaction under $10,000 at normal merchant', async () => {
    const result = await evaluator.evaluate(baseTxn, { redis: mockRedis });
    expect(result.isFlagged).toBe(false);
    expect(result.matchedRules).toHaveLength(0);
    expect(result.riskScore).toBe(0);
  });

  it('should flag a transaction strictly greater than $10,000 USD (RULE_LARGE_AMOUNT)', async () => {
    const largeTxn = { ...baseTxn, amount: 15000.0 };
    const result = await evaluator.evaluate(largeTxn, { redis: mockRedis });

    expect(result.isFlagged).toBe(true);
    expect(result.matchedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'RULE_LARGE_AMOUNT',
          severity: 'HIGH',
        }),
      ])
    );
  });

  it('should flag transactions matching suspicious merchant patterns (RULE_SUSPICIOUS_MERCHANT)', async () => {
    const suspiciousTxn = { ...baseTxn, merchant: 'Rolex Boutique 5th Ave' };
    const result = await evaluator.evaluate(suspiciousTxn, { redis: mockRedis });

    expect(result.isFlagged).toBe(true);
    expect(result.matchedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'RULE_SUSPICIOUS_MERCHANT',
          severity: 'CRITICAL',
        }),
      ])
    );
  });

  describe('RULE_VELOCITY (Sliding Window in Redis)', () => {
    it('should not flag when transaction count is within threshold (<= 5)', async () => {
      mockRedis.pipeline.mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 1],
          [null, 3], // count = 3
          [null, 1],
        ]),
      });

      const result = await evaluator.evaluate(baseTxn, { redis: mockRedis });
      const velocityRule = result.matchedRules.find((r) => r.ruleId === 'RULE_VELOCITY');
      expect(velocityRule).toBeUndefined();
    });

    it('should flag when transaction count exceeds threshold (> 5 in 10s)', async () => {
      mockRedis.pipeline.mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 0],
          [null, 1],
          [null, 6], // count = 6 (> 5)
          [null, 1],
        ]),
      });

      const result = await evaluator.evaluate(baseTxn, { redis: mockRedis });
      expect(result.isFlagged).toBe(true);
      expect(result.matchedRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'RULE_VELOCITY',
            severity: 'MEDIUM',
          }),
        ])
      );
    });
  });

  describe('RULE_LOCATION_JUMP (Impossible Travel & Geo Distance)', () => {
    it('should NOT flag the first transaction of a user (no previous location in Redis)', async () => {
      mockRedis.get.mockResolvedValue(null); // No prior record

      const result = await evaluator.evaluate(baseTxn, { redis: mockRedis });
      const geoRule = result.matchedRules.find((r) => r.ruleId === 'RULE_LOCATION_JUMP');
      expect(geoRule).toBeUndefined();
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
    });

    it('should NOT flag normal travel within reasonable speed limits', async () => {
      // Prior location: 1 hour ago, 20 km away
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          city: 'White Plains',
          country: 'USA',
          lat: 41.0339,
          lng: -73.7629,
          timestamp: oneHourAgo,
          nowMs: Date.now() - 3600000,
        })
      );

      const result = await evaluator.evaluate(baseTxn, { redis: mockRedis });
      const geoRule = result.matchedRules.find((r) => r.ruleId === 'RULE_LOCATION_JUMP');
      expect(geoRule).toBeUndefined();
    });

    it('should flag impossible travel jump (New York to Tokyo in 2 seconds)', async () => {
      // Prior location: New York, 2 seconds ago
      const twoSecondsAgo = new Date(Date.now() - 2000).toISOString();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          city: 'New York',
          country: 'USA',
          lat: 40.7128,
          lng: -74.006,
          timestamp: twoSecondsAgo,
          nowMs: Date.now() - 2000,
        })
      );

      // Current location: Tokyo, Japan
      const tokyoTxn = {
        ...baseTxn,
        location: {
          city: 'Tokyo',
          country: 'Japan',
          lat: 35.6762,
          lng: 139.6503,
        },
      };

      const result = await evaluator.evaluate(tokyoTxn, { redis: mockRedis });
      expect(result.isFlagged).toBe(true);
      expect(result.matchedRules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'RULE_LOCATION_JUMP',
            severity: 'CRITICAL',
          }),
        ])
      );
    });
  });

  describe('RiskScore Scaling by Severity', () => {
    it('should assign riskScore=25 for LOW severity', async () => {
      const lowEvaluator = new RuleEvaluator([
        {
          ruleId: 'RULE_LOW_TEST',
          name: 'Low Rule',
          type: 'THRESHOLD',
          severity: 'LOW',
          enabled: true,
          config: { threshold: 100 },
        },
      ]);
      const res = await lowEvaluator.evaluate({ ...baseTxn, amount: 200 });
      expect(res.riskScore).toBe(25);
    });

    it('should assign riskScore=50 for MEDIUM severity', async () => {
      const medEvaluator = new RuleEvaluator([
        {
          ruleId: 'RULE_MED_TEST',
          name: 'Medium Rule',
          type: 'THRESHOLD',
          severity: 'MEDIUM',
          enabled: true,
          config: { threshold: 100 },
        },
      ]);
      const res = await medEvaluator.evaluate({ ...baseTxn, amount: 200 });
      expect(res.riskScore).toBe(50);
    });

    it('should assign riskScore=75 for HIGH severity', async () => {
      const highEvaluator = new RuleEvaluator([
        {
          ruleId: 'RULE_HIGH_TEST',
          name: 'High Rule',
          type: 'THRESHOLD',
          severity: 'HIGH',
          enabled: true,
          config: { threshold: 100 },
        },
      ]);
      const res = await highEvaluator.evaluate({ ...baseTxn, amount: 200 });
      expect(res.riskScore).toBe(75);
    });

    it('should assign riskScore=90 for CRITICAL severity', async () => {
      const critEvaluator = new RuleEvaluator([
        {
          ruleId: 'RULE_CRIT_TEST',
          name: 'Critical Rule',
          type: 'THRESHOLD',
          severity: 'CRITICAL',
          enabled: true,
          config: { threshold: 100 },
        },
      ]);
      const res = await critEvaluator.evaluate({ ...baseTxn, amount: 200 });
      expect(res.riskScore).toBe(90);
    });

    it('should add bonus for multiple matched rules, capped at 100', async () => {
      const multiEvaluator = new RuleEvaluator([
        {
          ruleId: 'RULE_CRIT_TEST',
          name: 'Critical Rule',
          type: 'THRESHOLD',
          severity: 'CRITICAL',
          enabled: true,
          config: { threshold: 100 },
        },
        {
          ruleId: 'RULE_HIGH_TEST',
          name: 'High Rule',
          type: 'REGEX',
          severity: 'HIGH',
          enabled: true,
          config: { pattern: 'Starbucks' },
        },
      ]);
      const res = await multiEvaluator.evaluate({ ...baseTxn, amount: 200, merchant: 'Starbucks Coffee' });
      // CRITICAL (90) + 1 extra rule (5) = 95
      expect(res.riskScore).toBe(95);
    });
  });

  describe('Rule Type Aliases & Evaluation (amount_threshold, merchant_regex, velocity, geo_jump)', () => {
    it('amount_threshold: match (> threshold) and no-match (<= threshold)', async () => {
      const ev = new RuleEvaluator([
        {
          ruleId: 'AMT_ALIAS',
          name: 'Amount Threshold Alias',
          type: 'amount_threshold',
          severity: 'HIGH',
          enabled: true,
          config: { threshold: 500, currency: 'USD' },
        },
      ]);

      const noMatch = await ev.evaluate({ ...baseTxn, amount: 499.99 });
      expect(noMatch.isFlagged).toBe(false);

      const match = await ev.evaluate({ ...baseTxn, amount: 500.01 });
      expect(match.isFlagged).toBe(true);
      expect(match.matchedRules[0].ruleId).toBe('AMT_ALIAS');
    });

    it('merchant_regex: match and no-match', async () => {
      const ev = new RuleEvaluator([
        {
          ruleId: 'MERCHANT_ALIAS',
          name: 'Merchant Regex Alias',
          type: 'merchant_regex',
          severity: 'CRITICAL',
          enabled: true,
          config: { pattern: '(Crypto|Offshore)' },
        },
      ]);

      const noMatch = await ev.evaluate({ ...baseTxn, merchant: 'Apple Store' });
      expect(noMatch.isFlagged).toBe(false);

      const match = await ev.evaluate({ ...baseTxn, merchant: 'Offshore Exchange' });
      expect(match.isFlagged).toBe(true);
      expect(match.matchedRules[0].ruleId).toBe('MERCHANT_ALIAS');
    });

    it('velocity: match and no-match', async () => {
      const ev = new RuleEvaluator([
        {
          ruleId: 'VEL_ALIAS',
          name: 'Velocity Alias',
          type: 'velocity',
          severity: 'HIGH',
          enabled: true,
          config: { windowSeconds: 10, maxAllowed: 3 },
        },
      ]);

      // Mock count = 2 (no-match)
      mockRedis.pipeline.mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 2], [null, 1]]),
      });
      const noMatch = await ev.evaluate(baseTxn, { redis: mockRedis });
      expect(noMatch.isFlagged).toBe(false);

      // Mock count = 4 (match)
      mockRedis.pipeline.mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 4], [null, 1]]),
      });
      const match = await ev.evaluate(baseTxn, { redis: mockRedis });
      expect(match.isFlagged).toBe(true);
      expect(match.matchedRules[0].ruleId).toBe('VEL_ALIAS');
    });

    it('geo_jump: match and no-match', async () => {
      const ev = new RuleEvaluator([
        {
          ruleId: 'GEO_ALIAS',
          name: 'Geo Jump Alias',
          type: 'geo_jump',
          severity: 'CRITICAL',
          enabled: true,
          config: { maxSpeedKmh: 900, minDistanceKm: 100 },
        },
      ]);

      // No prior location -> no-match
      mockRedis.get.mockResolvedValue(null);
      const noMatch = await ev.evaluate(baseTxn, { redis: mockRedis });
      expect(noMatch.isFlagged).toBe(false);

      // Distant jump 1 second ago -> match
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          city: 'London',
          country: 'UK',
          lat: 51.5074,
          lng: -0.1278,
          timestamp: new Date(Date.now() - 1000).toISOString(),
          nowMs: Date.now() - 1000,
        })
      );
      const match = await ev.evaluate(baseTxn, { redis: mockRedis });
      expect(match.isFlagged).toBe(true);
      expect(match.matchedRules[0].ruleId).toBe('GEO_ALIAS');
    });
  });
});
