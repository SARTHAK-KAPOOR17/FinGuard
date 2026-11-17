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
            severity: 'HIGH',
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
});
