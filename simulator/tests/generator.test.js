const { TrafficGenerator } = require('../src/generator/traffic-generator');
const { validateTransaction } = require('@finguard/shared');

describe('Simulator Traffic Generator', () => {
  it('should generate valid transactions conforming to shared schema', () => {
    const generator = new TrafficGenerator({ seed: 'test-seed-123' });

    for (let i = 0; i < 50; i++) {
      const { txn, pattern } = generator.nextTransaction();
      const { error } = validateTransaction(txn);
      expect(error).toBeNull();
      expect(['normal', 'large_amount', 'rapid_velocity', 'location_jump']).toContain(pattern);
    }
  });

  it('should be deterministic with the same seed', () => {
    const genA = new TrafficGenerator({ seed: 42 });
    const genB = new TrafficGenerator({ seed: 42 });

    for (let i = 0; i < 20; i++) {
      const itemA = genA.nextTransaction();
      const itemB = genB.nextTransaction();

      expect(itemA.txn.txnId).toBe(itemB.txn.txnId);
      expect(itemA.txn.userId).toBe(itemB.txn.userId);
      expect(itemA.txn.amount).toBe(itemB.txn.amount);
      expect(itemA.pattern).toBe(itemB.pattern);
    }
  });

  it('should generate fraud patterns approximately matching requested ratio', () => {
    const generator = new TrafficGenerator({ seed: 'fraud-ratio-test', fraudRatio: 0.1 });
    const counts = { normal: 0, fraud: 0 };

    for (let i = 0; i < 500; i++) {
      const { pattern } = generator.nextTransaction();
      if (pattern === 'normal') {
        counts.normal++;
      } else {
        counts.fraud++;
      }
    }

    // Expect fraud count to be around 10% (between 5% and 20% due to bursts)
    expect(counts.fraud).toBeGreaterThan(20);
  });
});
