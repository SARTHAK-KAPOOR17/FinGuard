const crypto = require('crypto');
const { connectMongo, disconnectMongo } = require('../src/database/mongo');
const { Alert } = require('../src/models/alert.model');
const { upsertAlert } = require('../src/services/alert-persistence.service');

describe('Alert Persistence Service - Idempotent Upsert', () => {
  const testTxnId = crypto.randomUUID();
  const testFlaggedId = crypto.randomUUID();

  beforeAll(async () => {
    await connectMongo();
  });

  afterAll(async () => {
    await Alert.deleteMany({ txnId: testTxnId }).catch(() => {});
    await disconnectMongo();
  });

  const samplePayload = {
    txnId: testTxnId,
    flaggedId: testFlaggedId,
    userId: 'usr_dedup_test',
    amount: 25000,
    currency: 'USD',
    merchant: 'Diamond Exchange VIP',
    location: { city: 'Geneva', country: 'CH', lat: 46.2, lng: 6.14 },
    deviceId: 'dev_test_dedup',
    timestamp: new Date().toISOString(),
    flaggedAt: new Date().toISOString(),
    matchedRules: [
      {
        ruleId: 'RULE_LARGE_AMOUNT',
        ruleName: 'High Transaction Amount',
        severity: 'HIGH',
        reason: 'Amount exceeds $10k',
      },
      {
        ruleId: 'RULE_SUSPICIOUS_MERCHANT',
        ruleName: 'Suspicious High-Risk Merchant Match',
        severity: 'CRITICAL',
        reason: 'Merchant matches high-risk pattern',
      },
    ],
    riskScore: 95,
  };

  it('should insert new alert document with highest severity CRITICAL on first arrival', async () => {
    const { alert, isNew } = await upsertAlert(samplePayload);

    expect(isNew).toBe(true);
    expect(alert).toBeDefined();
    expect(alert.txnId).toBe(testTxnId);
    expect(alert.severity).toBe('CRITICAL'); // Highest of HIGH and CRITICAL
    expect(alert.status).toBe('OPEN');
    expect(alert.amount).toBe(25000);
    expect(alert.matchedRules.length).toBe(2);
  });

  it('should return existing alert document with isNew=false on duplicate delivery (idempotency)', async () => {
    // Deliver duplicate payload with same txnId
    const { alert, isNew } = await upsertAlert(samplePayload);

    expect(isNew).toBe(false);
    expect(alert).toBeDefined();
    expect(alert.txnId).toBe(testTxnId);

    // Verify count in MongoDB remains exactly 1
    const count = await Alert.countDocuments({ txnId: testTxnId });
    expect(count).toBe(1);
  });

  it('should preserve existing analyst modifications when duplicate arrives ($setOnInsert protection)', async () => {
    // Analyst updates status to INVESTIGATING
    await Alert.updateOne(
      { txnId: testTxnId },
      { $set: { status: 'INVESTIGATING', assignedTo: 'analyst_42' } }
    );

    // Deliver duplicate payload again
    const { alert, isNew } = await upsertAlert(samplePayload);

    expect(isNew).toBe(false);
    expect(alert.status).toBe('INVESTIGATING');
    expect(alert.assignedTo).toBe('analyst_42');
  });
});
