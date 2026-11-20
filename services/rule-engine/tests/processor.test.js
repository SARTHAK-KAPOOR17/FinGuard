const { RuleEvaluator } = require('../src/engine/evaluator');
const { SEED_RULES } = require('../src/rules/seed-rules');
const { validateFlaggedEvent } = require('@finguard/shared');

describe('Rule Processor Stream Processing', () => {
  let mockProducer;
  let mockConsumer;
  let mockRedis;
  let processor;
  let capturedEachMessageHandler;

  const validNormalTxn = {
    txnId: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'usr_clean_101',
    amount: 85.50,
    currency: 'USD',
    merchant: 'Amazon',
    location: { city: 'Seattle', country: 'USA', lat: 47.6062, lng: -122.3321 },
    deviceId: 'dev_clean_1',
    timestamp: new Date().toISOString(),
  };

  const validFraudTxn = {
    txnId: '123e4567-e89b-12d3-a456-426614174001',
    userId: 'usr_fraud_202',
    amount: 25000.00,
    currency: 'USD',
    merchant: 'Rolex Boutique',
    location: { city: 'New York', country: 'USA', lat: 40.7128, lng: -74.0060 },
    deviceId: 'dev_fraud_2',
    timestamp: new Date().toISOString(),
  };

  beforeEach(() => {
    mockProducer = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      send: jest.fn().mockResolvedValue([{ topicName: 'transactions.flagged', partition: 0 }]),
      isConnected: jest.fn().mockReturnValue(true),
    };

    mockConsumer = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      subscribe: jest.fn().mockResolvedValue(),
      run: jest.fn().mockImplementation(async ({ eachMessage }) => {
        capturedEachMessageHandler = eachMessage;
      }),
      commitOffsets: jest.fn().mockResolvedValue(),
      isConnected: jest.fn().mockReturnValue(true),
    };

    mockRedis = {
      pipeline: jest.fn().mockReturnValue({
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        zcard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 0], [null, 1], [null, 1], [null, 1]]),
      }),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const ServiceClass = require('../src/services/rule-processor.service').constructor;
    processor = new ServiceClass({
      producer: mockProducer,
      consumer: mockConsumer,
      redisClient: mockRedis,
      evaluator: new RuleEvaluator(SEED_RULES),
    });
  });

  afterEach(async () => {
    await processor.stop();
  });

  it('should skip malformed non-object messages, commit offset, and not crash', async () => {
    await processor.start();
    const commitOffsetSpy = jest.fn().mockResolvedValue();

    await capturedEachMessageHandler({
      topic: 'transactions.raw',
      partition: 0,
      offset: '10',
      key: 'usr_unknown',
      value: null,
      commitOffset: commitOffsetSpy,
    });

    expect(commitOffsetSpy).toHaveBeenCalledTimes(1);
    expect(mockProducer.send).not.toHaveBeenCalled();
    expect(processor.getMetrics().totalMalformed).toBe(1);
  });

  it('should skip messages with invalid schema, commit offset, and not crash', async () => {
    await processor.start();
    const commitOffsetSpy = jest.fn().mockResolvedValue();

    await capturedEachMessageHandler({
      topic: 'transactions.raw',
      partition: 0,
      offset: '11',
      key: 'usr_invalid',
      value: { txnId: 'not-a-uuid', amount: -20 },
      commitOffset: commitOffsetSpy,
    });

    expect(commitOffsetSpy).toHaveBeenCalledTimes(1);
    expect(mockProducer.send).not.toHaveBeenCalled();
    expect(processor.getMetrics().totalMalformed).toBe(1);
  });

  it('should process clean transactions, not publish to flagged, and commit offset', async () => {
    await processor.start();
    const commitOffsetSpy = jest.fn().mockResolvedValue();

    await capturedEachMessageHandler({
      topic: 'transactions.raw',
      partition: 1,
      offset: '12',
      key: validNormalTxn.userId,
      value: validNormalTxn,
      commitOffset: commitOffsetSpy,
    });

    expect(mockProducer.send).not.toHaveBeenCalled();
    expect(commitOffsetSpy).toHaveBeenCalledTimes(1);
    expect(processor.getMetrics().totalClean).toBe(1);
    expect(processor.getMetrics().totalFlagged).toBe(0);
  });

  it('should flag fraud transactions, publish valid flaggedEvent, and commit offset (at-least-once)', async () => {
    await processor.start();
    const commitOffsetSpy = jest.fn().mockResolvedValue();

    await capturedEachMessageHandler({
      topic: 'transactions.raw',
      partition: 2,
      offset: '13',
      key: validFraudTxn.userId,
      value: validFraudTxn,
      commitOffset: commitOffsetSpy,
    });

    expect(mockProducer.send).toHaveBeenCalledTimes(1);
    const publishCall = mockProducer.send.mock.calls[0][0];
    expect(publishCall.topic).toBe('transactions.flagged');
    expect(publishCall.messages[0].key).toBe(validFraudTxn.userId);

    const flaggedEvent = publishCall.messages[0].value;
    expect(flaggedEvent).toHaveProperty('flaggedId');
    expect(flaggedEvent.txnId).toBe(validFraudTxn.txnId);
    expect(flaggedEvent.matchedRules.length).toBeGreaterThanOrEqual(1);
    expect(flaggedEvent.status).toBe('FLAGGED');

    const { error } = validateFlaggedEvent(flaggedEvent);
    expect(error).toBeNull();

    expect(commitOffsetSpy).toHaveBeenCalledTimes(1);
    expect(processor.getMetrics().totalFlagged).toBe(1);
  });

  it('should NOT commit offset if publishing flagged message fails (at-least-once guarantee)', async () => {
    mockProducer.send = jest.fn().mockRejectedValue(new Error('Broker unreachable'));
    await processor.start();
    const commitOffsetSpy = jest.fn().mockResolvedValue();

    await expect(
      capturedEachMessageHandler({
        topic: 'transactions.raw',
        partition: 0,
        offset: '14',
        key: validFraudTxn.userId,
        value: validFraudTxn,
        commitOffset: commitOffsetSpy,
      })
    ).rejects.toThrow('Broker unreachable');

    expect(commitOffsetSpy).not.toHaveBeenCalled();
    expect(processor.getMetrics().totalFlagged).toBe(0);
  });
});
