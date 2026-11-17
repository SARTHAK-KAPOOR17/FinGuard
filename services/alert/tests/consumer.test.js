const { AlertConsumerService } = require('../src/services/alert-consumer.service');

describe('AlertConsumerService - Stream Processing & Offset Commit Ordering', () => {
  let mockConsumer;
  let mockWsService;
  let mockPersistenceService;
  let consumerService;

  beforeEach(() => {
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

    mockPersistenceService = {
      upsertAlert: jest.fn(),
    };

    consumerService = new AlertConsumerService({
      consumer: mockConsumer,
      wsService: mockWsService,
      persistenceService: mockPersistenceService,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should persist new alert, broadcast to WebSocket, and commit offset on success', async () => {
    const fakeAlert = {
      alertId: 'alt-123',
      txnId: 'txn-123',
      severity: 'CRITICAL',
      amount: 50000,
    };

    mockPersistenceService.upsertAlert.mockResolvedValue({
      alert: fakeAlert,
      isNew: true,
    });

    const message = {
      offset: '42',
      value: Buffer.from(
        JSON.stringify({
          txnId: 'txn-123',
          userId: 'usr-1',
          amount: 50000,
          currency: 'USD',
          merchant: 'Rolex',
          deviceId: 'dev-1',
          timestamp: new Date().toISOString(),
          matchedRules: [{ ruleId: 'R1', ruleName: 'N1', severity: 'CRITICAL', reason: 'Large' }],
          riskScore: 90,
        })
      ),
    };

    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message,
    });

    expect(mockPersistenceService.upsertAlert).toHaveBeenCalledTimes(1);
    expect(mockWsService.broadcastAlert).toHaveBeenCalledWith(fakeAlert);
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '43' },
    ]);

    const metrics = consumerService.getMetrics();
    expect(metrics.flaggedPersistedCount).toBe(1);
    expect(metrics.duplicateSkippedCount).toBe(0);
    expect(metrics.poisonPillCount).toBe(0);
  });

  it('should NOT broadcast to WebSocket on duplicate alert (isNew=false), but STILL commit offset', async () => {
    const fakeExistingAlert = {
      alertId: 'alt-123',
      txnId: 'txn-123',
      severity: 'HIGH',
      status: 'INVESTIGATING',
    };

    mockPersistenceService.upsertAlert.mockResolvedValue({
      alert: fakeExistingAlert,
      isNew: false, // Duplicate
    });

    const message = {
      offset: '43',
      value: Buffer.from(
        JSON.stringify({
          txnId: 'txn-123',
          amount: 50000,
          timestamp: new Date().toISOString(),
        })
      ),
    };

    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message,
    });

    expect(mockPersistenceService.upsertAlert).toHaveBeenCalledTimes(1);
    expect(mockWsService.broadcastAlert).not.toHaveBeenCalled();
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '44' },
    ]);

    const metrics = consumerService.getMetrics();
    expect(metrics.flaggedPersistedCount).toBe(0);
    expect(metrics.duplicateSkippedCount).toBe(1);
  });

  it('should handle poison pills (malformed JSON): skip persistence and commit offset to avoid partition block', async () => {
    const malformedMessage = {
      offset: '44',
      value: Buffer.from('{ corrupt-non-json'),
    };

    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message: malformedMessage,
    });

    expect(mockPersistenceService.upsertAlert).not.toHaveBeenCalled();
    expect(mockWsService.broadcastAlert).not.toHaveBeenCalled();
    // Offset must still be committed
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '45' },
    ]);

    const metrics = consumerService.getMetrics();
    expect(metrics.poisonPillCount).toBe(1);
  });

  it('should handle payloads missing txnId: skip persistence and commit offset', async () => {
    const invalidMessage = {
      offset: '45',
      value: Buffer.from(JSON.stringify({ amount: 100 })), // missing txnId
    };

    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message: invalidMessage,
    });

    expect(mockPersistenceService.upsertAlert).not.toHaveBeenCalled();
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '46' },
    ]);
    expect(consumerService.getMetrics().poisonPillCount).toBe(1);
  });

  it('should NOT commit offset if MongoDB persistence throws an error (at-least-once guarantee)', async () => {
    mockPersistenceService.upsertAlert.mockRejectedValue(new Error('Mongo connection lost'));

    const message = {
      offset: '46',
      value: Buffer.from(
        JSON.stringify({
          txnId: 'txn-fail',
          amount: 500,
          timestamp: new Date().toISOString(),
        })
      ),
    };

    await expect(
      consumerService.handleMessage({
        topic: 'transactions.flagged',
        partition: 0,
        message,
      })
    ).rejects.toThrow('Mongo connection lost');

    // Offset must NOT be committed so message is redelivered
    expect(mockConsumer.commitOffsets).not.toHaveBeenCalled();
    expect(mockWsService.broadcastAlert).not.toHaveBeenCalled();
  });

  it('should commit offset even if WebSocket broadcast throws an error (best-effort WS)', async () => {
    const fakeAlert = {
      alertId: 'alt-ws-fail',
      txnId: 'txn-ws-fail',
      severity: 'HIGH',
    };

    mockPersistenceService.upsertAlert.mockResolvedValue({
      alert: fakeAlert,
      isNew: true,
    });

    mockWsService.broadcastAlert = jest.fn().mockImplementation(() => {
      throw new Error('Socket.io client socket buffer overflow');
    });

    const message = {
      offset: '47',
      value: Buffer.from(
        JSON.stringify({
          txnId: 'txn-ws-fail',
          amount: 12000,
          timestamp: new Date().toISOString(),
        })
      ),
    };

    // Should NOT throw
    await consumerService.handleMessage({
      topic: 'transactions.flagged',
      partition: 0,
      message,
    });

    expect(mockWsService.broadcastAlert).toHaveBeenCalledTimes(1);
    // Kafka offset must STILL be committed successfully
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'transactions.flagged', partition: 0, offset: '48' },
    ]);
  });
});
