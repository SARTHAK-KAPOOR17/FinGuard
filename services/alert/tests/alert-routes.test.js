const request = require('supertest');
const crypto = require('crypto');
const { app } = require('../src/app');
const { connectMongo, disconnectMongo } = require('../src/database/mongo');
const { Alert } = require('../src/models/alert.model');

describe('Alert Service - REST API Endpoints', () => {
  const testApiKey = 'test-alert-admin-key-2026';
  let createdAlerts = [];
  let testAlertId;
  let testMongoId;

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = testApiKey;
    await connectMongo();

    // Seed test alerts
    const baseAlerts = [
      {
        alertId: crypto.randomUUID(),
        txnId: crypto.randomUUID(),
        flaggedId: crypto.randomUUID(),
        userId: 'usr_api_alice',
        amount: 25000,
        currency: 'USD',
        merchant: 'Rolex Geneva',
        location: { city: 'Geneva', country: 'CH', lat: 46.2, lng: 6.14 },
        deviceId: 'dev_alice_1',
        timestamp: new Date('2026-11-17T10:00:00Z'),
        flaggedAt: new Date('2026-11-17T10:00:01Z'),
        matchedRules: [
          {
            ruleId: 'RULE_LARGE_AMOUNT',
            ruleName: 'High Transaction Amount',
            severity: 'HIGH',
            reason: 'exceeds $10k',
          },
          {
            ruleId: 'RULE_SUSPICIOUS_MERCHANT',
            ruleName: 'Suspicious Merchant',
            severity: 'CRITICAL',
            reason: 'luxury boutique',
          },
        ],
        riskScore: 95,
        severity: 'CRITICAL',
        status: 'OPEN',
      },
      {
        alertId: crypto.randomUUID(),
        txnId: crypto.randomUUID(),
        flaggedId: crypto.randomUUID(),
        userId: 'usr_api_bob',
        amount: 12000,
        currency: 'USD',
        merchant: 'Apple Store',
        location: { city: 'New York', country: 'US', lat: 40.71, lng: -74.0 },
        deviceId: 'dev_bob_1',
        timestamp: new Date('2026-11-17T11:00:00Z'),
        flaggedAt: new Date('2026-11-17T11:00:01Z'),
        matchedRules: [
          {
            ruleId: 'RULE_LARGE_AMOUNT',
            ruleName: 'High Transaction Amount',
            severity: 'HIGH',
            reason: 'exceeds $10k',
          },
        ],
        riskScore: 75,
        severity: 'HIGH',
        status: 'INVESTIGATING',
        assignedTo: 'analyst_bob',
      },
      {
        alertId: crypto.randomUUID(),
        txnId: crypto.randomUUID(),
        flaggedId: crypto.randomUUID(),
        userId: 'usr_api_charlie',
        amount: 500,
        currency: 'USD',
        merchant: 'Fast Food NY',
        location: { city: 'New York', country: 'US', lat: 40.71, lng: -74.0 },
        deviceId: 'dev_charlie_1',
        timestamp: new Date('2026-11-17T12:00:00Z'),
        flaggedAt: new Date('2026-11-17T12:00:01Z'),
        matchedRules: [
          {
            ruleId: 'RULE_VELOCITY',
            ruleName: 'Velocity Spike',
            severity: 'MEDIUM',
            reason: 'burst transactions',
          },
        ],
        riskScore: 50,
        severity: 'MEDIUM',
        status: 'RESOLVED',
        assignedTo: 'analyst_charlie',
      },
    ];

    createdAlerts = await Alert.insertMany(baseAlerts);
    testAlertId = createdAlerts[0].alertId;
    testMongoId = createdAlerts[0]._id.toString();
  });

  afterAll(async () => {
    const ids = createdAlerts.map((a) => a.alertId);
    await Alert.deleteMany({ alertId: { $in: ids } }).catch(() => {});
    await disconnectMongo();
  });

  describe('GET /alerts/stats', () => {
    it('should aggregate fraud stats ($facet) and be registered before /alerts/:id', async () => {
      const res = await request(app).get('/alerts/stats');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(typeof res.body.total).toBe('number');
      expect(res.body.total).toBeGreaterThanOrEqual(3);

      expect(res.body).toHaveProperty('bySeverity');
      expect(res.body.bySeverity).toHaveProperty('CRITICAL');
      expect(res.body.bySeverity).toHaveProperty('HIGH');
      expect(res.body.bySeverity).toHaveProperty('MEDIUM');
      expect(res.body.bySeverity).toHaveProperty('LOW');

      expect(res.body).toHaveProperty('byStatus');
      expect(res.body.byStatus).toHaveProperty('OPEN');
      expect(res.body.byStatus).toHaveProperty('INVESTIGATING');
      expect(res.body.byStatus).toHaveProperty('RESOLVED');
      expect(res.body.byStatus).toHaveProperty('DISMISSED');

      expect(res.body).toHaveProperty('topRules');
      expect(Array.isArray(res.body.topRules)).toBe(true);
      expect(res.body.topRules.length).toBeGreaterThanOrEqual(1);

      expect(res.body).toHaveProperty('avgRiskScore');
      expect(typeof res.body.avgRiskScore).toBe('number');
    });
  });

  describe('GET /alerts', () => {
    it('should return paginated alerts with default page 1 and limit 20', async () => {
      const res = await request(app).get('/alerts');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('totalPages');
    });

    it('should respect custom page and limit parameters', async () => {
      const res = await request(app).get('/alerts?page=1&limit=2');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.limit).toBe(2);
    });

    it('should reject requests with limit exceeding max 100 with 400 Bad Request', async () => {
      const res = await request(app).get('/alerts?limit=150');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details.some((d) => d.includes('limit'))).toBe(true);
    });

    it('should sort alerts by riskScore when requested', async () => {
      const res = await request(app).get('/alerts?sort=-riskScore&limit=3');

      expect(res.status).toBe(200);
      if (res.body.data.length >= 2) {
        expect(res.body.data[0].riskScore).toBeGreaterThanOrEqual(res.body.data[1].riskScore);
      }
    });

    it('should filter alerts by severity', async () => {
      const res = await request(app).get('/alerts?severity=CRITICAL');

      expect(res.status).toBe(200);
      expect(res.body.data.every((a) => a.severity === 'CRITICAL')).toBe(true);
    });

    it('should filter alerts by status', async () => {
      const res = await request(app).get('/alerts?status=INVESTIGATING');

      expect(res.status).toBe(200);
      expect(res.body.data.every((a) => a.status === 'INVESTIGATING')).toBe(true);
    });

    it('should filter alerts by userId', async () => {
      const res = await request(app).get('/alerts?userId=usr_api_alice');

      expect(res.status).toBe(200);
      expect(res.body.data.every((a) => a.userId === 'usr_api_alice')).toBe(true);
    });

    it('should filter alerts by matched ruleId', async () => {
      const res = await request(app).get('/alerts?ruleId=RULE_SUSPICIOUS_MERCHANT');

      expect(res.status).toBe(200);
      expect(
        res.body.data.every((a) =>
          a.matchedRules.some((r) => r.ruleId === 'RULE_SUSPICIOUS_MERCHANT')
        )
      ).toBe(true);
    });

    it('should reject date filter if startDate > endDate with 400 Bad Request', async () => {
      const res = await request(app).get(
        '/alerts?startDate=2026-11-20T00:00:00Z&endDate=2026-11-10T00:00:00Z'
      );

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.details.some((d) => d.includes('startDate'))).toBe(true);
    });

    it('should reject unknown query parameters to prevent NoSQL injection', async () => {
      const res = await request(app).get('/alerts?unknownField=dangerousValue');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });

    it('should reject object query parameters (NoSQL injection prevention ?userId[$ne]=x)', async () => {
      // In supertest, passing an object for query generates userId[$ne]=x
      const res = await request(app).get('/alerts').query({ userId: { $ne: 'alice' } });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });
  });

  describe('GET /alerts/:id', () => {
    it('should fetch alert by valid UUID alertId', async () => {
      const res = await request(app).get(`/alerts/${testAlertId}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('alert');
      expect(res.body.alert.alertId).toBe(testAlertId);
      expect(res.body.alert.userId).toBe('usr_api_alice');
    });

    it('should fetch alert by valid 24-character Mongo _id', async () => {
      const res = await request(app).get(`/alerts/${testMongoId}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('alert');
      expect(res.body.alert._id).toBe(testMongoId);
    });

    it('should return 400 Bad Request for malformed ID format (neither UUID nor ObjectId)', async () => {
      const res = await request(app).get('/alerts/invalid-malformed-id-123');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });

    it('should return 404 Not Found for non-existent UUID', async () => {
      const nonExistentUuid = crypto.randomUUID();
      const res = await request(app).get(`/alerts/${nonExistentUuid}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFound');
    });
  });

  describe('PATCH /alerts/:id/status', () => {
    it('should reject status updates without API key with 401 Unauthorized', async () => {
      const res = await request(app)
        .patch(`/alerts/${testAlertId}/status`)
        .send({ status: 'INVESTIGATING', analyst: 'analyst_dan' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should reject status updates with invalid API key with 401 Unauthorized', async () => {
      const res = await request(app)
        .patch(`/alerts/${testAlertId}/status`)
        .set('x-api-key', 'wrong-key')
        .send({ status: 'INVESTIGATING', analyst: 'analyst_dan' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should transition status from OPEN to INVESTIGATING and append analyst & audit notes', async () => {
      const res = await request(app)
        .patch(`/alerts/${testAlertId}/status`)
        .set('x-api-key', testApiKey)
        .send({
          status: 'INVESTIGATING',
          analyst: 'analyst_dan',
          note: 'Assigned to investigate luxury merchant pattern',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'success');
      expect(res.body.alert.status).toBe('INVESTIGATING');
      expect(res.body.alert.assignedTo).toBe('analyst_dan');

      // Verify notes array has both the custom analyst note and audit note
      const notes = res.body.alert.notes;
      expect(notes.length).toBe(2);
      expect(notes.some((n) => n.text.includes('luxury merchant pattern'))).toBe(true);
      expect(notes.some((n) => n.text.includes('Status changed from OPEN to INVESTIGATING'))).toBe(
        true
      );
    });

    it('should reject invalid status enum with 400 Bad Request', async () => {
      const res = await request(app)
        .patch(`/alerts/${testAlertId}/status`)
        .set('x-api-key', testApiKey)
        .send({
          status: 'INVALID_STATUS_ENUM',
          analyst: 'analyst_dan',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'ValidationError');
    });

    it('should reject prohibited lifecycle transition (RESOLVED -> OPEN) with 400 Bad Request', async () => {
      // createdAlerts[2] is currently RESOLVED
      const resolvedAlertId = createdAlerts[2].alertId;

      const res = await request(app)
        .patch(`/alerts/${resolvedAlertId}/status`)
        .set('x-api-key', testApiKey)
        .send({
          status: 'OPEN', // Prohibited: Reopening requires moving to INVESTIGATING
          analyst: 'analyst_eve',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'InvalidTransitionError');
      expect(res.body.message).toContain('Cannot transition alert status');
    });

    it('should allow valid reopening of RESOLVED alert back to INVESTIGATING', async () => {
      const resolvedAlertId = createdAlerts[2].alertId;

      const res = await request(app)
        .patch(`/alerts/${resolvedAlertId}/status`)
        .set('x-api-key', testApiKey)
        .send({
          status: 'INVESTIGATING',
          analyst: 'analyst_reopen',
          note: 'Reopened due to customer transaction dispute',
        });

      expect(res.status).toBe(200);
      expect(res.body.alert.status).toBe('INVESTIGATING');
      expect(res.body.alert.assignedTo).toBe('analyst_reopen');
    });

    it('should return 404 for status update on non-existent UUID', async () => {
      const nonExistentUuid = crypto.randomUUID();
      const res = await request(app)
        .patch(`/alerts/${nonExistentUuid}/status`)
        .set('x-api-key', testApiKey)
        .send({
          status: 'DISMISSED',
          analyst: 'analyst_dan',
        });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'NotFound');
    });
  });
});
