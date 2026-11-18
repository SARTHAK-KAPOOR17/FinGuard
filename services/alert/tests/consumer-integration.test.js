const crypto = require('crypto');
const { AlertConsumerService } = require('../src/services/alert-consumer.service');
const { connectMongo, disconnectMongo } = require('../src/database/mongo');
const { Alert } = require('../src/models/alert.model');

describe('AlertConsumerService - Real MongoDB Integration & Idempotency', () => {
  let mockConsumer;
  let mockWsService;
  let consumerService;
  const testTxnId = crypto.randomUUID();

  beforeAll(async () => {
    await connectMongo();

    mockConsumer = {
      connect: jest.fn().mockResolvedValue(),
      subscribe: jest.fn().mockResolvedValue(),
      run: jest.fn().mockResolvedValue(),
      commitOffsets: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
    };

    mockWsService = {
      broadcastAlert: jest.fn(),
    };

    // Instantiate consumer using REAL persistence service (default)
    consumerService = new AlertConsumerService({
      consumer: mockConsumer,
      wsService: mockWsService,
    });
  });

  afterAll(async () => {
    await Alert.deleteMany({ txnId: testTxnId }).catch(() => {});
    await disconnectMongo();
  });

  it('should persist new alert to real MongoDB, trigger WS broadcast, and commit offset', async () => {
    const rawPayload = {
      flaggedId: crypto.randomUUID(),
      txnId: testTxnId,
      userId: 'usr_integ_test',
      amount: 14500,
      currency: 'USD',
      merchant: 'Diamond Exchange Zurich',
      location: { city: 'Zurich', country: 'CH', lat: 47.37, lng: 8.54 },
      deviceId: 'dev_integ_1',
      timestamp: new Date().toISOString(),
      flaggedAt: new Date().toISOString(),
      matchedRules: [
        {
          ruleId: 'RULE_LARGE_AMOUNT',
          ruleName: 'High Amount',
          severity: 'HIGH',
          reason: 'Amount > 10000',
        },
      ],
      riskScore: 75,
    };

    const message = {
      offset: '100',
      value: Buffer.from(JSON.stringify(rawPayload)),
    };

    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message,
    });

    // 1. Verify in real MongoDB
    const doc = await Alert.findOne({ txnId: testTxnId });
    expect(doc).toBeDefined();
    expect(doc.amount).toBe(14500);
    expect(doc.severity).toBe('HIGH');
    expect(doc.status).toBe('OPEN');

    // 2. Verify WebSocket broadcast was invoked
    expect(mockWsService.broadcastAlert).toHaveBeenCalledTimes(1);

    // 3. Verify offset committed
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '101' },
    ]);
  });

  it('should process duplicate message with identical txnId without duplicating in Mongo or broadcasting to WS', async () => {
    const duplicatePayload = {
      flaggedId: crypto.randomUUID(),
      txnId: testTxnId, // IDENTICAL txnId
      userId: 'usr_integ_test',
      amount: 14500,
      currency: 'USD',
      merchant: 'Diamond Exchange Zurich',
      matchedRules: [{ ruleId: 'RULE_LARGE_AMOUNT', ruleName: 'High Amount', severity: 'HIGH', reason: 'exceeds $10k' }],
      riskScore: 75,
    };

    const duplicateMessage = {
      offset: '101',
      value: Buffer.from(JSON.stringify(duplicatePayload)),
    };

    // Reset mock tracking before sending duplicate
    mockWsService.broadcastAlert.mockClear();
    mockConsumer.commitOffsets.mockClear();

    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message: duplicateMessage,
    });

    // 1. Verify MongoDB still has exactly 1 record for this txnId
    const count = await Alert.countDocuments({ txnId: testTxnId });
    expect(count).toBe(1);

    // 2. Verify WebSocket broadcast was NOT invoked on duplicate
    expect(mockWsService.broadcastAlert).not.toHaveBeenCalled();

    // 3. Verify offset WAS still committed
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '102' },
    ]);

    const metrics = consumerService.getMetrics();
    expect(metrics.flaggedPersistedCount).toBe(1);
    expect(metrics.duplicateSkippedCount).toBe(1);
  });
});
